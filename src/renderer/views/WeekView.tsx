import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppSettings, Block, Category, DayRecord } from '@shared/types';
import {
  endOfLocalDay,
  formatDuration,
  formatHourLabel,
  fromIso,
  isoYmd,
  overlapMsWithin,
  sameDay,
  startOfLocalDay,
  toIso,
  weekDays,
} from '../lib/time';
import { withAlpha } from '../lib/colors';
import { energyPreset } from '../lib/energy';
import { DayNotePopover } from '../components/DayNotePopover';

interface Props {
  // The anchor date — the Monday-start week containing it is shown.
  day: Date;
  settings: AppSettings;
  allCategories: Category[];
  filterCategoryId: number | null;
  dataVersion: number;
  // Drill into the full Day view for a date (header or block click).
  onOpenDay: (d: Date) => void;
}

const HOUR_HEIGHT = 40;
const LABEL_W = 44;
const HEADER_H = 60;

interface Positioned {
  block: Block;
  top: number;
  height: number;
  col: number;
  cols: number;
}

export function WeekView({
  day,
  settings,
  allCategories,
  filterCategoryId,
  dataVersion,
  onOpenDay,
}: Props) {
  const dayStart = settings.dayStartHour;
  const dayEnd = settings.dayEndHour;
  const hours = Math.max(1, dayEnd - dayStart);
  const bodyHeight = hours * HOUR_HEIGHT;

  const days = useMemo(() => weekDays(day), [day]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [dayRecords, setDayRecords] = useState<Map<string, DayRecord>>(
    new Map()
  );
  const [noteDay, setNoteDay] = useState<Date | null>(null);

  const rangeFrom = toIso(startOfLocalDay(days[0]));
  const rangeTo = toIso(endOfLocalDay(days[6]));

  useEffect(() => {
    let cancelled = false;
    window.api.blocks
      .listByRange({ from: rangeFrom, to: rangeTo })
      .then((b) => !cancelled && setBlocks(b))
      .catch(() => !cancelled && setBlocks([]));
    return () => {
      cancelled = true;
    };
  }, [rangeFrom, rangeTo, dataVersion]);

  const reloadDays = useCallback(() => {
    window.api.days
      .listByRange({ from: isoYmd(days[0]), to: isoYmd(days[6]) })
      .then((recs) => setDayRecords(new Map(recs.map((r) => [r.date, r]))))
      .catch(() => {});
  }, [days]);

  useEffect(() => {
    reloadDays();
  }, [reloadDays, dataVersion]);

  const catColor = useCallback(
    (id: number) => allCategories.find((c) => c.id === id)?.color ?? '#A89F8A',
    [allCategories]
  );
  const catName = useCallback(
    (id: number) => allCategories.find((c) => c.id === id)?.name ?? '',
    [allCategories]
  );

  // Actual blocks only — the week texture is about lived time, and showing
  // a single lane keeps the grid legible (and clear of any plan-vs-actual
  // framing). Filter by category if one is active.
  const actualBlocks = useMemo(
    () =>
      blocks.filter(
        (b) =>
          b.kind !== 'plan' &&
          (filterCategoryId == null || b.category_id === filterCategoryId)
      ),
    [blocks, filterCategoryId]
  );

  const now = new Date();

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex min-w-full">
        {/* Hour gutter */}
        <div style={{ width: LABEL_W }} className="shrink-0">
          <div
            className="sticky top-0 z-10 bg-bg border-b border-line"
            style={{ height: HEADER_H }}
          />
          <div className="relative" style={{ height: bodyHeight }}>
            {Array.from({ length: hours }, (_, i) => (
              <div
                key={i}
                className="absolute left-0 right-0 text-[10px] uppercase tracking-wider text-faint pl-2"
                style={{ top: i * HOUR_HEIGHT, height: HOUR_HEIGHT }}
              >
                {formatHourLabel(dayStart + i)}
              </div>
            ))}
          </div>
        </div>

        {/* Seven day columns */}
        {days.map((d) => {
          const isToday = sameDay(d, now);
          const colStart = startOfLocalDay(d);
          const dayStartMs = colStart.getTime();
          const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;
          // Assign a block to this column when it OVERLAPS the local day —
          // so a block crossing midnight shows (clipped) in both days, and
          // a block straddling the week's first morning isn't dropped.
          const dayBlocks = actualBlocks.filter(
            (b) => overlapMsWithin(b.start_at, b.end_at, dayStartMs, dayEndMs) > 0
          );
          const positioned = layoutColumn(dayBlocks, colStart, dayStart, hours);
          const totalMs = dayBlocks.reduce(
            (a, b) => a + overlapMsWithin(b.start_at, b.end_at, dayStartMs, dayEndMs),
            0
          );
          const rec = dayRecords.get(isoYmd(d));
          const feel = energyPreset(rec?.energy);
          const nowY =
            isToday && now >= colStart
              ? (now.getHours() + now.getMinutes() / 60 - dayStart) * HOUR_HEIGHT
              : null;

          return (
            <div key={isoYmd(d)} className="flex-1 min-w-0 border-l border-line">
              {/* Header (sticky) */}
              <div
                className="sticky top-0 z-10 bg-bg border-b border-line px-2 py-1.5 flex flex-col gap-1"
                style={{ height: HEADER_H }}
              >
                <button
                  className="flex items-baseline justify-between text-left no-drag"
                  onClick={() => onOpenDay(d)}
                  title="Open this day"
                >
                  <span
                    className={`text-xs ${
                      isToday ? 'text-ink font-medium' : 'text-muted'
                    }`}
                  >
                    {d.toLocaleDateString([], { weekday: 'short' })}{' '}
                    <span className="tabular-nums">{d.getDate()}</span>
                  </span>
                  <span className="text-[10px] text-faint tabular-nums">
                    {totalMs > 0 ? formatDuration(totalMs) : ''}
                  </span>
                </button>
                {/* Energy bar — the day's texture; click to set/edit. */}
                <button
                  className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[10.5px] no-drag transition-colors hover:bg-[var(--hover)]"
                  style={{
                    background: feel ? withAlpha(feel.color, 0.18) : undefined,
                  }}
                  onClick={() => setNoteDay(d)}
                  title={
                    feel
                      ? `${feel.label}${rec?.journal ? ' · has a note' : ''}`
                      : 'How did this day feel?'
                  }
                >
                  {feel ? (
                    <>
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: feel.color }}
                        aria-hidden
                      />
                      <span className="text-ink truncate">{feel.label}</span>
                    </>
                  ) : (
                    <span className="text-faint">feel…</span>
                  )}
                  {rec?.journal?.trim() && (
                    <span className="ml-auto text-faint shrink-0" aria-hidden>
                      ”
                    </span>
                  )}
                </button>
              </div>

              {/* Body */}
              <div
                className={`relative ${isToday ? 'bg-[var(--surface)]' : ''}`}
                style={{ height: bodyHeight }}
              >
                {Array.from({ length: hours }, (_, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0"
                    style={{
                      top: i * HOUR_HEIGHT,
                      borderTop: '1px solid var(--half-hour-line)',
                    }}
                  />
                ))}
                {nowY != null && nowY >= 0 && nowY <= bodyHeight && (
                  <div
                    className="absolute left-0 right-0 z-10 pointer-events-none"
                    style={{ top: nowY }}
                  >
                    <div className="h-px bg-[#A66E5C]/70" />
                  </div>
                )}
                {positioned.map((p) => {
                  const color = catColor(p.block.category_id);
                  const widthPct = 100 / p.cols;
                  const tall = p.height > 24;
                  return (
                    <button
                      key={p.block.id}
                      className="absolute rounded-[4px] overflow-hidden text-left px-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ink)]"
                      style={{
                        top: p.top,
                        height: p.height,
                        left: `${p.col * widthPct}%`,
                        width: `calc(${widthPct}% - 2px)`,
                        background: withAlpha(color, 0.22),
                        borderLeft: `2px solid ${color}`,
                      }}
                      onClick={() => onOpenDay(d)}
                      title={`${catName(p.block.category_id)}${
                        p.block.note ? ' · ' + p.block.note : ''
                      }`}
                    >
                      {tall && (
                        <span className="block text-[10px] leading-tight text-ink truncate">
                          {p.block.note?.trim() || catName(p.block.category_id)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {noteDay && (
        <DayNotePopover
          day={noteDay}
          onClose={() => setNoteDay(null)}
          onSaved={reloadDays}
        />
      )}
    </div>
  );
}

// Greedy overlap layout within one day column: overlapping blocks share the
// column width via column assignment. Mirrors the Day view's algorithm.
function layoutColumn(
  blocks: Block[],
  colStart: Date,
  dayStartHour: number,
  hours: number
): Positioned[] {
  const maxY = hours * HOUR_HEIGHT;
  const yOf = (iso: string) => {
    const mins =
      (fromIso(iso).getTime() - colStart.getTime()) / 60000 - dayStartHour * 60;
    return (mins / 60) * HOUR_HEIGHT;
  };

  const sorted = [...blocks].sort(
    (a, b) => fromIso(a.start_at).getTime() - fromIso(b.start_at).getTime()
  );

  const groups: Block[][] = [];
  let groupEnd = -Infinity;
  for (const b of sorted) {
    const s = fromIso(b.start_at).getTime();
    const e = fromIso(b.end_at).getTime();
    const last = groups[groups.length - 1];
    if (!last || s >= groupEnd) {
      groups.push([b]);
      groupEnd = e;
    } else {
      last.push(b);
      groupEnd = Math.max(groupEnd, e);
    }
  }

  const out: Positioned[] = [];
  for (const g of groups) {
    const colEnds: number[] = [];
    const assigned: { block: Block; col: number }[] = [];
    for (const b of g) {
      const s = fromIso(b.start_at).getTime();
      let col = colEnds.findIndex((end) => end <= s);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(fromIso(b.end_at).getTime());
      } else {
        colEnds[col] = fromIso(b.end_at).getTime();
      }
      assigned.push({ block: b, col });
    }
    const cols = colEnds.length;
    for (const { block, col } of assigned) {
      const top = Math.max(0, yOf(block.start_at));
      const bottom = Math.min(maxY, yOf(block.end_at));
      out.push({ block, top, height: Math.max(2, bottom - top), col, cols });
    }
  }
  return out;
}
