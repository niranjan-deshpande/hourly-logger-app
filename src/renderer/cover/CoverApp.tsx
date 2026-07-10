import { useCallback, useEffect, useRef, useState } from 'react';
import type { CoverShowPayload, PomodoroTimerState } from '@shared/types';

// Full-screen break cover, ported from the standalone Pomodoro app.
// Two modes: 'break' (countdown ring, Skip Break, +5/+10/+15 more focus)
// and 'breakOver' (checkmark, Start Focus / Finish session / Not Yet).
//
// The window is focused by the main process when shown, so stray
// keystrokes land here and do nothing. Escape is the only shortcut
// (skip the break / dismiss the prompt). A 1.5s input grace period
// stops in-flight typing or clicking from triggering an action the
// instant the cover appears.

const CIRCUMFERENCE = 2 * Math.PI * 88; // matches the SVG circle r=88
const INPUT_GRACE_MS = 1500;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.max(0, Math.floor(seconds % 60));
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function CoverApp() {
  const [payload, setPayload] = useState<CoverShowPayload | null>(null);
  const [timer, setTimer] = useState<PomodoroTimerState | null>(null);
  const [visible, setVisible] = useState(false);
  const lockedRef = useRef(true);
  const [locked, setLocked] = useState(true);
  const unlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lockInput = useCallback(() => {
    lockedRef.current = true;
    setLocked(true);
    if (unlockTimer.current) clearTimeout(unlockTimer.current);
    unlockTimer.current = setTimeout(() => {
      lockedRef.current = false;
      setLocked(false);
    }, INPUT_GRACE_MS);
  }, []);

  useEffect(() => {
    const unsubShow = window.coverApi.onShow((p) => {
      setPayload(p);
      setTimer(p.mode === 'break' ? p.state : null);
      lockInput();
      requestAnimationFrame(() => setVisible(true));
    });
    const unsubTick = window.coverApi.onTick((state) => setTimer(state));
    const unsubHide = window.coverApi.onHide(() => setVisible(false));
    return () => {
      unsubShow();
      unsubTick();
      unsubHide();
      if (unlockTimer.current) clearTimeout(unlockTimer.current);
    };
  }, [lockInput]);

  // Fade out locally before invoking, so the action feels acknowledged.
  const act = useCallback((fn: () => void) => {
    if (lockedRef.current) return;
    lockedRef.current = true;
    setLocked(true);
    setVisible(false);
    setTimeout(fn, 200);
  }, []);

  const mode = payload?.mode ?? null;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      act(() => {
        if (modeRef.current === 'break') window.coverApi.skipBreak();
        else window.coverApi.dismiss();
      });
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [act]);

  if (!payload) return null;

  const { session } = payload;
  const fraction =
    timer && timer.total > 0 ? timer.remaining / timer.total : 1;
  const filledDots =
    session.repsCompleted === 0
      ? 0
      : ((session.repsCompleted - 1) % session.pomodorosPerCycle) + 1;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center transition-opacity duration-500"
      style={{
        background: 'var(--bg)',
        opacity: visible ? 0.97 : 0,
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <div
        className="flex flex-col items-center gap-5 transition-transform duration-500"
        style={{
          transform: visible
            ? 'translateY(0) scale(1)'
            : 'translateY(16px) scale(0.96)',
        }}
      >
        {/* Session context: what you're working on. */}
        <div className="flex items-center gap-2 text-sm text-muted">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: session.categoryColor }}
            aria-hidden
          />
          <span>{session.note?.trim() || session.categoryName}</span>
        </div>

        {payload.mode === 'break' ? (
          <>
            <p className="text-[13px] uppercase tracking-[0.18em] text-faint">
              {payload.breakType === 'long'
                ? 'Long Break — you earned it'
                : 'Break Time'}
            </p>
            <div className="relative w-[200px] h-[200px]">
              <svg className="w-full h-full" viewBox="0 0 200 200">
                <circle
                  cx="100"
                  cy="100"
                  r="88"
                  fill="none"
                  stroke="var(--line)"
                  strokeWidth="6"
                />
                <circle
                  cx="100"
                  cy="100"
                  r="88"
                  fill="none"
                  stroke="#A66E5C"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={CIRCUMFERENCE}
                  strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
                  transform="rotate(-90 100 100)"
                  style={{ transition: 'stroke-dashoffset 1s linear' }}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center text-4xl tabular-nums font-medium text-ink">
                {formatTime(timer?.remaining ?? 0)}
              </div>
            </div>
          </>
        ) : (
          <>
            <svg className="w-20 h-20" viewBox="0 0 80 80" aria-hidden>
              <circle
                cx="40"
                cy="40"
                r="36"
                fill="none"
                stroke="var(--line)"
                strokeWidth="3"
              />
              <circle cx="40" cy="40" r="36" fill="none" stroke="#A66E5C" strokeWidth="3" />
              <path
                d="M24 42 L35 53 L56 28"
                fill="none"
                stroke="#A66E5C"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <h1 className="text-xl font-medium text-ink">Break over!</h1>
            <p className="text-sm text-muted -mt-3">Ready to focus?</p>
          </>
        )}

        {/* Cycle dots */}
        <div className="flex items-center gap-2" aria-hidden>
          {Array.from({ length: session.pomodorosPerCycle }, (_, i) => (
            <span
              key={i}
              className="w-2 h-2 rounded-full"
              style={{
                background: i < filledDots ? '#A66E5C' : 'transparent',
                border: '1px solid #A66E5C',
                opacity: i < filledDots ? 1 : 0.4,
              }}
            />
          ))}
        </div>

        {/* Actions — dimmed and inert during the input grace period. */}
        <div
          className="flex flex-col items-center gap-4 transition-opacity"
          style={{
            opacity: locked ? 0.35 : 1,
            pointerEvents: locked ? 'none' : 'auto',
          }}
        >
          {payload.mode === 'break' ? (
            <>
              <button
                className="btn text-sm px-5 py-2"
                onClick={() => act(() => window.coverApi.skipBreak())}
              >
                Skip Break — back to focus
              </button>
              <div className="flex flex-col items-center gap-2">
                <span className="text-xs text-faint">
                  Need more focus time?
                </span>
                <div className="flex items-center gap-2">
                  {[5, 10, 15].map((m) => (
                    <button
                      key={m}
                      className="btn btn-ghost text-xs"
                      onClick={() =>
                        act(() => window.coverApi.extendWork(m))
                      }
                    >
                      +{m} min
                    </button>
                  ))}
                </div>
              </div>
              <button
                className="btn btn-ghost text-xs"
                onClick={() => act(() => window.coverApi.finishSession())}
                title="End the pomodoro sequence and save it as one block"
              >
                End sequence here
              </button>
            </>
          ) : (
            <>
              <button
                className="btn btn-primary text-sm px-5 py-2"
                onClick={() => act(() => window.coverApi.startFocus())}
              >
                Start Focus ({payload.focusMinutes} min)
              </button>
              <div className="flex items-center gap-1.5 text-xs text-faint">
                <span>or</span>
                {[25, 45, 50]
                  .filter((m) => m !== payload.focusMinutes)
                  .map((m) => (
                    <button
                      key={m}
                      className="btn btn-ghost text-xs"
                      onClick={() =>
                        act(() => window.coverApi.startFocus(m))
                      }
                      title={`Start a ${m}-minute focus instead (this rep only)`}
                    >
                      {m} min
                    </button>
                  ))}
              </div>
              <div className="flex items-center gap-3">
                <button
                  className="btn text-xs"
                  onClick={() => act(() => window.coverApi.finishSession())}
                  title="End the pomodoro session and save it as one block"
                >
                  End sequence here
                </button>
                <button
                  className="btn btn-ghost text-xs"
                  onClick={() => act(() => window.coverApi.dismiss())}
                >
                  Not Yet
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
