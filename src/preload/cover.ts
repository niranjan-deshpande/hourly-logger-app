import { contextBridge, ipcRenderer } from 'electron';
import type { CoverShowPayload, PomodoroTimerState } from '../shared/types';

// Minimal bridge for the break-cover windows. Deliberately narrow: the
// covers can act on the running pomodoro but can't touch the database,
// settings, or anything else window.api exposes to the main window.

async function call<T>(channel: string, arg?: unknown): Promise<T> {
  const res = await ipcRenderer.invoke(channel, arg);
  if (res && typeof res === 'object' && 'ok' in res) {
    if (res.ok) return res.value as T;
    throw new Error(res.reason);
  }
  return res as T;
}

function on<T>(channel: string) {
  return (cb: (payload: T) => void): (() => void) => {
    const listener = (_e: unknown, payload: T) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  };
}

const coverApi = {
  onShow: on<CoverShowPayload>('cover:show'),
  onTick: on<PomodoroTimerState>('cover:tick'),
  onHide: on<null>('cover:hide'),
  skipBreak: () => call<unknown>('pomodoro.skipBreak'),
  extendWork: (minutes: number) =>
    call<unknown>('pomodoro.extendWork', { minutes }),
  // Optional one-shot length for the rep being started from the cover.
  startFocus: (workMinutes?: number) =>
    call<unknown>(
      'pomodoro.startNextRep',
      workMinutes ? { workMinutes } : undefined
    ),
  dismiss: () => call<unknown>('pomodoro.dismissBreakOver'),
  finishSession: () => call<unknown>('pomodoro.finish'),
};

export type CoverApi = typeof coverApi;

contextBridge.exposeInMainWorld('coverApi', coverApi);
