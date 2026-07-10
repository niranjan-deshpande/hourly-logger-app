import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  Block,
  BlockKind,
  AliasEntry,
  CaptureCommitResult,
  CaptureDraft,
  Category,
  CommitDraft,
} from '@shared/types';
import { parseDay, proposeCategoryName } from '../lib/capture/parse';
import { nextColor } from '../lib/colors';
import {
  endOfLocalDay,
  formatDuration,
  fromIso,
  fromIsoYmd,
  isoYmd,
  parseTimeInput,
  readableDate,
  startOfLocalDay,
  toIso,
} from '../lib/time';
import { CategoryCombobox } from './CategoryCombobox';

interface Props {
  // The day capture targets by default (the day the user is viewing).
  day: Date;
  // Active (non-archived) categories — used both to match phrases and to
  // pick from in the review rows.
  categories: Category[];
  onClose: () => void;
  onCommitted: (result: CaptureCommitResult) => void;
}

// Is a draft complete enough to commit? (Live — recomputed from current
// field values, not the parser's initial warnings.)
function committable(d: CaptureDraft): boolean {
  if (!d.startAt || !d.endAt) return false;
  if (fromIso(d.endAt) <= fromIso(d.startAt)) return false;
  if (d.categoryId == null && !(d.newCategoryName && d.newCategoryName.trim()))
    return false;
  return true;
}

export function CaptureModal({ day, categories, onClose, onCommitted }: Props) {
  const [rawText, setRawText] = useState('');
  const [targetDay, setTargetDay] = useState<Date>(() => startOfLocalDay(day));
  const [kind, setKind] = useState<BlockKind>('actual');
  const [drafts, setDrafts] = useState<CaptureDraft[]>([]);
  const [leftovers, setLeftovers] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [existingBlocks, setExistingBlocks] = useState<Block[]>([]);
  const [aliases, setAliases] = useState<AliasEntry[]>([]);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  // Once the user edits a row, async reference-data arrival (aliases,
  // existingBlocks) must not regenerate the drafts and wipe their work.
  const dirtyRef = useRef(false);
  const lastTextRef = useRef<string | null>(null);
  const lastDayRef = useRef<number | null>(null);

  useEffect(() => {
    textRef.current?.focus();
  }, []);

  // Learned aliases (once).
  useEffect(() => {
    let cancelled = false;
    window.api.aliases
      .get()
      .then((a) => !cancelled && setAliases(a))
      .catch(() => !cancelled && setAliases([]));
    return () => {
      cancelled = true;
    };
  }, []);

  // Existing blocks for the target day — feeds overlap warnings.
  useEffect(() => {
    let cancelled = false;
    window.api.blocks
      .listByRange({
        from: toIso(startOfLocalDay(targetDay)),
        to: toIso(endOfLocalDay(targetDay)),
      })
      .then((b) => !cancelled && setExistingBlocks(b))
      .catch(() => !cancelled && setExistingBlocks([]));
    return () => {
      cancelled = true;
    };
  }, [targetDay]);

  // Re-parse from the user's authored inputs (text + target day). The
  // reference data (categories/existingBlocks/aliases) also lands here so
  // matches and warnings refresh when it loads — but if only that data
  // changed AND the user has already edited rows, we skip, so async
  // arrivals (or App re-renders) never clobber in-progress edits.
  useEffect(() => {
    const textOrDayChanged =
      lastTextRef.current !== rawText ||
      lastDayRef.current !== targetDay.getTime();
    if (!textOrDayChanged && dirtyRef.current) return;
    lastTextRef.current = rawText;
    lastDayRef.current = targetDay.getTime();
    dirtyRef.current = false;
    const res = parseDay({
      text: rawText,
      targetDay,
      now: new Date(),
      categories,
      existingBlocks,
      aliases,
    });
    setDrafts(res.drafts);
    setLeftovers(res.leftovers);
    setExcluded(new Set());
  }, [rawText, targetDay, categories, existingBlocks, aliases]);

  const updateDraft = (tempId: string, patch: Partial<CaptureDraft>) => {
    dirtyRef.current = true;
    setDrafts((ds) =>
      ds.map((d) => (d.tempId === tempId ? { ...d, ...patch } : d))
    );
  };

  const toggleInclude = (tempId: string) => {
    dirtyRef.current = true;
    setExcluded((cur) => {
      const next = new Set(cur);
      if (next.has(tempId)) next.delete(tempId);
      else next.add(tempId);
      return next;
    });
  };

  const removeDraft = (tempId: string) => {
    dirtyRef.current = true;
    setDrafts((ds) => ds.filter((x) => x.tempId !== tempId));
  };

  const commitList: CommitDraft[] = useMemo(() => {
    const usedColors = categories.map((c) => c.color);
    return drafts
      .filter((d) => !excluded.has(d.tempId) && committable(d))
      .map((d) => ({
        startAt: d.startAt!,
        endAt: d.endAt!,
        categoryId: d.categoryId,
        newCategory:
          d.categoryId == null
            ? {
                name: d.newCategoryName!.trim(),
                color: d.newCategoryColor ?? nextColor(usedColors),
              }
            : null,
        note: d.note,
        kind,
        rawPhrase: d.rawPhrase,
        teach: d.taught,
      }));
  }, [drafts, excluded, kind, categories]);

  async function commit() {
    if (commitList.length === 0) return;
    setCommitting(true);
    setError(null);
    try {
      const result = await window.api.capture.commit({ drafts: commitList });
      onCommitted(result);
    } catch (e: any) {
      setError(e?.message ?? 'Could not add blocks');
    } finally {
      setCommitting(false);
    }
  }

  const count = commitList.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/15 pt-14 pb-8"
      onKeyDown={(e) => {
        // Stop keystrokes from reaching the window-level global shortcuts
        // (1/2 view switch, arrows, t, ?) while the modal is open — they'd
        // otherwise fire behind it when focus is on a non-text element.
        // The reused CategoryCombobox stops its own keys before they reach
        // here, so this doesn't interfere with it.
        e.stopPropagation();
        if (e.key === 'Escape') {
          onClose();
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          commit();
        }
      }}
    >
      <div className="popover w-[640px] max-h-[82vh] overflow-y-auto p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-lg font-medium">Quick capture</div>
            <div className="text-xs text-faint">
              Describe how the day went — one line, or many.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <button
                className={`tag-pill ${kind === 'actual' ? 'active' : ''}`}
                onClick={() => setKind('actual')}
                title="Log these as Actual blocks"
              >
                Actual
              </button>
              <button
                className={`tag-pill ${kind === 'plan' ? 'active' : ''}`}
                onClick={() => setKind('plan')}
                title="Log these as Plan blocks"
              >
                Plan
              </button>
            </div>
          </div>
        </div>

        {/* Target day */}
        <div className="mt-4 flex items-center gap-2 text-sm">
          <span className="text-muted">Logging to</span>
          <span className="font-medium">{readableDate(targetDay)}</span>
          <input
            type="date"
            className="input-bare tabular-nums"
            value={isoYmd(targetDay)}
            onChange={(e) => {
              if (e.target.value)
                setTargetDay(startOfLocalDay(fromIsoYmd(e.target.value)));
            }}
          />
        </div>

        {/* Input */}
        <textarea
          ref={textRef}
          className="input-bare w-full mt-3 font-normal"
          rows={4}
          value={rawText}
          placeholder={'e.g. 9-11 deep work on pricing, coffee till 11:30, lunch, 1-4 interviews'}
          onChange={(e) => setRawText(e.target.value)}
        />
        <div className="mt-1.5 text-[11px] text-faint leading-snug">
          Times like <span className="font-mono">9</span>,{' '}
          <span className="font-mono">9:30am</span>,{' '}
          <span className="font-mono">1-4</span>,{' '}
          <span className="font-mono">till noon</span>,{' '}
          <span className="font-mono">30m</span>. Separate activities with
          commas, “then”, or new lines.
        </div>

        {/* Review list */}
        {drafts.length > 0 && (
          <div className="mt-5 space-y-1.5">
            <div className="text-[11px] uppercase tracking-wider text-faint">
              {count} block{count === 1 ? '' : 's'} to add
            </div>
            {drafts.map((d) => (
              <CaptureRow
                key={d.tempId}
                draft={d}
                categories={categories}
                included={!excluded.has(d.tempId)}
                targetDay={targetDay}
                onToggleInclude={() => toggleInclude(d.tempId)}
                onChange={(patch) => updateDraft(d.tempId, patch)}
                onRemove={() => removeDraft(d.tempId)}
              />
            ))}
          </div>
        )}

        {leftovers.length > 0 && (
          <div className="mt-3 text-[11px] text-faint">
            Couldn’t read:{' '}
            <span className="italic">{leftovers.join(' · ')}</span>
          </div>
        )}

        {rawText.trim() && drafts.length === 0 && (
          <div className="mt-4 text-xs text-faint">
            Nothing recognized yet — try adding a time, like “9-11 emails”.
          </div>
        )}

        {error && (
          <div className="mt-3 text-xs" style={{ color: '#A66E5C' }}>
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={commit}
            disabled={count === 0 || committing}
          >
            {committing ? 'Adding…' : `Add ${count} block${count === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

const WARN_LABELS: Record<string, string> = {
  overlaps: 'overlaps',
  'ended now': 'ended now',
  'in the future': 'in the future',
};

function CaptureRow({
  draft,
  categories,
  included,
  targetDay,
  onToggleInclude,
  onChange,
  onRemove,
}: {
  draft: CaptureDraft;
  categories: Category[];
  included: boolean;
  targetDay: Date;
  onToggleInclude: () => void;
  onChange: (patch: Partial<CaptureDraft>) => void;
  onRemove: () => void;
}) {
  // Live structural warnings, recomputed from current values.
  const warnings: string[] = [];
  if (!draft.startAt) warnings.push('needs start');
  if (!draft.endAt) warnings.push('needs end');
  if (
    draft.startAt &&
    draft.endAt &&
    fromIso(draft.endAt) <= fromIso(draft.startAt)
  )
    warnings.push('end before start');
  if (
    draft.categoryId == null &&
    !(draft.newCategoryName && draft.newCategoryName.trim())
  )
    warnings.push('needs category');
  if (draft.warnings.includes('overlaps-existing')) warnings.push('overlaps');
  if (draft.warnings.includes('clamped-to-now')) warnings.push('ended now');
  if (draft.warnings.includes('in-future')) warnings.push('in the future');

  const duration =
    draft.startAt && draft.endAt && fromIso(draft.endAt) > fromIso(draft.startAt)
      ? formatDuration(fromIso(draft.endAt).getTime() - fromIso(draft.startAt).getTime())
      : '';

  return (
    <div
      className="surface-card px-3 py-2"
      style={{ opacity: included ? 1 : 0.45 }}
      title={draft.rawText}
    >
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={included}
          onChange={onToggleInclude}
          aria-label="Include this block"
        />
        <TimeField
          iso={draft.startAt}
          targetDay={targetDay}
          placeholder="start"
          onCommit={(iso) => onChange({ startAt: iso })}
        />
        <span className="text-faint">–</span>
        <TimeField
          iso={draft.endAt}
          targetDay={targetDay}
          placeholder="end"
          onCommit={(iso) => onChange({ endAt: iso })}
        />
        <span className="text-[11px] text-faint tabular-nums w-12 shrink-0">
          {duration}
        </span>
        <div className="flex-1 min-w-0">
          <CategoryCell
            draft={draft}
            categories={categories}
            onChange={onChange}
          />
        </div>
        <button
          className="btn btn-ghost p-1 text-faint shrink-0"
          onClick={onRemove}
          aria-label="Remove this block"
          title="Remove"
        >
          ✕
        </button>
      </div>
      <div className="flex items-center gap-2 mt-1.5 pl-7">
        <input
          className="input-bare flex-1 min-w-0 text-[12.5px]"
          value={draft.note ?? ''}
          placeholder="note (optional)"
          onChange={(e) => onChange({ note: e.target.value || null })}
        />
        {draft.viaAlias && draft.categoryId != null && !draft.taught && (
          <span
            className="text-[10.5px] text-faint shrink-0"
            title="Auto-filled from a phrase you assigned before"
          >
            remembered
          </span>
        )}
        {warnings.map((w) => (
          <span
            key={w}
            className="text-[10.5px] tabular-nums shrink-0"
            style={{ color: '#A66E5C' }}
          >
            {WARN_LABELS[w] ?? w}
          </span>
        ))}
      </div>
    </div>
  );
}

function CategoryCell({
  draft,
  categories,
  onChange,
}: {
  draft: CaptureDraft;
  categories: Category[];
  onChange: (patch: Partial<CaptureDraft>) => void;
}) {
  // "Creating a new category" is derived from the draft (no local state),
  // so a re-parse can't leave the cell stuck in the wrong mode. Picking an
  // EXISTING category is the default; creating one is opt-in via "+ new".
  const creating = draft.newCategoryName != null;

  if (!creating) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="flex-1 min-w-0">
          <CategoryCombobox
            categories={categories}
            value={draft.categoryId}
            onChange={(id) =>
              onChange({
                categoryId: id,
                newCategoryName: null,
                newCategoryColor: null,
                taught: true,
              })
            }
            placeholder="Pick category…"
          />
        </div>
        <button
          className="text-[11px] text-faint hover:text-muted shrink-0"
          onClick={() =>
            onChange({
              categoryId: null,
              newCategoryName: proposeCategoryName(draft.note ?? draft.rawText),
              newCategoryColor: nextColor(categories.map((c) => c.color)),
              taught: true,
            })
          }
          title="Create a new category"
        >
          + new
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <span
        className="w-2.5 h-2.5 rounded-full shrink-0"
        style={{ background: draft.newCategoryColor ?? '#B0512F' }}
        aria-hidden
      />
      <input
        className="input-bare flex-1 min-w-0 text-sm"
        value={draft.newCategoryName ?? ''}
        placeholder="New category name"
        autoFocus
        onChange={(e) =>
          onChange({ newCategoryName: e.target.value, taught: true })
        }
      />
      <button
        className="text-[11px] text-faint hover:text-muted shrink-0"
        onClick={() => onChange({ newCategoryName: null, newCategoryColor: null })}
        title="Pick an existing category instead"
      >
        existing
      </button>
    </div>
  );
}

function TimeField({
  iso,
  targetDay,
  placeholder,
  onCommit,
}: {
  iso: string | null;
  targetDay: Date;
  placeholder: string;
  onCommit: (iso: string | null) => void;
}) {
  const [str, setStr] = useState(iso ? hhmm(iso) : '');
  useEffect(() => {
    setStr(iso ? hhmm(iso) : '');
  }, [iso]);

  return (
    <input
      className="input-bare w-[64px] tabular-nums text-center shrink-0"
      value={str}
      placeholder={placeholder}
      onChange={(e) => setStr(e.target.value)}
      onBlur={() => {
        const t = str.trim();
        if (!t) {
          onCommit(null);
          return;
        }
        const d = parseTimeInput(t, targetDay);
        if (d) onCommit(d.toISOString());
        // Unparseable: snap back to the last valid value, so the field can
        // never display one time while the row commits another.
        else setStr(iso ? hhmm(iso) : '');
      }}
    />
  );
}

function hhmm(iso: string): string {
  const d = fromIso(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
