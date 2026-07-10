import React from 'react';
import ReactDOM from 'react-dom/client';
import { CoverApp } from './CoverApp';
import '../styles/index.css';
import type { CoverShowPayload, PomodoroTimerState } from '@shared/types';

// Mirror of the shape exposed by src/preload/cover.ts. Kept here (not
// imported) because the renderer tsconfig can't reach into src/preload.
export interface CoverApi {
  onShow: (cb: (payload: CoverShowPayload) => void) => () => void;
  onTick: (cb: (state: PomodoroTimerState) => void) => () => void;
  onHide: (cb: (payload: null) => void) => () => void;
  skipBreak: () => Promise<unknown>;
  extendWork: (minutes: number) => Promise<unknown>;
  startFocus: (workMinutes?: number) => Promise<unknown>;
  dismiss: () => Promise<unknown>;
  finishSession: () => Promise<unknown>;
}

declare global {
  interface Window {
    coverApi: CoverApi;
  }
}

// The cover follows the system theme. (The main window's theme setting
// can override to light/dark, but the cover has no settings access by
// design — system is the right default for a full-screen overlay.)
const mq = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () =>
  document.documentElement.classList.toggle('dark', mq.matches);
applyTheme();
mq.addEventListener('change', applyTheme);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CoverApp />
  </React.StrictMode>
);
