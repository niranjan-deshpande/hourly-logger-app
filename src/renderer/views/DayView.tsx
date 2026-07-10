import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ActiveSession,
  AppSettings,
  Block,
  Category,
  PomodoroSnapshot,
} from '@shared/types';
import { DayToolbar } from '../components/DayToolbar';
import { Timeline } from '../components/Timeline';
import { endOfLocalDay, startOfLocalDay, toIso } from '../lib/time';
import { eligibleForDone } from '../lib/plan';

// Below this window width the Plan column auto-collapses to give Actual
// the full timeline. The threshold was picked so that two 320-wide
// lanes plus a 220-wide sidebar plus padding fit comfortably above it.
const PLAN_COLLAPSE_PX = 900;

interface Props {
  day: Date;
  settings: AppSettings;
  // Categories visible in the sidebar/quick-add (gated by showArchived).
  categories: Category[];
  // The full set incl. archived, used by the timeline to render historical
  // blocks whose category may have been archived later.
  allCategories: Category[];
  filterCategoryId: number | null;
  // Tell the parent that data changed so it can refresh sidebar totals etc.
  onDataChanged: () => void;
  // Global change counter — block writes that happen OUTSIDE this view
  // (recovery dialog, pomodoro finish from the break cover) bump it, and
  // we refetch so the new block appears without a day-switch.
  dataVersion: number;
  // Live recording — null when no session is active. The handlers are
  // app-level (they call IPC and update App state); we just thread them
  // through.
  activeSession: ActiveSession | null;
  // Live pomodoro snapshot (1 Hz while a timer runs); null before the
  // first snapshot. Only meaningful when activeSession?.pomodoro is set.
  pomodoro: PomodoroSnapshot | null;
  onStartSession: (input: {
    categoryId: number;
    note: string | null;
    pomodoro?: {
      workMinutes: number;
      breakMinutes: number;
      pomodorosPerCycle: number;
    };
  }) => Promise<void> | void;
  onUpdateSession: (input: {
    categoryId?: number;
    note?: string | null;
  }) => Promise<void> | void;
  onFinishSession: () => Promise<void> | void;
  onDiscardSession: () => Promise<void> | void;
  // Open the quick-capture modal (also bound to the global `N` shortcut).
  onOpenCapture: () => void;
}

export function DayView({
  day,
  settings,
  categories,
  allCategories,
  filterCategoryId,
  onDataChanged,
  dataVersion,
  activeSession,
  pomodoro,
  onStartSession,
  onUpdateSession,
  onFinishSession,
  onDiscardSession,
  onOpenCapture,
}: Props) {
  const [blocks, setBlocks] = useState<Block[]>([]);

  const refresh = useCallback(async () => {
    const from = startOfLocalDay(day);
    const to = endOfLocalDay(day);
    const fresh = await window.api.blocks.listByRange({
      from: toIso(from),
      to: toIso(to),
    });
    setBlocks(fresh);
  }, [day]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Re-fetch when a session transitions (start/finish/discard) or when
  // any out-of-view write bumps dataVersion. A finish creates a new
  // block via an App-level handler, which we'd otherwise miss until the
  // next day-change.
  useEffect(() => {
    refresh();
  }, [activeSession?.startAt, dataVersion, refresh]);

  const visibleBlocks = useMemo(() => {
    if (filterCategoryId == null) return blocks;
    return blocks.filter((b) => b.category_id === filterCategoryId);
  }, [blocks, filterCategoryId]);

  // Combine local refresh with parent's onDataChanged so both stay in sync.
  const handleChanged = useCallback(async () => {
    await refresh();
    onDataChanged();
  }, [refresh, onDataChanged]);

  // Window-width-driven Plan collapse. Below PLAN_COLLAPSE_PX the lane
  // is hidden by default; the user can override with the toolbar
  // toggle. `manualOverride` distinguishes a deliberate user pref from
  // the auto state — when the user toggles, we lock the choice until
  // they toggle again, even if the window crosses the threshold.
  const [windowWidth, setWindowWidth] = useState<number>(
    typeof window === 'undefined' ? 1200 : window.innerWidth
  );
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const canShowPlan = windowWidth >= PLAN_COLLAPSE_PX;
  const [manualPlanOverride, setManualPlanOverride] = useState<
    boolean | null
  >(null);
  const showPlan = manualPlanOverride ?? canShowPlan;
  const togglePlan = () =>
    setManualPlanOverride((cur) => !(cur ?? canShowPlan));

  // Re-evaluate Mirror-eligible plan blocks each minute (or each session
  // tick) so the button appears/disappears as time passes. The tick
  // state MUST be in the memo's deps — a re-render alone doesn't
  // re-run useMemo if its deps didn't change.
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const interval = activeSession ? 3000 : 60000;
    const t = setInterval(() => setNowTick((n) => n + 1), interval);
    return () => clearInterval(t);
  }, [activeSession]);
  const eligiblePlanBlocks = useMemo(
    // Use `visibleBlocks` (filter-aware) so the Mirror button's count
    // matches what's actually in the Plan column. Without this, an
    // active category filter would show "(N)" with N spanning hidden
    // categories — confusing and surprising on click.
    () => eligibleForDone(visibleBlocks),
    // nowTick is intentionally a dep — Date.now() inside eligibleForDone
    // changes between renders even if blocks doesn't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleBlocks, nowTick]
  );

  // When a Mirror operation hits errors we surface a short message in
  // the toolbar — silently swallowing was masking real failures.
  const [mirrorError, setMirrorError] = useState<string | null>(null);

  const handleMirrorPlan = useCallback(async () => {
    // Sequential, not parallel — better-sqlite3 is synchronous on the
    // main thread anyway, and serializing keeps any logged errors easy
    // to associate with the offending block.
    let failures = 0;
    for (const p of eligiblePlanBlocks) {
      try {
        await window.api.blocks.create({
          categoryId: p.category_id,
          startAt: p.start_at,
          endAt: p.end_at,
          note: p.note,
          kind: 'actual',
        });
      } catch (err) {
        failures++;
        console.error('Mirror failed for plan block', p.id, err);
      }
    }
    if (failures > 0) {
      setMirrorError(
        `Couldn't mirror ${failures} of ${eligiblePlanBlocks.length} block${
          eligiblePlanBlocks.length === 1 ? '' : 's'
        }.`
      );
      // Auto-clear after a few seconds so it doesn't linger.
      setTimeout(() => setMirrorError(null), 5000);
    } else {
      setMirrorError(null);
    }
    await handleChanged();
  }, [eligiblePlanBlocks, handleChanged]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <DayToolbar
        activeCategories={categories.filter((c) => !c.archived)}
        eligiblePlanBlocks={eligiblePlanBlocks}
        onMirrorPlan={handleMirrorPlan}
        mirrorError={mirrorError}
        showPlan={showPlan}
        canShowPlan={canShowPlan}
        onToggleShowPlan={togglePlan}
        activeSession={activeSession}
        pomodoro={pomodoro}
        settings={settings}
        onStartSession={onStartSession}
        onFinishSession={onFinishSession}
        onOpenCapture={onOpenCapture}
        day={day}
      />
      <Timeline
        day={day}
        blocks={visibleBlocks}
        categories={categories}
        allCategories={allCategories}
        settings={settings}
        onChanged={handleChanged}
        activeSession={activeSession}
        pomodoro={pomodoro}
        onUpdateSession={onUpdateSession}
        onFinishSession={onFinishSession}
        onDiscardSession={onDiscardSession}
        showPlan={showPlan}
      />
    </div>
  );
}
