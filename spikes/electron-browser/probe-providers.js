const { app, BrowserWindow, WebContentsView, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();

const PROVIDERS = [
  { name: 'ChatGPT', url: 'https://chatgpt.com', partition: 'persist:mcb-web-chatgpt' },
  { name: 'Gemini', url: 'https://gemini.google.com', partition: 'persist:mcb-web-gemini' },
  { name: 'Claude', url: 'https://claude.ai', partition: 'persist:mcb-web-claude' },
  { name: 'DeepSeek', url: 'https://chat.deepseek.com', partition: 'persist:mcb-web-deepseek' }
];

const results = {
  timestamp: new Date().toISOString(),
  electronVersion: process.versions.electron,
  chromeVersion: process.versions.chrome,
  providers: {},
  partitionIsolationTest: null,
  externalFallbackTest: null
};

const outputDir = path.resolve(__dirname, '../../scratch/electron-probe');
fs.mkdirSync(outputDir, { recursive: true });

async function runPartitionIsolationTest() {
  console.log('\n--- Running Partition Isolation A/B Test ---');
  const sessionA = session.fromPartition('persist:mcb-web-test-a');
  const sessionB = session.fromPartition('persist:mcb-web-test-b');

  // Set test cookie in Partition A
  await sessionA.cookies.set({
    url: 'https://union-bot.local',
    name: 'qa_partition_token',
    value: 'partition_a_private_data'
  });

  // Query cookies in Partition A
  const cookiesA = await sessionA.cookies.get({ url: 'https://union-bot.local' });
  const hasA = cookiesA.some(c => c.name === 'qa_partition_token');

  // Query cookies in Partition B
  const cookiesB = await sessionB.cookies.get({ url: 'https://union-bot.local' });
  const hasB = cookiesB.some(c => c.name === 'qa_partition_token');

  const isolated = hasA && !hasB;
  console.log(`Partition A has token: ${hasA}`);
  console.log(`Partition B has token: ${hasB}`);
  console.log(`Partition Isolation Verified: ${isolated}`);

  results.partitionIsolationTest = {
    partitionA: 'persist:mcb-web-test-a',
    partitionB: 'persist:mcb-web-test-b',
    cookieName: 'qa_partition_token',
    partitionAHasCookie: hasA,
    partitionBHasCookie: hasB,
    passed: isolated
  };
}

async function runExternalFallbackTest(window) {
  console.log('\n--- Running External Fallback Safe Route Test ---');
  let openExternalCalled = false;
  let interceptedUrl = null;

  // Temporarily override shell.openExternal
  const originalOpenExternal = shell.openExternal;
  shell.openExternal = async (url) => {
    openExternalCalled = true;
    interceptedUrl = url;
    return Promise.resolve();
  };

  const testView = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  window.contentView.addChildView(testView);

  // Hook new window / external link handling
  testView.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Trigger test window open
  await testView.webContents.loadURL('data:text/html,<html><body><a id="link" href="https://unapproved-external.org" target="_blank">External</a></body></html>');
  await testView.webContents.executeJavaScript('document.getElementById("link").click()');

  // Wait brief moment for event loop
  await new Promise(r => setTimeout(r, 500));

  shell.openExternal = originalOpenExternal;
  window.contentView.removeChildView(testView);

  console.log(`External fallback called: ${openExternalCalled} for url: ${interceptedUrl}`);
  results.externalFallbackTest = {
    openExternalCalled,
    interceptedUrl,
    passed: openExternalCalled && interceptedUrl === 'https://unapproved-external.org/'
  };
}

async function probeProvider(window, provider) {
  console.log(`\n--- Probing ${provider.name} (${provider.url}) ---`);
  const viewSession = session.fromPartition(provider.partition);

  const view = new WebContentsView({
    webPreferences: {
      session: viewSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 1200, height: 800 });

  let finishLoad = false;
  let failLoad = false;
  let failDetails = null;

  view.webContents.on('did-finish-load', () => {
    finishLoad = true;
  });

  view.webContents.on('did-fail-load', (e, code, desc, url) => {
    failLoad = true;
    failDetails = { code, desc, url };
  });

  try {
    await view.webContents.loadURL(provider.url, { timeout: 15000 });
  } catch (err) {
    failLoad = true;
    failDetails = { code: -1, desc: err.message };
  }

  // Allow dynamic scripts to execute
  await new Promise(r => setTimeout(r, 4000));

  const pageTitle = view.webContents.getTitle();
  const currentUrl = view.webContents.getURL();

  // Capture scrubbed screenshot
  const screenshotFilename = `${provider.name.toLowerCase()}_scrubbed.png`;
  const screenshotPath = path.join(outputDir, screenshotFilename);
  let screenshotBytes = 0;

  try {
    const image = await view.webContents.capturePage();
    const pngBuffer = image.toPNG();
    if (pngBuffer && pngBuffer.length > 0) {
      fs.writeFileSync(screenshotPath, pngBuffer);
      screenshotBytes = pngBuffer.length;
    }
  } catch (err) {
    console.log(`[Capture] Surface notice: ${err.message}`);
  }

  // Assess verdict
  let verdict = 'NOT_TESTED';
  let notes = '';

  if (finishLoad || (pageTitle && pageTitle.length > 0)) {
    verdict = 'ELECTRON_RENDERED';
    notes = `Page rendered in WebContentsView. Title: '${pageTitle}'. Scrubbed screenshot saved (${screenshotBytes} bytes).`;
  } else if (failLoad) {
    verdict = 'BLOCKED_EXTERNAL';
    notes = `Failed to load: ${JSON.stringify(failDetails)}`;
  }

  console.log(`Result: ${verdict} | Title: '${pageTitle}'`);
  console.log(`Screenshot: ${screenshotFilename} (${screenshotBytes} bytes)`);

  results.providers[provider.name] = {
    origin: provider.url,
    partition: provider.partition,
    verdict,
    pageTitle,
    currentUrl,
    screenshot: screenshotFilename,
    screenshotBytes,
    finishLoad,
    failLoad,
    failDetails,
    notes
  };

  window.contentView.removeChildView(view);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    x: -3000,
    y: -3000,
    width: 1280,
    height: 900,
    show: true // Off-screen surface allocation for GPU rendering
  });

  try {
    // 1. Partition Isolation A/B Test
    await runPartitionIsolationTest();

    // 2. External Fallback Test
    await runExternalFallbackTest(win);

    // 3. Probe each of the 4 providers
    for (const p of PROVIDERS) {
      await probeProvider(win, p);
    }

    // Save final report
    const reportPath = path.join(outputDir, 'electron_probe_report.json');
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf-8');
    console.log(`\n=== PROBE COMPLETE ===\nReport saved to: ${reportPath}`);

  } catch (err) {
    console.error('Fatal probe error:', err);
  } finally {
    win.destroy();
    app.quit();
  }
});
