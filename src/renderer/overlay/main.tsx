import React from 'react';
import ReactDOM from 'react-dom/client';
import { OverlayApp } from './OverlayApp';
import '../styles/index.css';
import type { PomodoroTimerState } from '@shared/types';

// Mirror of the shape exposed by src/preload/overlay.ts. Kept here (not
// imported) because the renderer tsconfig can't reach into src/preload.
export interface OverlayApi {
  onUpdate: (cb: (state: PomodoroTimerState) => void) => () => void;
  onFlash: (cb: (message: string) => void) => () => void;
}

declare global {
  interface Window {
    overlayApi: OverlayApi;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OverlayApp />
  </React.StrictMode>
);
