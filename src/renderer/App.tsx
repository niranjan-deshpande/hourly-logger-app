import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ActiveSession,
  AppSettings,
  Block,
  Category,
  Goal,
  PomodoroSnapshot,
} from '@shared/types';
import { Sidebar } from './components/Sidebar';
import { DayView } from './views/DayView';
import { WeekView } from './views/WeekView';
import { AggregateView, PRESETS } from './views/AggregateView';
import { SettingsPanel } from './components/SettingsPanel';
import { ShortcutsOverlay } from './components/ShortcutsOverlay';
import { SessionRecoveryDialog } from './components/SessionRecoveryDialog';
import { CaptureModal } from './components/CaptureModal';
import { useGlobalShortcuts } from './lib/shortcuts';
import {
  resolveEntry,
  toCommitDrafts,
  type ResolvedDraft,
} from './lib/phoneInbox';
import { addDays, endOfLocalDay, fromIso, startOfLocalDay, toIso } from './lib/time';

// A just-resolved phone draft, viewed as a minimal actual Block — enough for
// the parser's "from last event" anchor to chain across entries within a
// single drain pass, before any of them are committed to the DB.
function asActualBlock(r: ResolvedDraft): Block {
  return {
    id: -1,
    category_id: r.categoryId ?? -1,
    start_at: r.startAt,
    end_at: r.endAt,
    note: r.note,
    kind: 'actual',
    external_source: null,
    external_id: null,
    detached: false,
    pomodoro: null,
    created_at: r.startAt,
    updated_at: r.startAt,
  };
}

export type ViewMode = 'day' | 'week' | 'aggregate';

export interface DateRange {
  from: Date;
  to: Date;
  presetLabel?: string;
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [view, setView] = useState<ViewMode>('day');
  const [day, setDay] = useState<Date>(() => new Date());
  const [range, setRange] = useState<DateRange>(() => makeInitialRange());

  // We keep two category lists:
  //   allCategories — every category (incl. archived). Used for rendering
  //     historical blocks, aggregate stats, and uniqueness checks.
  //   visibleCategories — what the sidebar and quick-add show, gated by
  //     the `showArchived` setting.
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  // Goals (active + retired revisions) flow alongside categories: the
  // panels need retired rows to score past weeks. Refreshed by
  // refreshCategories on every goal edit.
  const [allGoals, setAllGoals] = useState<Goal[]>([]);
  // True once the first category fetch completes — the phone-inbox drain
  // waits for this so entries aren't misrouted to the inbox category
  // before real categories are available to match against.
  const [categoriesReady, setCategoriesReady] = useState(false);
  const [filterCategoryId, setFilterCategoryId] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);

  // A monotonic counter incremented whenever block data changes anywhere.
  // Consumers (Sidebar, AggregateView) re-fetch when it bumps.
  const [dataVersion, setDataVersion] = useState(0);
  const bumpDataVersion = useCallback(
    () => setDataVersion((v) => v + 1),
    []
  );

  // The live recording (if any). Persisted on disk as a tiny JSON file so
  // it survives app restart. `recoveryPrompt` is set on launch when we find
  // an existing session — the user picks "save as block ending now" or
  // "discard" before we treat the session as live.
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(
    null
  );
  const [recoveryPrompt, setRecoveryPrompt] = useState<ActiveSession | null>(
    null
  );

  // Live pomodoro state, pushed from the main-process engine at 1 Hz
  // (plus every transition). Null until the first snapshot arrives.
  const [pomodoro, setPomodoro] = useState<PomodoroSnapshot | null>(null);
  // Ref mirror of activeSession so the tick handler can check the
  // current session kind without resubscribing every render.
  const activeSessionRef = useRef<ActiveSession | null>(null);
  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  const visibleCategories = useMemo(() => {
    return settings?.showArchived
      ? allCategories
      : allCategories.filter((c) => !c.archived);
  }, [allCategories, settings?.showArchived]);

  // Active categories for quick capture — memoized so its array identity
  // is stable across App's frequent re-renders (e.g. 1 Hz pomodoro ticks).
  // A fresh array each render would re-fire the CaptureModal's live
  // re-parse and wipe in-progress edits.
  const captureCategories = useMemo(
    () => allCategories.filter((c) => !c.archived),
    [allCategories]
  );

  // load settings
  useEffect(() => {
    window.api.settings.get().then((s) => setSettings(s));
  }, []);

  // theme resolution
  useEffect(() => {
    if (!settings) return;
    const apply = () => {
      const dark =
        settings.theme === 'dark' ||
        (settings.theme === 'system' &&
          window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    if (settings.theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => apply();
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
  }, [settings?.theme]);

  // load categories — always fetch all; UI filters as needed.
  const refreshCategories = useCallback(async () => {
    const [all, goals] = await Promise.all([
      window.api.categories.list({ includeArchived: true }),
      window.api.goals.list(),
    ]);
    setAllCategories(all);
    setAllGoals(goals);
    setCategoriesReady(true);
  }, []);

  useEffect(() => {
    if (!settings) return;
    refreshCategories();
  }, [settings, refreshCategories]);

  // If the active filter category becomes archived (or vanishes from the
  // visible list for some other reason), drop the filter.
  useEffect(() => {
    if (filterCategoryId == null) return;
    if (!visibleCategories.some((c) => c.id === filterCategoryId)) {
      setFilterCategoryId(null);
    }
  }, [visibleCategories, filterCategoryId]);

  // Load any active session on launch. If one exists, show the recovery
  // dialog before treating it as a live recording — otherwise reopening
  // the app days later would silently produce a multi-day "deep work"
  // block.
  //
  // Pomodoro nuance: on macOS, closing the window doesn't quit the app,
  // so the engine (and its session file) may be live when this window
  // mounts. Check the engine first — a live engine session is adopted
  // directly, never routed through recovery.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [snap, s] = await Promise.all([
        window.api.pomodoro.getState(),
        window.api.activeSession.get(),
      ]);
      if (cancelled) return;
      if (snap.session?.pomodoro) {
        setPomodoro(snap);
        setActiveSession(snap.session);
        return;
      }
      setPomodoro(snap);
      if (s) setRecoveryPrompt(s);
      else setActiveSession(null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to engine pushes. While a pomodoro session is live, the
  // snapshot's session is the source of truth (phase changes, rep
  // counts). When the engine reports no session but we still hold a
  // pomodoro one, it ended in the main process (e.g. finished from the
  // break cover) — clear it and refresh block data.
  useEffect(() => {
    const unsubscribe = window.api.pomodoro.onTick((snap) => {
      setPomodoro(snap);
      if (snap.session?.pomodoro) {
        setActiveSession(snap.session);
      } else if (activeSessionRef.current?.pomodoro) {
        setActiveSession(null);
        bumpDataVersion();
      }
    });
    return unsubscribe;
  }, [bumpDataVersion]);

  // --- Phone inbox drain ---
  // Entries logged from the iPhone arrive as files in iCloud; the main
  // process surfaces them and we import them here through the SAME parser
  // and commit path as manual capture. Refs keep the drain callback stable
  // (so its event subscriptions don't churn) while still reading the
  // latest categories / default duration.
  const captureCategoriesRef = useRef<Category[]>(captureCategories);
  useEffect(() => {
    captureCategoriesRef.current = captureCategories;
  }, [captureCategories]);
  const phoneDefaultMinutesRef = useRef<number>(
    settings?.phoneInboxDefaultMinutes ?? 30
  );
  useEffect(() => {
    phoneDefaultMinutesRef.current = settings?.phoneInboxDefaultMinutes ?? 30;
  }, [settings?.phoneInboxDefaultMinutes]);
  const drainingRef = useRef(false);

  const drainPhoneInbox = useCallback(async () => {
    if (drainingRef.current) return; // serialize — pushes can overlap
    drainingRef.current = true;
    try {
      // Loop so entries that arrive mid-drain are picked up too. Each pass
      // commits a batch, then marks it processed; getPending returns [] once
      // the inbox is empty.
      for (;;) {
        const pending = await window.api.phoneInbox.getPending();
        if (pending.length === 0) break;
        try {
          const aliases = await window.api.aliases.get().catch(() => []);
          // Resolve oldest-first, threading the blocks each entry can "see":
          // its day's committed blocks (fetched once per day) plus the blocks
          // synthesized earlier in this same batch. This is what lets a phone
          // log say "from last event till now …" and chain correctly when
          // several such logs arrive together.
          const dayBlocks = new Map<number, Block[]>();
          const batchCreated: Block[] = [];
          const resolved: ResolvedDraft[] = [];
          for (const e of pending) {
            const at = e.ts ? new Date(e.ts) : new Date();
            const dayKey = startOfLocalDay(at).getTime();
            let known = dayBlocks.get(dayKey);
            if (!known) {
              known = await window.api.blocks
                .listByRange({
                  from: toIso(startOfLocalDay(at)),
                  to: toIso(endOfLocalDay(at)),
                })
                .catch(() => [] as Block[]);
              dayBlocks.set(dayKey, known);
            }
            const rs = resolveEntry(
              e,
              captureCategoriesRef.current,
              aliases,
              phoneDefaultMinutesRef.current,
              [...known, ...batchCreated]
            );
            resolved.push(...rs);
            for (const r of rs) batchCreated.push(asActualBlock(r));
          }
          const needsInbox = resolved.some((r) => r.categoryId == null);
          const inboxId = needsInbox
            ? await window.api.phoneInbox.ensureCategory()
            : 0;
          const drafts = toCommitDrafts(resolved, inboxId);
          if (drafts.length > 0) {
            await window.api.capture.commit({ drafts });
          }
          // Only mark processed AFTER a durable commit — a failure above
          // leaves the files pending for a later retry.
          await window.api.phoneInbox.markProcessed(pending.map((e) => e.id));
          await refreshCategories();
          bumpDataVersion();
        } catch (err) {
          // Don't tight-loop on a persistent failure; try again next event.
          console.error('Phone inbox import failed:', err);
          break;
        }
      }
    } finally {
      drainingRef.current = false;
    }
  }, [refreshCategories, bumpDataVersion]);

  // Either transport being on turns the drain on — getPending merges the
  // iCloud inbox and the Cloudflare relay behind the same surface.
  const phoneCaptureOn = Boolean(
    settings?.phoneInboxEnabled || settings?.phoneRelayEnabled
  );
  useEffect(() => {
    if (!phoneCaptureOn || !categoriesReady) return;
    void drainPhoneInbox(); // catch up on mount / when enabled
    const unsubscribe = window.api.phoneInbox.onNew(() => void drainPhoneInbox());
    const onFocus = () => void drainPhoneInbox();
    window.addEventListener('focus', onFocus);
    return () => {
      unsubscribe();
      window.removeEventListener('focus', onFocus);
    };
  }, [phoneCaptureOn, categoriesReady, drainPhoneInbox]);

  // Session handlers — exposed to DayToolbar (start/finish) and
  // Timeline (the ghost block + RecordingEditor) via DayView.
  // `pomodoro` in the input switches the session to pomodoro mode: the
  // main-process engine then owns the work/break cycle.
  const startSession = useCallback(
    async (input: {
      categoryId: number;
      note: string | null;
      pomodoro?: {
        workMinutes: number;
        breakMinutes: number;
        pomodorosPerCycle?: number;
      };
    }) => {
      if (input.pomodoro && settings) {
        const s = await window.api.pomodoro.start({
          categoryId: input.categoryId,
          note: input.note,
          workMinutes: input.pomodoro.workMinutes,
          breakMinutes: input.pomodoro.breakMinutes,
          longBreakMinutes: settings.pomodoroLongBreakMinutes,
          pomodorosPerCycle:
            input.pomodoro.pomodorosPerCycle ?? settings.pomodorosPerCycle,
        });
        setActiveSession(s);
      } else {
        const s = await window.api.activeSession.start({
          categoryId: input.categoryId,
          note: input.note,
        });
        setActiveSession(s);
      }
    },
    [settings]
  );

  const updateSession = useCallback(
    async (input: { categoryId?: number; note?: string | null }) => {
      const s = await window.api.activeSession.update(input);
      setActiveSession(s);
    },
    []
  );

  const finishSession = useCallback(async () => {
    if (!activeSession) return;
    // Pomodoro sessions finish in the main process — only the engine
    // knows the correct end time (the walk-away rule: finishing from
    // 'awaiting' ends the block when the last break ended, not now).
    if (activeSession.pomodoro) {
      await window.api.pomodoro.finish();
      setActiveSession(null);
      bumpDataVersion();
      return;
    }
    const now = new Date();
    const startAt = activeSession.startAt;
    const endAt = now.toISOString();
    // Guard: a near-instant Start→Finish (< 1s) is almost certainly a
    // misclick, not a real block. Discard quietly.
    if (now.getTime() - fromIso(startAt).getTime() < 1000) {
      await window.api.activeSession.clear();
      setActiveSession(null);
      return;
    }
    await window.api.blocks.create({
      categoryId: activeSession.categoryId,
      startAt,
      endAt,
      note: activeSession.note,
      // Recordings are always Actual. Explicit so a future refactor
      // doesn't silently change behavior via the default.
      kind: 'actual',
    });
    await window.api.activeSession.clear();
    setActiveSession(null);
    bumpDataVersion();
  }, [activeSession, bumpDataVersion]);

  const discardSession = useCallback(async () => {
    if (activeSessionRef.current?.pomodoro) {
      await window.api.pomodoro.discard();
    } else {
      await window.api.activeSession.clear();
    }
    setActiveSession(null);
  }, []);

  // The recovery dialog: "save as block ending now" calls a separate
  // commit path because activeSession isn't live yet — it's pending the
  // user's decision. (Live pomodoro finishes go through the engine; this
  // renderer-side path only handles sessions left behind by a crash.)
  const recoverSaveBlock = useCallback(
    async (s: ActiveSession, endAt: Date) => {
      const startAt = fromIso(s.startAt);
      if (endAt > startAt) {
        await window.api.blocks.create({
          categoryId: s.categoryId,
          startAt: s.startAt,
          endAt: endAt.toISOString(),
          note: s.note,
          kind: 'actual',
          pomodoro: s.pomodoro
            ? {
                source: 'pomodoro',
                repsCompleted: s.pomodoro.repsCompleted,
                workMinutes: s.pomodoro.workMinutes,
                breakMinutes: s.pomodoro.breakMinutes,
              }
            : undefined,
        });
        bumpDataVersion();
      }
      await window.api.activeSession.clear();
      setRecoveryPrompt(null);
      setActiveSession(null);
    },
    [bumpDataVersion]
  );

  const recoverDiscard = useCallback(async () => {
    await window.api.activeSession.clear();
    setRecoveryPrompt(null);
    setActiveSession(null);
  }, []);

  // In the Aggregate view, ←/→ step through the preset panes (Today,
  // Yesterday, This week, …) SPATIALLY, matching the left-to-right tab
  // row in the toolbar: → moves right along the row, ← moves left. From
  // a custom range, either key jumps back to Today.
  const cyclePreset = useCallback((delta: number) => {
    setRange((cur) => {
      const idx = PRESETS.findIndex((p) => p.label === cur.presetLabel);
      const next =
        idx === -1
          ? 0
          : Math.max(0, Math.min(PRESETS.length - 1, idx + delta));
      if (idx !== -1 && next === idx) return cur;
      const preset = PRESETS[next];
      const r = preset.make();
      return { from: r.from, to: r.to, presetLabel: preset.label };
    });
  }, []);

  // global shortcuts
  useGlobalShortcuts(
    useMemo(
      () => ({
        arrowleft: () =>
          view === 'day'
            ? setDay((d) => addDays(d, -1))
            : view === 'week'
              ? setDay((d) => addDays(d, -7))
              : cyclePreset(-1),
        arrowright: () =>
          view === 'day'
            ? setDay((d) => addDays(d, 1))
            : view === 'week'
              ? setDay((d) => addDays(d, 7))
              : cyclePreset(1),
        t: () => (view === 'day' || view === 'week') && setDay(new Date()),
        n: () => setCaptureOpen(true),
        '1': () => setView('day'),
        '2': () => setView('week'),
        '3': () => setView('aggregate'),
        'cmd+e': async () => {
          const r = await window.api.export.json();
          if (r.wrote) {
            console.log('Exported to', r.path);
          }
        },
        'cmd+,': () => setSettingsOpen((o) => !o),
        '?': () => setShortcutsOpen((o) => !o),
        escape: () => {
          setSettingsOpen(false);
          setShortcutsOpen(false);
          setCaptureOpen(false);
          return false;
        },
      }),
      [view, cyclePreset]
    )
  );

  if (!settings) {
    return <div className="h-full" />;
  }

  return (
    <div className="h-full flex flex-col bg-bg text-ink">
      <div
        className="drag-region h-7 shrink-0 border-b border-line/0"
        aria-hidden
      />
      <div className="flex-1 flex min-h-0">
        <Sidebar
          view={view}
          day={day}
          onDayChange={setDay}
          range={range}
          categories={visibleCategories}
          allCategories={allCategories}
          allGoals={allGoals}
          onRefreshCategories={refreshCategories}
          filterCategoryId={filterCategoryId}
          onFilterChange={setFilterCategoryId}
          onOpenSettings={() => setSettingsOpen(true)}
          dataVersion={dataVersion}
        />
        <main className="flex-1 flex flex-col min-w-0">
          <header className="no-drag flex items-center justify-between px-6 pt-2 pb-3 border-b border-line">
            <h1 className="text-sm font-medium tracking-tight text-muted">
              {view === 'day' ? 'Day' : view === 'week' ? 'Week' : 'Aggregate'}
            </h1>
            <div className="flex items-center gap-1">
              <button
                className={`tag-pill ${view === 'day' ? 'active' : ''}`}
                onClick={() => setView('day')}
                aria-pressed={view === 'day'}
              >
                Day
              </button>
              <button
                className={`tag-pill ${view === 'week' ? 'active' : ''}`}
                onClick={() => setView('week')}
                aria-pressed={view === 'week'}
              >
                Week
              </button>
              <button
                className={`tag-pill ${view === 'aggregate' ? 'active' : ''}`}
                onClick={() => setView('aggregate')}
                aria-pressed={view === 'aggregate'}
              >
                Aggregate
              </button>
            </div>
          </header>
          <div className="flex-1 min-h-0">
            {view === 'day' ? (
              <DayView
                day={day}
                settings={settings}
                categories={visibleCategories}
                allCategories={allCategories}
                filterCategoryId={filterCategoryId}
                onDataChanged={bumpDataVersion}
                dataVersion={dataVersion}
                activeSession={activeSession}
                pomodoro={pomodoro}
                onStartSession={startSession}
                onUpdateSession={updateSession}
                onFinishSession={finishSession}
                onDiscardSession={discardSession}
                onOpenCapture={() => setCaptureOpen(true)}
              />
            ) : view === 'week' ? (
              <WeekView
                day={day}
                settings={settings}
                allCategories={allCategories}
                filterCategoryId={filterCategoryId}
                dataVersion={dataVersion}
                onOpenDay={(d) => {
                  setDay(d);
                  setView('day');
                }}
              />
            ) : (
              <AggregateView
                range={range}
                onRangeChange={setRange}
                allCategories={allCategories}
                allGoals={allGoals}
                filterCategoryId={filterCategoryId}
                dataVersion={dataVersion}
              />
            )}
          </div>
        </main>
      </div>

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onUpdate={async (partial) => {
            const next = await window.api.settings.set(partial);
            setSettings(next);
          }}
          onOpenShortcuts={() => setShortcutsOpen(true)}
          onRefreshCategories={refreshCategories}
          onDataChanged={bumpDataVersion}
        />
      )}
      {shortcutsOpen && <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}
      {captureOpen && (
        <CaptureModal
          day={day}
          categories={captureCategories}
          onClose={() => setCaptureOpen(false)}
          onCommitted={async () => {
            await refreshCategories();
            bumpDataVersion();
            setCaptureOpen(false);
          }}
        />
      )}
      {recoveryPrompt && (
        <SessionRecoveryDialog
          session={recoveryPrompt}
          allCategories={allCategories}
          onSave={(endAt) => recoverSaveBlock(recoveryPrompt, endAt)}
          onDiscard={recoverDiscard}
        />
      )}
    </div>
  );
}

function makeInitialRange(): DateRange {
  const today = new Date();
  // Default: this week (Mon..Sun)
  const day = today.getDay();
  const offset = (day + 6) % 7; // 0 for Monday
  const monday = startOfLocalDay(addDays(today, -offset));
  const sunday = endOfLocalDay(addDays(monday, 6));
  return { from: monday, to: sunday, presetLabel: 'This week' };
}

export function rangeForListing(r: DateRange): { from: string; to: string } {
  return { from: toIso(r.from), to: toIso(r.to) };
}

export type { Block, Category };
