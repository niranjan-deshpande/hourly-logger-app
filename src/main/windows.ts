import type { BrowserWindow } from 'electron';

// Tiny registry so the pomodoro engine can push events to the main
// window without importing index.ts (which imports ipc.ts, which imports
// the engine — a cycle). index.ts registers its window here on create
// and clears it on close; sends are dropped harmlessly in between.

let mainWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win;
}

export function sendToMainWindow(channel: string, data: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}
