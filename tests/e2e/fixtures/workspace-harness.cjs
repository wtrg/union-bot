const { app, BrowserWindow, session, clipboard, ipcMain } = require("electron");
const path = require("node:path");
app.setPath("userData", process.env.UNION_UI_TEST_PROFILE);
app.whenReady().then(async () => {
  const {
    writeClipboardText,
  } = require("../../../apps/desktop/src/services/clipboard-service.cjs");
  ipcMain.handle("union-bot:clipboard-write-text", (_event, text) =>
    writeClipboardText(clipboard, text),
  );
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*"] },
    (_details, callback) => callback({ cancel: true }),
  );
  const window = new BrowserWindow({
    width: 1536,
    height: 900,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "workspace-preload.cjs"),
    },
  });
  await window.loadFile(
    path.resolve(__dirname, "../../../apps/workspace-ui/dist/index.html"),
  );
});
app.on("window-all-closed", () => app.quit());
