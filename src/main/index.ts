import {
  app,
  BrowserWindow,
  nativeImage,
  nativeTheme,
  powerMonitor,
  shell,
} from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { registerIpc } from './ipc';
import { runDailyBackupIfDue } from './backup';
import { getDb } from './db';
import { getSettings } from './settings';
import { startCalendarSync, stopCalendarSync } from './calendarSync';
import { startPhoneInbox, stopPhoneInbox } from './phoneInbox';
import { startPhoneRelay, stopPhoneRelay } from './phoneRelay';
import { setMainWindow } from './windows';
import { markQuitting } from './coverWindows';
import { hideOverlay, markOverlayQuitting, showOverlay } from './overlayWindow';
import { registerHoldToPeek, unregisterHoldToPeek } from './holdToPeek';
import { getTimerState, pauseIfWorking } from './pomodoro/engine';

let mainWindow: BrowserWindow | null = null;

function resolveIconPath(): string | undefined {
  const candidates = [
    join(__dirname, '../../resources/icon.icns'),
    join(__dirname, '../../resources/icon.png'),
    join(process.resourcesPath ?? '', 'resources', 'icon.icns'),
    join(process.resourcesPath ?? '', 'resources', 'icon.png'),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return undefined;
}

function createWindow() {
  const iconPath = resolveIconPath();
  const icon = iconPath ? nativeImage.createFromPath(iconPath) : undefined;

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 880,
    minHeight: 560,
    title: 'Hourly Logger',
    icon,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1C1C1A' : '#F1E9D5',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Register with the window registry so the pomodoro engine can push
  // ticks; survives the macOS close-then-activate-recreate cycle.
  setMainWindow(mainWindow);

  mainWindow.on('closed', () => {
    mainWindow = null;
    setMainWindow(null);
    // The hidden cover/overlay windows hide instead of closing, so
    // 'window-all-closed' never fires once they exist. Quit explicitly
    // when the MAIN window goes away on non-macOS.
    if (process.platform !== 'darwin') app.quit();
  });
}

app.whenReady().then(() => {
  app.setName('Hourly Logger');
  if (process.platform === 'darwin') {
    const iconPath = resolveIconPath();
    if (iconPath) {
      try {
        app.dock?.setIcon(nativeImage.createFromPath(iconPath));
      } catch {
        // ignore
      }
    }
  }

  // Initialize DB + settings before anything else.
  getDb();
  getSettings();

  registerIpc();

  // Fire-and-forget daily backup
  try {
    runDailyBackupIfDue();
  } catch (err) {
    console.error('Backup failed:', err);
  }

  // Schedule calendar sync — runs in the background even when the
  // window isn't focused. Starts a 5s after launch so we don't fight
  // with first-paint.
  try {
    startCalendarSync();
  } catch (err) {
    console.error('Calendar sync failed to start:', err);
  }

  // Watch the iCloud phone-inbox folder so entries logged from the iPhone
  // get imported. Runs in the background regardless of window focus.
  try {
    startPhoneInbox();
  } catch (err) {
    console.error('Phone inbox failed to start:', err);
  }

  // Poll the Cloudflare relay for entries logged from the phone web app.
  try {
    startPhoneRelay();
  } catch (err) {
    console.error('Phone relay failed to start:', err);
  }

  // Hold-to-peek overlay: pill with the live pomodoro countdown while
  // Ctrl+Option+P is held.
  registerHoldToPeek({
    onKeyDown: () => showOverlay(getTimerState()),
    onKeyUp: () => hideOverlay(),
  });

  // Auto-pause focus sessions on system sleep so a 25-min timer doesn't
  // "complete" the moment the lid opens. Breaks are left running.
  powerMonitor.on('suspend', () => {
    pauseIfWorking();
  });

  createWindow();

  app.on('activate', () => {
    // Check OUR window, not getAllWindows() — the hidden break-cover and
    // overlay windows always exist once a pomodoro has run, so the count
    // would never reach 0 and the main window could never be reopened.
    if (mainWindow === null) createWindow();
  });
});

app.on('before-quit', () => {
  stopCalendarSync();
  stopPhoneInbox();
  stopPhoneRelay();
  // Let cover/overlay windows actually close instead of hiding.
  markQuitting();
  markOverlayQuitting();
});

app.on('will-quit', () => {
  unregisterHoldToPeek();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
