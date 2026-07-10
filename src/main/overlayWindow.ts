import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import type { PomodoroTimerState } from '@shared/types';

// The hold-to-peek pill: small click-through, non-focusable windows
// shown while the global shortcut is held — ONE PER DISPLAY, like the
// break covers, so the countdown is visible no matter which monitor
// you're looking at. Lazy-created on first peek and kept in sync with
// display add/remove/resize.

const PILL_W = 220;
const PILL_H = 100;

const overlayWindows = new Map<number, BrowserWindow>(); // display.id → win
let initialized = false;
let quitting = false;
// Last timer state pushed to the pills.
let currentState: PomodoroTimerState | null = null;
// The pill is on screen for one of two reasons: the peek hotkey is held
// (heldOpen) or a transient warning flash is running (flashTimer). The
// combination guards deliveries queued behind 'did-finish-load' — a
// peek released before a fresh window loads must not pop it afterwards.
let heldOpen = false;
let flashMessage: string | null = null;
let flashTimer: NodeJS.Timeout | null = null;

function isOnScreen(): boolean {
  return heldOpen || flashTimer != null;
}

export function markOverlayQuitting(): void {
  quitting = true;
}

function pillBounds(display: Electron.Display) {
  const wa = display.workArea;
  return {
    x: wa.x + Math.round((wa.width - PILL_W) / 2),
    y: wa.y + Math.round(wa.height * 0.25),
    width: PILL_W,
    height: PILL_H,
  };
}

function createOverlayWindow(display: Electron.Display): BrowserWindow {
  const win = new BrowserWindow({
    ...pillBounds(display),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/overlay.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.setIgnoreMouseEvents(true);

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/overlay.html`);
  } else {
    win.loadFile(join(__dirname, '../renderer/overlay.html'));
  }

  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });

  overlayWindows.set(display.id, win);
  return win;
}

function ensureOverlayWindows(): void {
  if (initialized) return;
  initialized = true;

  screen.getAllDisplays().forEach(createOverlayWindow);

  screen.on('display-added', (_e, display) => {
    const win = createOverlayWindow(display);
    if (isOnScreen()) deliverTo(win);
  });

  screen.on('display-removed', (_e, display) => {
    const win = overlayWindows.get(display.id);
    overlayWindows.delete(display.id);
    if (win && !win.isDestroyed()) {
      win.destroy();
    }
  });

  screen.on('display-metrics-changed', (_e, display) => {
    const win = overlayWindows.get(display.id);
    if (win && !win.isDestroyed()) {
      win.setBounds(pillBounds(display));
    }
  });
}

function eachOverlay(fn: (win: BrowserWindow) => void): void {
  for (const win of overlayWindows.values()) {
    if (win && !win.isDestroyed()) fn(win);
  }
}

// Send the current content to one window and show it; a just-created
// window queues delivery behind load and re-checks visibility at fire
// time (the peek/flash may already be over: bail).
function deliverTo(win: BrowserWindow): void {
  const send = () => {
    if (win.isDestroyed() || !isOnScreen()) return;
    if (currentState) win.webContents.send('overlay:update', currentState);
    if (flashMessage) win.webContents.send('overlay:flash', flashMessage);
    win.showInactive();
  };
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

function hideAll(): void {
  eachOverlay((win) => win.hide());
}

export function showOverlay(state: PomodoroTimerState): void {
  ensureOverlayWindows();
  heldOpen = true;
  currentState = state;
  eachOverlay(deliverTo);
}

export function hideOverlay(): void {
  heldOpen = false;
  // A running flash keeps the pills up until its own timeout.
  if (!flashTimer) hideAll();
}

// Transient warning flash (e.g. "5 min left in this focus"): shows the
// pills on every display for a few seconds, then hides them — unless
// the peek hotkey is held, in which case they stay.
export function flashOverlay(message: string, durationMs = 4500): void {
  ensureOverlayWindows();
  flashMessage = message;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    flashTimer = null;
    flashMessage = null;
    if (!heldOpen) hideAll();
  }, durationMs);
  eachOverlay(deliverTo);
}

// Live-update the pills while they're on screen.
export function updateOverlayIfVisible(state: PomodoroTimerState): void {
  currentState = state;
  if (!isOnScreen()) return;
  eachOverlay((win) => {
    if (win.isVisible()) {
      win.webContents.send('overlay:update', state);
    }
  });
}
