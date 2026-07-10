import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import type { Block, Category } from '@shared/types';
import { withAlpha } from '../lib/colors';
import { formatDuration, formatTime, fromIso } from '../lib/time';

interface Props {
  block: Block;
  category: Category | undefined;
  top: number;
  height: number;
  column: number;
  columns: number;
  overlapping: boolean;
  // True when this block is an Actual that overlaps a Plan block of the
  // same category. Renders a subtle dot in the bottom-right corner —
  // honest "stayed on plan" feedback without any nag.
  matchesPlan: boolean;
  // True when this block is a Plan that's already ended and isn't yet
  // mirrored by an Actual block. Surfaces the ✓ Done chip and arms the
  // `D` keyboard shortcut.
  doneEligible: boolean;
  onDone: () => void;
  onClick: () => void;
}

export function TimelineBlock({
  block,
  category,
  top,
  height,
  column,
  columns,
  overlapping,
  matchesPlan,
  doneEligible,
  onDone,
  onClick,
}: Props) {
  const [peek, setPeek] = useState(false);
  const colWidth = 100 / Math.max(1, columns);
  const left = column * colWidth;
  const start = fromIso(block.start_at);
  const end = fromIso(block.end_at);
  const duration = end.getTime() - start.getTime();
  const color = category?.color ?? '#5E5240';
  const categoryName = category?.name ?? 'Uncategorized';

  // The "title" of the block is the user's description when present —
  // that's the more specific thing. The category sits in a subtle subtitle
  // since the color and dot already encode it.
  const description = block.note?.trim();
  const title = description || categoryName;
  const hasSubtitle = !!description; // only when description supplants category as title

  // Hover/focus "peek": a short block grows to reveal its full content as a
  // little card, lifted above its neighbors. At rest it keeps its true
  // duration-height. Every render decision below reads off `effH` — the
  // *effective* height — so peeking surfaces the time/subtitle for free.
  const peekHeight = hasSubtitle ? 66 : 46;
  const effH = peek ? Math.max(height, peekHeight) : height;

  // Pick what we render based on the block's effective pixel height. The
  // button has 1px borders top and bottom plus vertical padding, so the
  // usable inner height is meaningfully less than `effH`.
  //   tiny — too short for a full-size line: shrink the font, drop the
  //   vertical padding, and vertically center the single line so the text
  //   sits in the middle instead of clipping at the top.
  const tiny = effH < 22;
  const compact = effH < 48;
  const showTime = effH > 32;
  const showSubtitle = hasSubtitle && effH > 56;

  const isPlan = block.kind === 'plan';
  // Sync provenance — only meaningful on Plan blocks, but we don't
  // strictly enforce that here. `syncedClean` means it's currently
  // managed by sync; `syncedDetached` means it was once synced but
  // the user has since edited it and now owns it.
  const syncedClean = block.external_source === 'gcal' && !block.detached;
  const syncedDetached = block.external_source === 'gcal' && block.detached;

  // Pomodoro meta: a plan block with sequence params gets a "3 × 45m"
  // badge (it's launchable from the editor); an actual block written by
  // a finished sequence gets a tomato mark with its rep count.
  const planSeq =
    block.pomodoro && 'reps' in block.pomodoro ? block.pomodoro : null;
  const actualSeq =
    block.pomodoro && 'source' in block.pomodoro ? block.pomodoro : null;

  // Resting fill is a translucent tint so the lane shading reads through it.
  // While peeking, the card grows over its neighbours, so we composite that
  // same tint over an opaque, lane-matched base — identical colour, but now
  // solid so the block underneath can't bleed through and hurt legibility.
  const fill = withAlpha(color, isPlan ? 0.14 : 0.28);
  const laneBase = isPlan ? 'var(--surface)' : 'var(--bg)';

  return (
    <button
      data-block
      onClick={onClick}
      onMouseEnter={() => setPeek(true)}
      onMouseLeave={() => setPeek(false)}
      onFocus={() => setPeek(true)}
      onBlur={() => setPeek(false)}
      onKeyDown={(e) => {
        // `D` on a focused, Done-eligible plan block mirrors it into
        // Actual (same effect as the corner chip). Restricted to plans
        // so it can't fire on actuals where it'd be a no-op anyway.
        if (
          doneEligible &&
          isPlan &&
          (e.key === 'd' || e.key === 'D') &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.altKey
        ) {
          e.preventDefault();
          e.stopPropagation();
          onDone();
        }
      }}
      className="absolute text-left rounded-md overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ink)]"
      style={{
        top,
        height: effH,
        left: `calc(${left}% + ${column > 0 ? 2 : 0}px)`,
        width: `calc(${colWidth}% - ${columns > 1 ? 4 : 0}px)`,
        // When peeking, lift above neighbors so the grown card overlays them
        // cleanly instead of being clipped by a later sibling.
        zIndex: peek ? 30 : undefined,
        // Plan blocks read as drafts: lower fill alpha + dashed border.
        // Combined with the lighter lane background, you can spot which
        // lane a block lives in at a glance. Synced-but-not-detached
        // blocks use dotted instead of dashed as an additional
        // "this came from your calendar" signal. When peeking, the fill
        // sits on an opaque lane-matched base so the grown card is solid.
        background: peek
          ? `linear-gradient(${fill}, ${fill}), ${laneBase}`
          : fill,
        border: `1px ${
          syncedClean ? 'dotted' : isPlan ? 'dashed' : 'solid'
        } ${color}`,
        boxShadow: peek
          ? '0 4px 14px rgba(0,0,0,0.18)'
          : '0 1px 2px rgba(0,0,0,0.05)',
        transition: 'height 120ms ease, box-shadow 120ms ease',
      }}
      title={`${isPlan ? '[Plan] ' : ''}${categoryName}${
        description ? ' · ' + description : ''
      } · ${formatTime(start)} – ${formatTime(end)}${
        doneEligible ? ' · press D to mark done' : ''
      }`}
    >
      <div
        className={`px-2 flex flex-col h-full ${
          tiny ? 'py-0 justify-center' : compact ? 'py-0.5' : 'py-1'
        }`}
      >
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span
            className={`font-medium truncate ${
              tiny ? 'text-[10.5px] leading-none' : 'text-[12.5px] leading-tight'
            }`}
            style={{ color: 'var(--ink)' }}
          >
            {title}
          </span>
          <span
            className={`text-muted shrink-0 tabular-nums ${
              tiny ? 'text-[9.5px] leading-none' : 'text-[11px] leading-tight'
            }`}
          >
            {formatDuration(duration)}
          </span>
        </div>
        {showTime && (
          <div className="text-[10.5px] text-muted tabular-nums leading-tight">
            {formatTime(start)} – {formatTime(end)}
          </div>
        )}
        {showSubtitle && (
          <div className="flex items-center gap-1 mt-0.5 text-[10.5px] text-muted leading-tight min-w-0">
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: color }}
              aria-hidden
            />
            <span className="truncate">{categoryName}</span>
          </div>
        )}
      </div>
      {/* Top-left provenance mark for synced blocks. Muted, small —
          enough to glance "this came from my calendar" without
          competing for attention. For detached (user-edited) blocks
          we show a tiny ✎ instead, signaling "you've made this yours". */}
      {syncedClean && (
        <span
          className="absolute top-1 left-1 pointer-events-none"
          style={{ opacity: 0.55, color: 'var(--ink)' }}
          aria-label="From calendar"
          title="From calendar"
        >
          <CalendarDays size={10} strokeWidth={1.75} />
        </span>
      )}
      {syncedDetached && (
        <span
          className="absolute top-0.5 left-1 pointer-events-none text-[10px] leading-none"
          style={{ opacity: 0.5, color: 'var(--muted)' }}
          aria-label="Edited after import"
          title="Edited since imported — no longer updated from calendar"
        >
          ✎
        </span>
      )}

      {/* Done chip on past Plan blocks that haven't been mirrored. Click
          mirrors the block to Actual; the chip then disappears because
          the parent re-evaluates eligibility. Pinned top-right. */}
      {doneEligible && isPlan && (
        <span
          className="absolute top-1 right-1 flex items-center gap-0.5 px-1.5 py-[1px] rounded-[3px] text-[10px] font-medium leading-none hover:opacity-90"
          style={{
            background: color,
            color: 'var(--bg)',
          }}
          role="button"
          aria-label="Mark as done — copy to Actual"
          title="Mark as done — copy to Actual (or press D)"
          onClick={(e) => {
            e.stopPropagation();
            onDone();
          }}
        >
          <span aria-hidden>✓</span>
          <span>Done</span>
        </span>
      )}
      {/* Overlapping marker — when a Done chip is also present, scoot to
          bottom-right to avoid stacking on top of it. */}
      {overlapping && (
        <span
          className={`absolute ${
            doneEligible && isPlan ? 'bottom-1 right-1' : 'top-1 right-1'
          } w-1.5 h-1.5 rounded-full`}
          style={{ background: '#A66E5C' }}
          title="Overlapping with another block"
        />
      )}
      {/* Matches-plan dot — only on actual blocks, only when a plan
          block of the same category covers part of this block's time. */}
      {matchesPlan && !isPlan && (
        <span
          className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full"
          style={{ background: color, opacity: 0.65 }}
          title="Matches a planned block"
          aria-label="Matches plan"
        />
      )}
      {/* Pomodoro badges. Plan: the sequence shape ("3 × 45m") — open the
          block to launch it. Actual: provenance + reps completed. Pinned
          bottom-left, away from the chips/dots in the right corners. */}
      {planSeq && isPlan && effH > 32 && (
        <span
          className="absolute bottom-1 left-1 px-1 py-[1px] rounded-[3px] text-[9.5px] leading-none tabular-nums pointer-events-none"
          style={{ background: 'var(--hover)', color: 'var(--muted)' }}
          title={`Planned pomodoro sequence: ${planSeq.reps} × ${planSeq.workMinutes}m focus, ${planSeq.breakMinutes}m breaks`}
        >
          🍅 {planSeq.reps} × {planSeq.workMinutes}m
        </span>
      )}
      {actualSeq && !isPlan && effH > 32 && (
        <span
          className="absolute bottom-1 left-1 text-[9.5px] leading-none tabular-nums pointer-events-none"
          style={{ color: 'var(--muted)', opacity: 0.85 }}
          title={`Pomodoro session · ${actualSeq.repsCompleted} rep${
            actualSeq.repsCompleted === 1 ? '' : 's'
          } of ${actualSeq.workMinutes}m completed`}
        >
          🍅 {actualSeq.repsCompleted}
        </span>
      )}
    </button>
  );
}
