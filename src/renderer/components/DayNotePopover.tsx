import { useEffect, useRef, useState } from 'react';
import type { DayEnergy } from '@shared/types';
import { ENERGY_PRESETS } from '../lib/energy';
import { isoYmd, readableDate, sameDay } from '../lib/time';
import { withAlpha } from '../lib/colors';

interface Props {
  day: Date;
  onClose: () => void;
  // Called after any save so the opener can refresh its day-record state.
  onSaved?: () => void;
}

// A small dialog for the per-day reflection: tap how the day felt (one of
// five presets) and optionally jot a line or two. Energy saves on tap; the
// journal saves on close, only if it was actually edited.
export function DayNotePopover({ day, onClose, onSaved }: Props) {
  const date = isoYmd(day);
  const [energy, setEnergy] = useState<DayEnergy | null>(null);
  const [journal, setJournal] = useState('');
  const [error, setError] = useState<string | null>(null);
  const journalRef = useRef('');
  // Per-field "the user touched this" guards. They stop the async load from
  // clobbering an in-flight edit, and stop close from blanking an existing
  // journal that the user never touched.
  const energyTouched = useRef(false);
  const journalTouched = useRef(false);
  const isToday = sameDay(day, new Date());

  useEffect(() => {
    journalRef.current = journal;
  }, [journal]);

  useEffect(() => {
    let cancelled = false;
    window.api.days.get(date).then((rec) => {
      if (cancelled) return;
      if (!energyTouched.current) setEnergy(rec?.energy ?? null);
      if (!journalTouched.current) {
        setJournal(rec?.journal ?? '');
        journalRef.current = rec?.journal ?? '';
      }
    });
    return () => {
      cancelled = true;
    };
  }, [date]);

  const persist = async (patch: {
    energy?: DayEnergy | null;
    journal?: string | null;
  }) => {
    try {
      await window.api.days.upsert({ date, ...patch });
      setError(null);
      onSaved?.();
    } catch {
      setError('Couldn’t save — try again');
    }
  };

  const pickEnergy = (key: DayEnergy) => {
    energyTouched.current = true;
    const next = energy === key ? null : key;
    setEnergy(next);
    void persist({ energy: next });
  };

  const close = () => {
    // Only write the journal if it was edited — never blank an existing
    // note just because the popover was opened and closed.
    if (journalTouched.current) {
      void persist({ journal: journalRef.current.trim() || null });
    }
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-[55] flex items-start justify-center bg-black/10 pt-24"
      onMouseDown={close}
    >
      <div
        className="popover w-[380px] p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-medium">
          How did {isToday ? 'today' : readableDate(day)} feel?
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {ENERGY_PRESETS.map((p) => {
            const selected = energy === p.key;
            return (
              <button
                key={p.key}
                className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors"
                style={{
                  borderColor: selected ? p.color : 'var(--line)',
                  background: selected ? withAlpha(p.color, 0.16) : 'transparent',
                  color: selected ? 'var(--ink)' : 'var(--muted)',
                }}
                onClick={() => pickEnergy(p.key)}
                title={p.hint}
                aria-pressed={selected}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: p.color }}
                  aria-hidden
                />
                {p.label}
              </button>
            );
          })}
        </div>

        <textarea
          className="input-bare w-full mt-3"
          rows={3}
          maxLength={2000}
          value={journal}
          placeholder="A line or two about the day… (optional)"
          onChange={(e) => {
            journalTouched.current = true;
            setJournal(e.target.value);
          }}
        />

        <div className="mt-3 flex items-center justify-between">
          {error ? (
            <span className="text-[11px]" style={{ color: '#A66E5C' }}>
              {error}
            </span>
          ) : (
            <span className="text-[11px] text-faint">Saved automatically</span>
          )}
          <button className="btn btn-primary text-sm" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
