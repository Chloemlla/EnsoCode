import { app, BrowserWindow, session, type WebContents, webContents } from 'electron';
import { isServerMode } from '../services/appServerMode';
import { partitionName } from '../services/browserPartition';
import { isMainRenderer, isSettingsRenderer } from '../services/renderers';
import { type ChromiumRendererInfo, installLocalUi, type LocalUi } from '../services/uiHost';
import { getWindowWebContents } from '../windows/createAppWindow';
import { focusMainWindow, getMainWindow } from '../windows/MainWindow';
import { getSettingsWindow } from '../windows/SettingsWindow';

const windowClosed = new Set<(webContentsId: number) => void>();

function contentsOf(win: Electron.BrowserWindow): WebContents {
  return getWindowWebContents(win);
}

function alive(contents: WebContents | null | undefined): contents is WebContents {
  return Boolean(contents && !contents.isDestroyed());
}

function chromiumRenderers(): ChromiumRendererInfo {
  const browserSession = session.fromPartition(partitionName(app.isPackaged));
  const mainPids = new Set<number>();
  const settingsPids = new Set<number>();
  const browserPids = new Set<number>();
  const titles = new Map<number, string>();
  for (const contents of webContents.getAllWebContents()) {
    if (contents.isDestroyed()) continue;
    const pid = contents.getOSProcessId();
    if (pid <= 0) continue;
    if (isMainRenderer(contents.id)) mainPids.add(pid);
    else if (isSettingsRenderer(contents.id)) settingsPids.add(pid);
    else if (contents.session === browserSession) browserPids.add(pid);
    const title = contents.getTitle() || contents.getURL();
    if (title && !titles.has(pid)) titles.set(pid, title);
  }
  return { mainPids, settingsPids, browserPids, titles };
}

const desktopUi: LocalUi = {
  mainContents() {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return null;
    const contents = contentsOf(win);
    return alive(contents) ? contents : null;
  },
  settingsContents() {
    const win = getSettingsWindow();
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return null;
    return win.webContents;
  },
  allContents() {
    return BrowserWindow.getAllWindows()
      .filter((win) => !win.isDestroyed())
      .map(contentsOf)
      .filter(alive);
  },
  windowContentIds() {
    return BrowserWindow.getAllWindows()
      .filter((win) => !win.isDestroyed() && !win.webContents.isDestroyed())
      .map((win) => win.webContents.id);
  },
  onWindowClosed(listener) {
    windowClosed.add(listener);
  },
  anyFocused() {
    return BrowserWindow.getAllWindows().some((win) => !win.isDestroyed() && win.isFocused());
  },
  focusMain() {
    focusMainWindow();
  },
  chromiumRenderers,
  trayMode: isServerMode,
};

export function installDesktopLocalUi(): void {
  installLocalUi(desktopUi);
  app.on('browser-window-created', (_event, window) => {
    const webContentsId = window.webContents.id;
    window.once('closed', () => {
      for (const listener of windowClosed) listener(webContentsId);
    });
  });
}
