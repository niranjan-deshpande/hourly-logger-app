import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  ActiveSession,
  AppSettings,
  Block,
  BlockKind,
  Category,
  PomodoroSnapshot,
} from '@shared/types';
import {
  formatDuration,
  formatHourLabel,
  formatTime,
  fromIso,
  sameDay,
  snapMinutes,
  startOfLocalDay,
} from '../lib/time';
import { TimelineBlock } from './TimelineBlock';
import { BlockEditor } from './BlockEditor';
import { RecordingEditor } from './RecordingEditor';
import { withAlpha } from '../lib/colors';
import { actualsMatchingPlan, eligibleForDone } from '../lib/plan';
import { pomodoroPhaseLabel } from './pomodoroUi';

interface Props {
  day: Date;
  blocks: Block[];
  categories: Category[];
  allCategories: Category[];
  settings: AppSettings;
  onChanged: () => Promise<void> | void;
  activeSession: ActiveSession | null;
  // Live pomodoro snapshot — drives the ghost's countdown badge and the
  // awaiting-phase freeze. Only meaningful when activeSession?.pomodoro.
  pomodoro: PomodoroSnapshot | null;
  onUpdateSession: (input: {
    categoryId?: number;
    note?: string | null;
  }) => Promise<void> | void;
  onFinishSession: () => Promise<void> | void;
  onDiscardSession: () => Promise<void> | void;
  // Whether the Plan lane is visible. When false (narrow window), the
  // Actual lane takes the full width and drag-create implicitly targets
  // Actual.
  showPlan: boolean;
}

const HOUR_HEIGHT = 64;
const LABEL_W = 56;

// Blocks that merely touch at a boundary — one ends at 3:00, the next starts
// at 3:00 — must NOT share columns; they belong stacked one-below-the-other.
// We also absorb sub-minute jitter here: block times derived from `now`
// (finishing a live recording, or a quick-capture block clamped to the
// current time) carry seconds/milliseconds, so an abutting pair can overlap
// by a fraction of a minute. Treat any overlap of up to a minute as merely
// "touching" — at ~1px per minute it's visually nothing anyway — and only
// split blocks into side-by-side columns when they genuinely overlap by more.
const TOUCH_TOLERANCE_MS = 60_000;

interface DraftBlock {
  startAt: Date;
  endAt: Date;
  // Which lane the drag started in — determines where the resulting
  // block is created and where the drag preview renders.
  kind: BlockKind;
}

interface LayoutBlock {
  block: Block;
  top: number;
  height: number;
  column: number;
  columns: number;
  overlapping: boolean;
}

export function Timeline({
  day,
  blocks,
  categories,
  allCategories,
  settings,
  onChanged,
  activeSession,
  pomodoro,
  onUpdateSession,
  onFinishSession,
  onDiscardSession,
  showPlan,
}: Props) {
  const dayStart = settings.dayStartHour;
  const dayEnd = settings.dayEndHour; // exclusive
  const hours = Math.max(1, dayEnd - dayStart);

  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DraftBlock | null>(null);
  const [editing, setEditing] = useState<
    | { kind: 'existing'; block: Block }
    | { kind: 'new'; draft: DraftBlock }
    | null
  >(null);
  const [editingSession, setEditingSession] = useState(false);

  // current time tick — drives the "now" line, the live ghost growth,
  // AND re-evaluation of which Plan blocks are Done-eligible. Lifted
  // above the layout memos so they can depend on it.
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const interval = activeSession ? 3000 : 60000;
    const t = setInterval(() => setNowTick((x) => x + 1), interval);
    return () => clearInterval(t);
  }, [activeSession]);
  void nowTick;

  // Center the current hour when viewing today.
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    if (!sameDay(day, new Date())) {
      containerRef.current.scrollTop = 0;
      return;
    }
    const now = new Date();
    const hourFromStart =
      now.getHours() + now.getMinutes() / 60 - dayStart;
    const offset = hourFromStart * HOUR_HEIGHT;
    const target = Math.max(
      0,
      offset - containerRef.current.clientHeight / 2
    );
    containerRef.current.scrollTop = target;
  }, [day, dayStart]);

  // Whenever the day prop changes, any open editor is for the *old* day —
  // close it to avoid silently rewriting a block onto a different day.
  useEffect(() => {
    setEditing(null);
    setDrag(null);
  }, [day]);

  // Convert pixel offset to a Date within the day, clamped to the visible
  // [dayStart, dayEnd] window so drag-create can't produce times that would
  // render off-screen.
  const yToDate = useCallback(
    (yPx: number, alt: boolean): Date => {
      const clamped = Math.max(0, Math.min(yPx, hours * HOUR_HEIGHT));
      const startBase = startOfLocalDay(day);
      const baseMinutes = dayStart * 60 + (clamped / HOUR_HEIGHT) * 60;
      const d = new Date(startBase);
      d.setMinutes(Math.round(baseMinutes), 0, 0);
      return snapMinutes(d, alt ? 5 : 15);
    },
    [day, dayStart, hours]
  );

  const dateToY = useCallback(
    (d: Date): number => {
      // clamp to day window
      const baseStart = startOfLocalDay(day);
      const baseStartMs = baseStart.getTime();
      const m = (d.getTime() - baseStartMs) / 60000 - dayStart * 60;
      return (m / 60) * HOUR_HEIGHT;
    },
    [day, dayStart]
  );

  // The greedy overlap-resolution algorithm — extracted into a helper so
  // we can run it once per lane. Within a lane, blocks that overlap in
  // time share width via column assignment; the two lanes are otherwise
  // independent.
  const layOutLane = useCallback(
    (laneBlocks: Block[]): LayoutBlock[] => {
      const sorted = [...laneBlocks].sort(
        (a, b) => fromIso(a.start_at).getTime() - fromIso(b.start_at).getTime()
      );

      type Group = { items: Block[]; end: number };
      const groups: Group[] = [];
      for (const b of sorted) {
        const s = fromIso(b.start_at).getTime();
        const e = fromIso(b.end_at).getTime();
        const last = groups[groups.length - 1];
        if (!last || s >= last.end - TOUCH_TOLERANCE_MS) {
          groups.push({ items: [b], end: e });
        } else {
          last.items.push(b);
          last.end = Math.max(last.end, e);
        }
      }

      const out: LayoutBlock[] = [];
      for (const g of groups) {
        const colEnds: number[] = [];
        const assigned: { block: Block; column: number }[] = [];
        for (const b of g.items) {
          const s = fromIso(b.start_at).getTime();
          let col = colEnds.findIndex((end) => end <= s + TOUCH_TOLERANCE_MS);
          if (col === -1) {
            col = colEnds.length;
            colEnds.push(fromIso(b.end_at).getTime());
          } else {
            colEnds[col] = fromIso(b.end_at).getTime();
          }
          assigned.push({ block: b, column: col });
        }
        const columns = colEnds.length;
        for (const { block, column } of assigned) {
          const top = dateToY(fromIso(block.start_at));
          const bottom = dateToY(fromIso(block.end_at));
          const height = Math.max(14, bottom - top);
          out.push({
            block,
            top,
            height,
            column,
            columns,
            overlapping: g.items.length > 1,
          });
        }
      }
      return out;
    },
    [dateToY]
  );

  const planLayout = useMemo(
    () => layOutLane(blocks.filter((b) => b.kind === 'plan')),
    [blocks, layOutLane]
  );
  const actualLayout = useMemo(
    () => layOutLane(blocks.filter((b) => b.kind !== 'plan')),
    [blocks, layOutLane]
  );

  // Subtle "matches plan" dot on Actual blocks — see lib/plan.ts.
  const matchesPlanIds = useMemo(
    () => actualsMatchingPlan(blocks),
    [blocks]
  );

  // Done-eligible Plan blocks (ended and uncovered). nowTick is in the
  // deps so eligibility re-evaluates each tick — a Plan block becomes
  // eligible the moment its end time passes.
  const eligibleDoneIds = useMemo(() => {
    const eligible = eligibleForDone(blocks);
    return new Set(eligible.map((b) => b.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, nowTick]);

  // Decide which lane the mouse is in. If the Plan lane isn't visible
  // (narrow window), every drag implicitly targets Actual. Returns null
  // when the click is in the hour-label gutter (left of the block area)
  // — drags there should be ignored rather than silently assigned to a
  // lane.
  function laneAtX(clientX: number): BlockKind | null {
    const inner = innerRef.current;
    if (!inner) return null;
    const rect = inner.getBoundingClientRect();
    const xRel = clientX - rect.left;
    // Clicks inside the hour-label gutter aren't on the timeline proper.
    if (xRel < LABEL_W) return null;
    if (!showPlan) return 'actual';
    const areaWidth = rect.width - LABEL_W - 12;
    const midpoint = LABEL_W + areaWidth / 2;
    return xRel < midpoint ? 'plan' : 'actual';
  }

  // Drag-to-create on empty space. A real drag (>= 4px of vertical
  // movement) opens the new-block editor; a plain click without movement
  // is ignored so you don't conjure a 30-minute block by accident. The
  // lane is captured at mousedown and stays fixed for the duration of
  // this drag — sliding horizontally into the other lane mid-drag
  // wouldn't be obvious behavior.
  function onMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-block]')) return;
    const inner = innerRef.current;
    if (!inner) return;
    // Refuse drags that start in the hour-label gutter — those aren't
    // on the timeline proper and historically created stray blocks.
    const draftKind = laneAtX(e.clientX);
    if (draftKind == null) return;
    const rect = inner.getBoundingClientRect();
    const startY = e.clientY - rect.top;
    const startClientY = e.clientY;
    const startDate = yToDate(startY, e.altKey);
    let moved = false;

    const move = (ev: MouseEvent) => {
      if (!moved && Math.abs(ev.clientY - startClientY) >= 4) {
        moved = true;
        setDrag({
          startAt: startDate,
          endAt: new Date(startDate.getTime() + 15 * 60000),
          kind: draftKind,
        });
      }
      if (!moved) return;
      const y = ev.clientY - rect.top;
      const d = yToDate(y, ev.altKey);
      setDrag((prev) => {
        if (!prev) return prev;
        const s = prev.startAt;
        return d > s
          ? { startAt: s, endAt: d, kind: prev.kind }
          : {
              startAt: d,
              endAt: new Date(s.getTime() + 15 * 60000),
              kind: prev.kind,
            };
      });
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setDrag(null);
      if (!moved) return; // a click without drag — do nothing
      const y = ev.clientY - rect.top;
      const endD = yToDate(y, ev.altKey);
      const s = startDate;
      const e2 =
        endD > s ? endD : new Date(s.getTime() + 30 * 60000);
      if (e2.getTime() - s.getTime() >= 5 * 60000) {
        setEditing({
          kind: 'new',
          draft: { startAt: s, endAt: e2, kind: draftKind },
        });
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  const nowY = sameDay(day, new Date()) ? dateToY(new Date()) : null;

  // The live ghost block. Rendered when we have an active session whose
  // startAt falls on the day we're viewing — so if you scroll back to
  // yesterday while a session is running, the ghost isn't on screen.
  const sessionCategory = activeSession
    ? allCategories.find((c) => c.id === activeSession.categoryId)
    : undefined;
  const ghost = (() => {
    if (!activeSession) return null;
    const start = fromIso(activeSession.startAt);
    if (!sameDay(start, day)) return null;
    const top = dateToY(start);
    // Walk-away rule, visually: while a pomodoro session sits in
    // 'awaiting' (break over, nothing running), the ghost stops growing
    // at the moment the break ended — finishing then commits exactly
    // what's drawn.
    const p = activeSession.pomodoro;
    const liveEnd =
      p && p.phase === 'awaiting' && p.lastPhaseEndAt
        ? fromIso(p.lastPhaseEndAt)
        : new Date();
    const bottom = dateToY(liveEnd);
    return { top, height: Math.max(14, bottom - top), liveEnd };
  })();

  // "Done" handler — invoked by TimelineBlock when the chip is clicked
  // OR the keyboard shortcut fires. We create an Actual block mirroring
  // the Plan block's category/note/times, then refresh.
  const handleDone = useCallback(
    async (plan: Block) => {
      await window.api.blocks.create({
        categoryId: plan.category_id,
        startAt: plan.start_at,
        endAt: plan.end_at,
        note: plan.note,
        kind: 'actual',
      });
      await onChanged();
    },
    [onChanged]
  );

  // Render a Block via TimelineBlock with all the lane-aware props it
  // needs (matches-plan dot for actuals, Done eligibility for plans).
  // Pulled out so the same renderer can be reused in both lane layers.
  const renderBlock = (lb: LayoutBlock) => {
    const cat = allCategories.find((c) => c.id === lb.block.category_id);
    return (
      <TimelineBlock
        key={lb.block.id}
        block={lb.block}
        category={cat}
        top={lb.top}
        height={lb.height}
        column={lb.column}
        columns={lb.columns}
        overlapping={lb.overlapping}
        matchesPlan={matchesPlanIds.has(lb.block.id)}
        doneEligible={eligibleDoneIds.has(lb.block.id)}
        onDone={() => handleDone(lb.block)}
        onClick={() => setEditing({ kind: 'existing', block: lb.block })}
      />
    );
  };

  return (
    <div ref={containerRef} className="relative flex-1 overflow-y-auto">
      <div
        ref={innerRef}
        className="relative"
        style={{ height: hours * HOUR_HEIGHT }}
        onMouseDown={onMouseDown}
      >
        {/* Lane backgrounds — drawn first, beneath everything else, so the
            hour grid lines render on top of them. Pointer-events disabled
            so they don't intercept drag-to-create. The label gutter keeps
            the default --bg, so the visual seam at LABEL_W reads as
            "where the timeline begins". */}
        {showPlan && (
          <div
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{
              left: LABEL_W,
              width: `calc(50% - ${LABEL_W / 2}px)`,
              background: 'var(--surface)',
            }}
            aria-hidden
          />
        )}
        {showPlan && (
          <div
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{
              left: `calc(50% + ${LABEL_W / 2}px)`,
              width: 1,
              background: 'var(--line)',
            }}
            aria-hidden
          />
        )}

        {/* hour rows */}
        {Array.from({ length: hours }, (_, i) => {
          const hr = dayStart + i;
          return (
            <div
              key={hr}
              className="absolute left-0 right-0"
              style={{
                top: i * HOUR_HEIGHT,
                height: HOUR_HEIGHT,
                borderTop: '1px solid var(--hour-line)',
              }}
            >
              <div
                className="absolute left-0 top-0 text-[11px] uppercase tracking-wider text-muted pt-1 pl-4"
                style={{ width: LABEL_W }}
              >
                {formatHourLabel(hr)}
              </div>
              {/* faint half-hour marker */}
              <div
                className="absolute right-0 left-0"
                style={{
                  top: HOUR_HEIGHT / 2,
                  left: LABEL_W,
                  borderTop: '1px dashed var(--half-hour-line)',
                }}
              />
            </div>
          );
        })}

        {/* final bottom line */}
        <div
          className="absolute left-0 right-0"
          style={{
            top: hours * HOUR_HEIGHT,
            borderTop: '1px solid var(--hour-line)',
          }}
        />

        {/* now indicator — spans across both lanes */}
        {nowY != null && nowY >= 0 && nowY <= hours * HOUR_HEIGHT && (
          <div
            className="absolute z-10 pointer-events-none"
            style={{ top: nowY, left: LABEL_W - 4, right: 0 }}
          >
            <div className="relative h-px bg-[#A66E5C]/70">
              <div className="absolute -left-1 -top-[3px] w-1.5 h-1.5 rounded-full bg-[#A66E5C]" />
            </div>
          </div>
        )}

        {/* PLAN lane blocks layer. Each lane is its own positioned
            container so per-block `left`/`width` percentages stay
            scoped to its lane's width (50%). */}
        {showPlan && (
          <div
            className="absolute top-0 bottom-0"
            style={{
              left: LABEL_W + 6,
              width: `calc(50% - ${LABEL_W / 2 + 6 + 3}px)`,
            }}
          >
            {planLayout.map(renderBlock)}
            {drag && drag.kind === 'plan' && (
              <div
                className="absolute rounded-md border border-dashed pointer-events-none"
                style={{
                  top: dateToY(drag.startAt),
                  height: Math.max(
                    8,
                    dateToY(drag.endAt) - dateToY(drag.startAt)
                  ),
                  left: 0,
                  right: 0,
                  borderColor: 'var(--ink)',
                  background: 'var(--select)',
                }}
              />
            )}
          </div>
        )}

        {/* ACTUAL lane blocks layer. When Plan is hidden this lane
            occupies the full block area; otherwise it lives in the
            right half. Houses the live recording ghost. */}
        <div
          className="absolute top-0 bottom-0"
          style={
            showPlan
              ? {
                  left: `calc(50% + ${LABEL_W / 2 + 4}px)`,
                  right: 12,
                }
              : { left: LABEL_W + 6, right: 12 }
          }
        >
          {actualLayout.map(renderBlock)}
          {ghost && activeSession && (
            <button
              data-block
              onClick={() => setEditingSession(true)}
              className="absolute text-left rounded-md overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ink)]"
              style={{
                top: ghost.top,
                height: ghost.height,
                left: 0,
                right: 0,
                background: `repeating-linear-gradient(135deg, ${withAlpha(
                  sessionCategory?.color ?? '#A66E5C',
                  0.28
                )} 0 10px, ${withAlpha(
                  sessionCategory?.color ?? '#A66E5C',
                  0.14
                )} 10px 20px)`,
                border: `1px dashed ${sessionCategory?.color ?? '#A66E5C'}`,
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              }}
              title={`Recording: ${
                sessionCategory?.name ?? 'Uncategorized'
              } · started ${formatTime(fromIso(activeSession.startAt))}`}
            >
              <div
                className={`px-2 flex flex-col h-full ${
                  ghost.height < 22 ? 'py-0 justify-center' : 'py-1'
                }`}
              >
                <div className="flex items-baseline gap-1.5 min-w-0">
                  <span
                    className={`font-medium truncate ${
                      ghost.height < 22
                        ? 'text-[10.5px] leading-none'
                        : 'text-[12.5px] leading-tight'
                    }`}
                    style={{ color: 'var(--ink)' }}
                  >
                    {activeSession.note?.trim() ||
                      sessionCategory?.name ||
                      'Recording…'}
                  </span>
                  <span
                    className={`text-muted shrink-0 tabular-nums ${
                      ghost.height < 22
                        ? 'text-[9.5px] leading-none'
                        : 'text-[11px] leading-tight'
                    }`}
                  >
                    {formatDuration(
                      ghost.liveEnd.getTime() -
                        fromIso(activeSession.startAt).getTime()
                    )}
                  </span>
                </div>
                {ghost.height > 32 && (
                  <div className="flex items-center gap-1 text-[10.5px] text-muted leading-tight">
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: '#A66E5C' }}
                      aria-hidden
                    />
                    <span className="tabular-nums">
                      {activeSession.pomodoro && pomodoro
                        ? `Pomodoro · ${pomodoroPhaseLabel(
                            activeSession.pomodoro,
                            pomodoro.timer
                          )}`
                        : `Recording · since ${formatTime(
                            fromIso(activeSession.startAt)
                          )}`}
                    </span>
                  </div>
                )}
              </div>
            </button>
          )}
          {drag && drag.kind === 'actual' && (
            <div
              className="absolute rounded-md border border-dashed pointer-events-none"
              style={{
                top: dateToY(drag.startAt),
                height: Math.max(8, dateToY(drag.endAt) - dateToY(drag.startAt)),
                left: 0,
                right: 0,
                borderColor: 'var(--ink)',
                background: 'var(--select)',
              }}
            />
          )}
        </div>

        {editing && (
          <BlockEditor
            day={day}
            categories={categories}
            allCategories={allCategories}
            settings={settings}
            sessionActive={activeSession != null}
            initial={
              editing.kind === 'existing'
                ? editing.block
                : { draft: editing.draft }
            }
            anchorY={
              editing.kind === 'existing'
                ? dateToY(fromIso(editing.block.start_at))
                : dateToY(editing.draft.startAt)
            }
            onClose={() => setEditing(null)}
            onCommit={async () => {
              await onChanged();
            }}
          />
        )}

        {editingSession && activeSession && ghost && (
          <RecordingEditor
            session={activeSession}
            pomodoro={pomodoro}
            categories={categories}
            allCategories={allCategories}
            anchorY={ghost.top}
            onUpdate={onUpdateSession}
            onFinish={async () => {
              setEditingSession(false);
              await onFinishSession();
            }}
            onDiscard={async () => {
              setEditingSession(false);
              await onDiscardSession();
            }}
            onClose={() => setEditingSession(false)}
          />
        )}
      </div>
    </div>
  );
}

