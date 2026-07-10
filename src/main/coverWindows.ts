import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import type { CoverShowPayload, PomodoroTimerState } from '@shared/types';

// Full-screen break covers: one frameless, transparent, always-on-top
// window per display, kept in sync with display add/remove/resize.
// Ported from the standalone Pomodoro app's window-manager.js — the
// macOS-specific settings ('screen-saver' level, visibleOnFullScreen)
// are load-bearing; don't "improve" them.
//
// Windows are created lazily on the first pomodoro break so users who
// never touch pomodoro mode don't pay one hidden window per display.

const coverWindows = new Map<number, BrowserWindow>(); // display.id → win
let initialized = false;
let quitting = false;
// The payload currently on screen, or null when covers are hidden. Also
// serves as the guard for queued deliveries: a send that was waiting on
// 'did-finish-load' re-checks this at fire time, so a cover that was
// hidden (or re-shown with a new payload) in the meantime can't pop a
// stale full-screen overlay.
let currentPayload: CoverShowPayload | null = null;

export function markQuitting(): void {
  quitting = true;
}

function createCoverWindow(display: Electron.Display): BrowserWindow {
  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    // Focusable on purpose: the cover takes focus so in-flight keystrokes
    // land on it (where they're swallowed) instead of the user's document.
    focusable: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/cover.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/cover.html`);
  } else {
    win.loadFile(join(__dirname, '../renderer/cover.html'));
  }

  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });

  coverWindows.set(display.id, win);
  return win;
}

function ensureCoverWindows(): void {
  if (initialized) return;
  initialized = true;

  screen.getAllDisplays().forEach(createCoverWindow);

  screen.on('display-added', (_e, display) => {
    const win = createCoverWindow(display);
    // If a break is on screen right now, the new display gets covered
    // too (delivery waits for the fresh window to finish loading).
    if (currentPayload) deliverTo(win);
  });

  screen.on('display-removed', (_e, display) => {
    const win = coverWindows.get(display.id);
    coverWindows.delete(display.id);
    if (win && !win.isDestroyed()) {
      win.destroy();
    }
  });

  screen.on('display-metrics-changed', (_e, display) => {
    const win = coverWindows.get(display.id);
    if (win && !win.isDestroyed()) {
      win.setBounds(display.bounds);
    }
  });
}

function eachCover(fn: (win: BrowserWindow) => void): void {
  for (const win of coverWindows.values()) {
    if (win && !win.isDestroyed()) fn(win);
  }
}

// Create the windows ahead of time (called at pomodoro start) so the
// renderer is loaded long before the first break needs to show.
export function prewarmCovers(): void {
  ensureCoverWindows();
}

// Send the CURRENT payload to one window and show it. A just-created
// window hasn't loaded its renderer yet — a send now would vanish — so
// delivery queues behind 'did-finish-load' and re-reads currentPayload
// when it fires (null means hideCovers() won in the meantime: bail).
function deliverTo(win: BrowserWindow): void {
  const send = () => {
    if (win.isDestroyed() || !currentPayload) return;
    win.webContents.send('cover:show', currentPayload);
    // skipTransformProcessType is load-bearing: WITHOUT it,
    // setVisibleOnAllWorkspaces transforms the whole process to a
    // UIElement (accessory) app on macOS — which permanently removes
    // Hourly Logger's Dock running-dot and drops it from the Cmd-Tab
    // switcher for the rest of the session (the first break demotes it).
    // The cover still appears over full-screen apps via the
    // FullScreenAuxiliary collection behavior + the screen-saver level.
    win.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.showInactive();
  };
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

export function showCovers(payload: CoverShowPayload): void {
  ensureCoverWindows();
  currentPayload = payload;
  eachCover(deliverTo);

  // Focus the cover under the cursor so in-flight keystrokes land on the
  // cover (where they do nothing) instead of the document being typed in.
  const cursorDisplay = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint()
  );
  const target = coverWindows.get(cursorDisplay.id);
  if (target && !target.isDestroyed()) {
    target.focus();
  }
}

export function sendCoverTick(state: PomodoroTimerState): void {
  eachCover((win) => win.webContents.send('cover:tick', state));
}

export function hideCovers(): void {
  currentPayload = null;
  eachCover((win) => {
    win.webContents.send('cover:hide', null);
    win.hide();
  });
}
