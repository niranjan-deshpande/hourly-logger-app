import { useEffect, useRef, useState } from 'react';
import type {
  ActiveSession,
  AppSettings,
  Block,
  Category,
  DayRecord,
  PomodoroSnapshot,
} from '@shared/types';
import { fromIso, isoYmd } from '../lib/time';
import { energyPreset } from '../lib/energy';
import { SessionStartPopover } from './SessionStartPopover';
import { DayNotePopover } from './DayNotePopover';
import { PomodoroCycleDots, formatClock, pomodoroPhaseLabel } from './pomodoroUi';

interface Props {
  // Active categories shown in the Start-session popover.
  activeCategories: Category[];
  // Blocks for the visible day — used to compute the count of
  // Done-eligible plan blocks (Mirror button enable state).
  eligiblePlanBlocks: Block[];
  onMirrorPlan: () => Promise<void> | void;
  // When non-null, an in-toolbar status pill appears with this message
  // — set by DayView after a Mirror partial failure.
  mirrorError: string | null;
  // Plan-column visibility. Hidden in narrow windows; user can toggle.
  showPlan: boolean;
  canShowPlan: boolean; // false when the window is too narrow to allow both
  onToggleShowPlan: () => void;
  // Live recording session controls — moved here from the old QuickAddBar.
  activeSession: ActiveSession | null;
  // Live pomodoro snapshot (countdown etc.); only meaningful when
  // activeSession?.pomodoro is set.
  pomodoro: PomodoroSnapshot | null;
  // Pomodoro defaults for the start popover.
  settings: AppSettings;
  onStartSession: (input: {
    categoryId: number;
    note: string | null;
    pomodoro?: {
      workMinutes: number;
      breakMinutes: number;
      pomodorosPerCycle: number;
    };
  }) => Promise<void> | void;
  onFinishSession: () => Promise<void> | void;
  // Open quick capture (natural-language logging; also the `N` shortcut).
  onOpenCapture: () => void;
  // The day being viewed — for the per-day energy/journal "Feel" control.
  day: Date;
}

// The day view's thin top strip. Two lane headers ("Plan" / "Actual"),
// the Mirror plan to now button (Actual side, when applicable), and
// the recording Start / Finish control. Replaces the old QuickAddBar.
export function DayToolbar({
  activeCategories,
  eligiblePlanBlocks,
  onMirrorPlan,
  mirrorError,
  showPlan,
  canShowPlan,
  onToggleShowPlan,
  activeSession,
  pomodoro,
  settings,
  onStartSession,
  onFinishSession,
  onOpenCapture,
  day,
}: Props) {
  const [showStartPopover, setShowStartPopover] = useState(false);
  const [showDayNote, setShowDayNote] = useState(false);
  const [dayRecord, setDayRecord] = useState<DayRecord | null>(null);

  // The day's energy/journal, refetched when the day changes (and after a
  // save). Independent of block data.
  useEffect(() => {
    let cancelled = false;
    window.api.days
      .get(isoYmd(day))
      .then((rec) => !cancelled && setDayRecord(rec))
      .catch(() => !cancelled && setDayRecord(null));
    return () => {
      cancelled = true;
    };
  }, [day]);

  const reloadDayRecord = () => {
    window.api.days.get(isoYmd(day)).then(setDayRecord).catch(() => {});
  };

  const feel = energyPreset(dayRecord?.energy);
  const hasJournal = !!dayRecord?.journal?.trim();

  // Live tick for the Finish pill — one update per second is plenty
  // for an MM:SS readout, and only runs while a session is active.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!activeSession) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [activeSession]);

  const eligibleCount = eligiblePlanBlocks.length;
  const rootRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={rootRef}
      className="relative border-b border-line bg-bg flex items-stretch min-h-[40px]"
    >
      {/* Left spacer matching the timeline's LABEL_W (the hour-label
          gutter). Keeps the toolbar's Plan/Actual divider aligned with
          the timeline's lane divider underneath. Only needed when the
          Plan lane is showing — without Plan, the toolbar has no
          divider to align. */}
      {showPlan && (
        <div style={{ width: 56, flexShrink: 0 }} aria-hidden />
      )}

      {/* PLAN side. Hidden when collapsed; otherwise just a label.
          The Hide toggle is ALWAYS available when the Plan column is
          visible — gating it on canShowPlan would trap the user in
          narrow-window-with-manual-override mode.
          NOTE: no `border-r` here — the divider is rendered separately
          as an absolutely-positioned 1px element below, using the SAME
          `calc(50% + LABEL_W/2)` math as the timeline's divider. With
          box-sizing: border-box, a border-r would sit one pixel to the
          left of the timeline divider; a positioned element avoids the
          off-by-one. */}
      {showPlan && (
        <div
          className="flex-1 min-w-0 flex items-center px-4"
          style={{ background: 'var(--surface)' }}
        >
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: 'var(--faint)' }}
              aria-hidden
            />
            Plan
          </div>
          <button
            className="ml-auto text-[11px] text-faint hover:text-muted"
            onClick={onToggleShowPlan}
            title="Hide the Plan column"
          >
            Hide
          </button>
        </div>
      )}

      {/* ACTUAL side. When Plan is hidden, this row takes the full width. */}
      <div className="flex-1 min-w-0 flex items-center px-4 gap-3">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: '#A66E5C' }}
            aria-hidden
          />
          Actual
        </div>

        <div className="ml-auto flex items-center gap-2 shrink-0 whitespace-nowrap">
          {/* Per-day reflection: how the day felt + a short journal note. */}
          <button
            className="btn btn-ghost text-xs flex items-center gap-1.5"
            onClick={() => setShowDayNote(true)}
            title="How did this day feel? Add a note"
          >
            {feel ? (
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: feel.color }}
                aria-hidden
              />
            ) : null}
            <span>{feel ? feel.label : 'Feel'}</span>
            {hasJournal && <span className="text-faint" aria-hidden>·</span>}
          </button>
          {/* Quick capture: natural-language logging. Also bound to `N`. */}
          <button
            className="btn btn-ghost text-xs"
            onClick={onOpenCapture}
            title="Quick capture — type how the day went (N)"
          >
            Capture
          </button>
          {mirrorError && (
            <span
              className="text-[11px] tabular-nums"
              style={{ color: '#A66E5C' }}
              role="status"
            >
              {mirrorError}
            </span>
          )}
          {/* Show Plan toggle when the lane is currently hidden but
              the window is wide enough to show it. */}
          {!showPlan && canShowPlan && (
            <button
              className="btn btn-ghost text-xs"
              onClick={onToggleShowPlan}
              title="Show the Plan column"
            >
              Show plan
            </button>
          )}

          {/* Mirror plan to now — only shown when there's something to
              mirror. Otherwise hidden so the toolbar stays quiet. */}
          {eligibleCount > 0 && (
            <button
              className="btn text-xs flex items-center gap-1.5"
              onClick={() => onMirrorPlan()}
              title={`Copy ${eligibleCount} unmirrored plan block${
                eligibleCount === 1 ? '' : 's'
              } into Actual`}
            >
              <span aria-hidden>↳</span>
              <span>Mirror plan to now</span>
              <span className="tabular-nums text-faint">
                ({eligibleCount})
              </span>
            </button>
          )}

          {/* Start session / Finish pill. Same control we had in the old
              QuickAddBar, just relocated. Pomodoro sessions get a richer
              strip: cycle dots, phase + countdown, pause/resume or
              start-next, then Finish. */}
          {activeSession?.pomodoro && pomodoro ? (
            <div className="flex items-center gap-2">
              <PomodoroCycleDots
                repsCompleted={activeSession.pomodoro.repsCompleted}
                pomodorosPerCycle={activeSession.pomodoro.pomodorosPerCycle}
              />
              <span
                className="text-xs tabular-nums text-muted"
                role="status"
                title="Pomodoro session"
              >
                {pomodoroPhaseLabel(activeSession.pomodoro, pomodoro.timer)}
              </span>
              {activeSession.pomodoro.phase === 'work' &&
                (activeSession.pomodoro.isPaused ? (
                  <button
                    className="btn btn-ghost text-xs"
                    onClick={() => window.api.pomodoro.resume()}
                    title="Resume the focus timer"
                  >
                    Resume
                  </button>
                ) : (
                  <button
                    className="btn btn-ghost text-xs"
                    onClick={() => window.api.pomodoro.pause()}
                    title="Pause the focus timer"
                  >
                    Pause
                  </button>
                ))}
              {activeSession.pomodoro.phase === 'awaiting' && (
                <button
                  className="btn text-xs"
                  onClick={() => window.api.pomodoro.startNextRep()}
                  title={`Start the next ${activeSession.pomodoro.workMinutes}-minute focus`}
                >
                  Start next focus
                </button>
              )}
              <button
                className="btn text-sm flex items-center gap-1.5"
                style={{
                  background: '#A66E5C',
                  borderColor: '#A66E5C',
                  color: 'var(--bg)',
                }}
                onClick={onFinishSession}
                title="Finish the pomodoro session and save as one block"
              >
                <span
                  className="w-2 h-2 rounded-[2px]"
                  style={{ background: 'var(--bg)' }}
                  aria-hidden
                />
                <span>Finish</span>
              </button>
            </div>
          ) : activeSession ? (
            <button
              className="btn text-sm flex items-center gap-1.5"
              style={{
                background: '#A66E5C',
                borderColor: '#A66E5C',
                color: 'var(--bg)',
              }}
              onClick={onFinishSession}
              title="Finish recording and save as a block"
            >
              <span
                className="w-2 h-2 rounded-[2px]"
                style={{ background: 'var(--bg)' }}
                aria-hidden
              />
              <span>Finish</span>
              <span className="tabular-nums opacity-80">
                {formatElapsedClock(activeSession.startAt)}
              </span>
            </button>
          ) : (
            <button
              className="btn text-sm flex items-center gap-1.5"
              onClick={() => setShowStartPopover(true)}
              title="Start a new live session"
            >
              <span
                className="w-0 h-0"
                style={{
                  borderLeft: '6px solid currentColor',
                  borderTop: '4px solid transparent',
                  borderBottom: '4px solid transparent',
                }}
                aria-hidden
              />
              <span>Start session</span>
            </button>
          )}
        </div>
      </div>

      {/* Absolutely-positioned Plan/Actual divider — uses the SAME
          calc as the timeline's divider in Timeline.tsx so they share a
          pixel column. This is the visible separator; the Plan flex
          item has no border-r to avoid an off-by-one. */}
      {showPlan && (
        <div
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{
            left: `calc(50% + 28px)`,
            width: 1,
            background: 'var(--line)',
          }}
          aria-hidden
        />
      )}

      {showStartPopover && (
        <SessionStartPopover
          categories={activeCategories}
          anchorRight={16}
          anchorTop={44}
          pomodoroDefaults={{
            workMinutes: settings.pomodoroWorkMinutes,
            breakMinutes: settings.pomodoroBreakMinutes,
            pomodorosPerCycle: settings.pomodorosPerCycle,
          }}
          onCancel={() => setShowStartPopover(false)}
          onStart={async (input) => {
            setShowStartPopover(false);
            await onStartSession(input);
          }}
        />
      )}

      {showDayNote && (
        <DayNotePopover
          day={day}
          onClose={() => setShowDayNote(false)}
          onSaved={reloadDayRecord}
        />
      )}
    </div>
  );
}

// MM:SS for sub-hour sessions, H:MM:SS once we cross an hour.
function formatElapsedClock(startIso: string): string {
  const ms = Date.now() - fromIso(startIso).getTime();
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
