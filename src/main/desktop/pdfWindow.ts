import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow } from 'electron';

const PDF_VIEWER_URL = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html';
const PDF_STREAM_URL =
  /^chrome-extension:\/\/mhjfbmdgcfjbbpaeojofohoefgiehjai\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** 工作区 PDF：无 preload 的沙箱窗口，只放行内置 viewer 的首个 stream 子帧。 */
export async function openDesktopPdfWindow(file: string): Promise<void> {
  const win = new BrowserWindow({
    width: 900,
    height: 1100,
    title: path.basename(file),
    autoHideMenuBar: true,
    webPreferences: {
      plugins: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      partition: `workspace-pdf-${randomUUID()}`,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  const pdfUrl = pathToFileURL(file).href;
  win.webContents.on('will-frame-navigate', (event) => {
    const viewer = event.frame?.parent;
    const initialPdfStream =
      !event.isMainFrame &&
      event.frame?.url === '' &&
      viewer?.url === PDF_VIEWER_URL &&
      event.initiator === viewer &&
      viewer.parent === win.webContents.mainFrame &&
      win.webContents.mainFrame.url === pdfUrl &&
      PDF_STREAM_URL.test(event.url);
    if (!initialPdfStream) event.preventDefault();
  });
  win.webContents.on('will-redirect', (event) => event.preventDefault());
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false)
  );
  win.webContents.session.setPermissionCheckHandler(() => false);
  try {
    await win.loadFile(file);
  } catch (error) {
    win.destroy();
    throw error;
  }
}

/** Bot 产物 PDF：独立窗口，禁止新窗口与跳转。 */
export function openBotPdfWindow(file: string, title: string): void {
  const win = new BrowserWindow({
    width: 900,
    height: 1100,
    title,
    autoHideMenuBar: true,
    webPreferences: {
      plugins: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  void win.loadFile(file);
}
