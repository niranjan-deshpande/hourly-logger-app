import type {
  ActiveSessionPomodoro,
  PomodoroTimerState,
} from '@shared/types';

// Small pieces shared by the toolbar pill, the recording editor and the
// timeline ghost when a pomodoro session is live.

// MM:SS (pomodoro phases never exceed an hour by validation: work ≤ 180
// min — show H:MM:SS past the hour just in case).
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

// One-line status for the current phase, countdown included.
export function pomodoroPhaseLabel(
  p: ActiveSessionPomodoro,
  timer: PomodoroTimerState
): string {
  if (p.phase === 'awaiting') return 'Break over — start next?';
  const clock = formatClock(timer.remaining);
  if (p.phase === 'break') return `Break ${clock}`;
  if (p.isPaused) return `Focus ${formatClock(p.pausedRemainingSeconds ?? 0)} ⏸`;
  return `Focus ${clock}`;
}

// Cycle-position dots, same arithmetic as the donor app: during the
// break after the Nth rep the Nth dot is filled; a full row means the
// long break.
export function PomodoroCycleDots({
  repsCompleted,
  pomodorosPerCycle,
}: {
  repsCompleted: number;
  pomodorosPerCycle: number;
}) {
  const filled =
    repsCompleted === 0 ? 0 : ((repsCompleted - 1) % pomodorosPerCycle) + 1;
  return (
    <span
      className="flex items-center gap-1"
      title={`${repsCompleted} pomodoro${repsCompleted === 1 ? '' : 's'} completed`}
      aria-label={`${repsCompleted} pomodoros completed`}
    >
      {Array.from({ length: pomodorosPerCycle }, (_, i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full"
          style={{
            background: i < filled ? '#A66E5C' : 'transparent',
            border: '1px solid #A66E5C',
            opacity: i < filled ? 1 : 0.45,
          }}
          aria-hidden
        />
      ))}
    </span>
  );
}
