import { contextBridge, ipcRenderer } from 'electron';
import type { PomodoroTimerState } from '../shared/types';

// Bridge for the hold-to-peek pill. Read-only: it just listens.

const overlayApi = {
  onUpdate: (cb: (state: PomodoroTimerState) => void): (() => void) => {
    const listener = (_e: unknown, state: PomodoroTimerState) => cb(state);
    ipcRenderer.on('overlay:update', listener);
    return () => {
      ipcRenderer.removeListener('overlay:update', listener);
    };
  },
  // Transient warning flashes ("5 min left in this focus").
  onFlash: (cb: (message: string) => void): (() => void) => {
    const listener = (_e: unknown, message: string) => cb(message);
    ipcRenderer.on('overlay:flash', listener);
    return () => {
      ipcRenderer.removeListener('overlay:flash', listener);
    };
  },
};

export type OverlayApi = typeof overlayApi;

contextBridge.exposeInMainWorld('overlayApi', overlayApi);
