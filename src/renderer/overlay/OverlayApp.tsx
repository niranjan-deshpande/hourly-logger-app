import { useEffect, useState } from 'react';
import type { PomodoroTimerState } from '@shared/types';

// The hold-to-peek pill: shows the live pomodoro state while
// Ctrl+Option+P is held. The window is click-through and non-focusable;
// this component just renders whatever the main process pushes.

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.max(0, Math.floor(seconds % 60));
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function OverlayApp() {
  const [state, setState] = useState<PomodoroTimerState | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    const unsubUpdate = window.overlayApi.onUpdate((s) => setState(s));
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubFlash = window.overlayApi.onFlash((message) => {
      setFlash(message);
      if (timer) clearTimeout(timer);
      // Matches the main process's flash duration; clearing locally too
      // means a subsequent hotkey peek shows the plain pill again.
      timer = setTimeout(() => setFlash(null), 4500);
    });
    return () => {
      unsubUpdate();
      unsubFlash();
      if (timer) clearTimeout(timer);
    };
  }, []);

  const idle = !state || state.type === 'idle';
  const label = flash
    ? flash
    : idle
      ? 'No timer'
      : `${state!.type === 'work' ? 'Focus' : 'Break'}${
          state!.isPaused ? ' ⏸' : ''
        }`;
  const time = idle ? '--:--' : formatTime(state!.remaining);

  return (
    <div className="h-full w-full flex items-center justify-center">
      <div
        className="flex items-center gap-3 px-4 py-2.5 rounded-xl"
        style={{
          background: 'rgba(31, 26, 18, 0.85)',
          color: '#F1E9D5',
          backdropFilter: 'blur(8px)',
          // The warning flash gets an accent ring and a quick double
          // pulse — conspicuous for a moment, then it's gone.
          border: flash ? '1.5px solid #E8945A' : '1.5px solid transparent',
          animation: flash
            ? 'pill-enter 150ms ease-out, pill-pulse 700ms ease-in-out 2'
            : 'pill-enter 150ms ease-out',
        }}
      >
        <span
          className="text-xs uppercase tracking-wider"
          style={{ opacity: flash ? 1 : 0.8, color: flash ? '#E8945A' : undefined }}
        >
          {flash ? '⏰ ' : ''}
          {label}
        </span>
        {!flash && (
          <span
            className="text-base tabular-nums"
            style={{ fontFamily: 'ui-monospace, SF Mono, Menlo, monospace' }}
          >
            {time}
          </span>
        )}
      </div>
      <style>{`
        @keyframes pill-enter {
          from { transform: scale(0.85); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        @keyframes pill-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.06); }
        }
      `}</style>
    </div>
  );
}
