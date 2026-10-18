const { app, BrowserWindow, WebContentsView, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { safeOpenExternal, validateExternalUrl } = require('./safe-external.js');

app.disableHardwareAcceleration();

const PROVIDERS = [
  { name: 'ChatGPT', url: 'https://chatgpt.com', partition: 'persist:mcb-web-chatgpt' },
  { name: 'Gemini', url: 'https://gemini.google.com', partition: 'persist:mcb-web-gemini' },
  { name: 'Claude', url: 'https://claude.ai', partition: 'persist:mcb-web-claude' },
  { name: 'DeepSeek', url: 'https://chat.deepseek.com', partition: 'persist:mcb-web-deepseek' }
];

const NO_SCREENSHOT = process.argv.includes('--no-screenshot');

const results = {
  timestamp: new Date().toISOString(),
  electronVersion: process.versions.electron,
  chromeVersion: process.versions.chrome,
  providers: {},
  partitionIsolationTest: null,
  externalFallbackTest: null,
  dangerousSchemeRejectionTest: null,
  allPassed: false
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

async function runExternalFallbackAndSecurityTest(window) {
  console.log('\n--- Running External Fallback & Dangerous Scheme Rejection Test (UB-P1-SEC-001) ---');
  const openedUrls = [];

  // Mock shell.openExternal
  const originalOpenExternal = shell.openExternal;
  shell.openExternal = async (url) => {
    openedUrls.push(url);
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

  // Hook new window with safeOpenExternal: deny child view creation, filter scheme
  testView.webContents.setWindowOpenHandler(({ url }) => {
    safeOpenExternal(url, shell);
    return { action: 'deny' };
  });

  // 1. Test valid HTTPS external link
  await testView.webContents.loadURL('data:text/html,<html><body><a id="valid-link" href="https://unapproved-external.org" target="_blank">Valid External</a><a id="file-link" href="file:///C:/Windows/System32/cmd.exe" target="_blank">File</a><a id="js-link" href="javascript:alert(1)" target="_blank">JS</a><a id="ms-link" href="ms-settings:privacy" target="_blank">MS</a></body></html>');
  
  await testView.webContents.executeJavaScript('document.getElementById("valid-link").click()');
  await new Promise(r => setTimeout(r, 200));

  // 2. Test dangerous schemes
  await testView.webContents.executeJavaScript('document.getElementById("file-link").click()');
  await testView.webContents.executeJavaScript('document.getElementById("js-link").click()');
  await testView.webContents.executeJavaScript('document.getElementById("ms-link").click()');
  await new Promise(r => setTimeout(r, 400));

  shell.openExternal = originalOpenExternal;
  window.contentView.removeChildView(testView);

  const validOpened = openedUrls.includes('https://unapproved-external.org/');
  const fileOpened = openedUrls.some(u => u.startsWith('file:'));
  const jsOpened = openedUrls.some(u => u.startsWith('javascript:'));
  const msOpened = openedUrls.some(u => u.startsWith('ms-'));

  const dangerousBlocked = !fileOpened && !jsOpened && !msOpened;
  console.log(`Valid HTTPS external opened: ${validOpened} (${openedUrls[0] || 'none'})`);
  console.log(`Dangerous schemes strictly blocked: ${dangerousBlocked} (file: ${fileOpened}, js: ${jsOpened}, ms: ${msOpened})`);

  results.externalFallbackTest = {
    openedUrls,
    validOpened,
    passed: validOpened
  };

  results.dangerousSchemeRejectionTest = {
    fileBlocked: !fileOpened,
    jsBlocked: !jsOpened,
    msBlocked: !msOpened,
    passed: dangerousBlocked
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

  // Attach safeWindowOpenHandler to provider view (UB-P1-SEC-001)
  view.webContents.setWindowOpenHandler(({ url }) => {
    console.log(`[ProviderView-${provider.name}] Denied popup, safe routing: ${url}`);
    safeOpenExternal(url, shell);
    return { action: 'deny' };
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

  // Allow scripts to run and finalize navigation
  await new Promise(r => setTimeout(r, 4000));

  const pageTitle = view.webContents.getTitle();
  const currentUrl = view.webContents.getURL();

  // Capture raw rendered screenshot if not disabled (UB-P1-SEC-003)
  const screenshotFilename = `${provider.name.toLowerCase()}_raw_rendered.png`;
  const screenshotPath = path.join(outputDir, screenshotFilename);
  let screenshotBytes = 0;

  if (!NO_SCREENSHOT) {
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
  }

  // Assess verdict (UB-P1-QA-005: do not claim rendered if failed load without recovery)
  let verdict = 'NOT_TESTED';
  let state = 'UNKNOWN';
  let notes = '';

  if (finishLoad && pageTitle && pageTitle.length > 0) {
    verdict = 'ELECTRON_RENDERED';
    
    // Distinguish login-required entry pages from ready state
    const lowerUrl = currentUrl.toLowerCase();
    if (lowerUrl.includes('/login') || lowerUrl.includes('/sign_in') || lowerUrl.includes('accounts.google.com')) {
      state = 'LOGIN_REQUIRED';
      notes = `Public login page rendered in isolated WebContentsView. Title: '${pageTitle}'. Authenticated session required for prompt dispatch.`;
    } else {
      state = 'READY_OR_LANDING';
      notes = `Landing page rendered in isolated WebContentsView. Title: '${pageTitle}'.`;
    }
  } else if (failLoad && !finishLoad) {
    verdict = 'BLOCKED_EXTERNAL';
    state = 'FAIL_LOAD';
    notes = `Failed to load: ${JSON.stringify(failDetails)}`;
  } else {
    verdict = 'PARTIAL_LOAD';
    state = 'DEGRADED';
    notes = `Loaded with anomalies. Title: '${pageTitle}', failLoad: ${failLoad}`;
  }

  console.log(`Result: ${verdict} | State: ${state} | Title: '${pageTitle}'`);
  console.log(`Screenshot: ${NO_SCREENSHOT ? 'DISABLED (--no-screenshot)' : `${screenshotFilename} (${screenshotBytes} bytes)`}`);

  results.providers[provider.name] = {
    origin: provider.url,
    partition: provider.partition,
    verdict,
    state,
    pageTitle,
    currentUrl,
    screenshot: NO_SCREENSHOT ? null : screenshotFilename,
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

    // 2. External Fallback & Dangerous Scheme Rejection Test (UB-P1-SEC-001)
    await runExternalFallbackAndSecurityTest(win);

    // 3. Probe each of the 4 providers
    for (const p of PROVIDERS) {
      await probeProvider(win, p);
    }

    // Evaluate overall success
    const partitionPassed = results.partitionIsolationTest?.passed === true;
    const fallbackPassed = results.externalFallbackTest?.passed === true;
    const dangerousBlocked = results.dangerousSchemeRejectionTest?.passed === true;
    const providersRendered = Object.values(results.providers).filter(p => p.verdict === 'ELECTRON_RENDERED').length >= 4;

    results.allPassed = partitionPassed && fallbackPassed && dangerousBlocked && providersRendered;

    // Save final report
    const reportPath = path.join(outputDir, 'electron_probe_report.json');
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf-8');
    console.log(`\n=== PROBE COMPLETE ===\nAll Tests Passed: ${results.allPassed}\nReport saved to: ${reportPath}`);

    if (!results.allPassed) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('Fatal probe error:', err);
    process.exitCode = 1;
  } finally {
    win.destroy();
    app.quit();
  }
});
