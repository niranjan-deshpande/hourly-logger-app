import { useEffect, useMemo, useState } from 'react';
import type { ActiveSession, Category } from '@shared/types';
import {
  formatDuration,
  formatTime,
  fromIso,
  parseTimeInput,
} from '../lib/time';

interface Props {
  session: ActiveSession;
  // We look up the bound category here just for display — even if it's
  // since been archived, we still want to show its color and name.
  allCategories: Category[];
  onSave: (endAt: Date) => void;
  onDiscard: () => void;
}

// Shown on app launch when an active session was left behind by a prior
// run. The user picks an end time (default: now) and commits as a real
// block, or discards. We deliberately make the user choose — silently
// keeping or silently discarding both feel wrong.
export function SessionRecoveryDialog({
  session,
  allCategories,
  onSave,
  onDiscard,
}: Props) {
  const start = fromIso(session.startAt);
  const category = allCategories.find((c) => c.id === session.categoryId);
  const elapsedSinceStart = Date.now() - start.getTime();
  const pomo = session.pomodoro ?? null;

  // Default end-time field to "now," but cap the default to 8h after
  // start. If the app was closed for two days, defaulting to "now" would
  // silently propose a 48-hour block, which is almost certainly wrong.
  //
  // Pomodoro sessions know more than plain recordings, so suggest
  // better: from 'awaiting', the walk-away rule applies (end when the
  // last break ended); from a running work/break phase, the phase would
  // have ended at phaseEndsAt — never suggest later than that. A paused
  // phase has no phaseEndsAt and falls back to the plain default.
  const defaultEnd = useMemo(() => {
    const now = new Date();
    const cap = new Date(start.getTime() + 8 * 60 * 60 * 1000);
    const plainDefault = now < cap ? now : cap;
    if (pomo) {
      if (pomo.phase === 'awaiting' && pomo.lastPhaseEndAt) {
        const lastEnd = fromIso(pomo.lastPhaseEndAt);
        return lastEnd < plainDefault ? lastEnd : plainDefault;
      }
      if (pomo.phaseEndsAt) {
        const phaseEnd = fromIso(pomo.phaseEndsAt);
        return phaseEnd < plainDefault ? phaseEnd : plainDefault;
      }
    }
    return plainDefault;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);

  const [endStr, setEndStr] = useState(() => formatHM(defaultEnd));
  const [error, setError] = useState<string | null>(null);

  // We parse end-time using the same day as the session's start, so a
  // user typing "11:30" gets that time on the session's start date —
  // not today.
  const endDate = useMemo(() => parseTimeInput(endStr, start), [endStr, start]);
  const proposedDuration =
    endDate && endDate > start ? endDate.getTime() - start.getTime() : null;

  // Esc → discard? That feels too destructive. Esc does nothing here —
  // the user has to make an explicit choice.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Enter') {
        if (endDate && endDate > start) onSave(endDate);
        else setError('End must be after start');
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [endDate, start, onSave]);

  const wasLongAgo = elapsedSinceStart > 8 * 60 * 60 * 1000;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/30"
      aria-modal
    >
      <div className="popover p-5 w-[420px]">
        <h2 className="text-base font-medium mb-1">
          Resume previous session?
        </h2>
        <p className="text-[12.5px] text-muted leading-snug">
          A recording was still running when Hourly Logger last closed.
          Save it as a block, or discard it.
        </p>

        <div className="mt-4 rounded-md border border-line p-3 bg-bg/40">
          <div className="flex items-center gap-2 text-[13px]">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: category?.color ?? '#5E5240' }}
              aria-hidden
            />
            <span className="font-medium">
              {category?.name ?? 'Uncategorized'}
            </span>
            {session.note && (
              <span className="text-muted truncate">· {session.note}</span>
            )}
          </div>
          <div className="mt-1 text-[12px] text-muted tabular-nums">
            Started {formatTime(start)} ·{' '}
            {formatDuration(elapsedSinceStart)} ago
          </div>
          {pomo && (
            <div className="mt-1 text-[12px] text-muted tabular-nums">
              🍅 Pomodoro · {pomo.repsCompleted} rep
              {pomo.repsCompleted === 1 ? '' : 's'} completed
              {pomo.phase === 'awaiting'
                ? ' · was between focuses'
                : ` · was in a ${pomo.phase === 'work' ? 'focus' : 'break'} phase`}
            </div>
          )}
        </div>

        <div className="mt-4 flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-[11px] uppercase tracking-wider text-faint mb-1">
              End time
            </label>
            <input
              className="input-bare w-full tabular-nums"
              value={endStr}
              onChange={(e) => {
                setEndStr(e.target.value);
                setError(null);
              }}
              spellCheck={false}
              autoFocus
            />
            <div className="mt-1 text-[10.5px] tabular-nums text-faint">
              {endDate ? formatTime(endDate) : '—'}
            </div>
          </div>
          <div className="pb-[18px] text-[12px] text-muted tabular-nums">
            {proposedDuration != null
              ? formatDuration(proposedDuration)
              : ''}
          </div>
        </div>

        {wasLongAgo && (
          <div className="mt-2 text-[11.5px] text-[#A66E5C] leading-snug">
            That's a long time — set the end time to when you actually
            stopped, or discard if this was forgotten.
          </div>
        )}

        {error && (
          <div className="mt-2 text-xs text-[#A66E5C]">{error}</div>
        )}

        <div className="mt-5 flex items-center justify-between gap-2">
          <button
            className="text-xs text-muted hover:text-[#A66E5C] underline"
            onClick={onDiscard}
          >
            Discard session
          </button>
          <button
            className="btn btn-primary text-sm"
            onClick={() => {
              if (!endDate || endDate <= start) {
                setError('End must be after start');
                return;
              }
              onSave(endDate);
            }}
          >
            Save as block
          </button>
        </div>
      </div>
    </div>
  );
}

function formatHM(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}`;
}
