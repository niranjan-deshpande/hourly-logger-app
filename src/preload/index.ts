import { contextBridge, ipcRenderer } from 'electron';
import type {
  ActiveSession,
  AliasEntry,
  AppPaths,
  AppSettings,
  Block,
  BlockPomodoro,
  CaptureCommitResult,
  Category,
  CommitDraft,
  DayEnergy,
  DayRecord,
  Goal,
  GoalExemption,
  PhoneInboxEntry,
  PomodoroSnapshot,
} from '../shared/types';

async function call<T>(channel: string, arg?: any): Promise<T> {
  const res = await ipcRenderer.invoke(channel, arg);
  if (res && typeof res === 'object' && 'ok' in res) {
    if (res.ok) return res.value as T;
    throw new Error(res.reason);
  }
  return res as T;
}

const api = {
  categories: {
    list: (opts: { includeArchived?: boolean } = {}) =>
      call<Category[]>('categories.list', opts),
    create: (input: { name: string; color: string }) =>
      call<Category>('categories.create', input),
    update: (input: {
      id: number;
      name?: string;
      color?: string;
      archived?: boolean;
    }) => call<Category>('categories.update', input),
  },
  blocks: {
    listByRange: (input: { from: string; to: string }) =>
      call<Block[]>('blocks.listByRange', input),
    create: (input: {
      categoryId: number;
      startAt: string;
      endAt: string;
      note: string | null;
      kind?: 'plan' | 'actual';
      pomodoro?: BlockPomodoro | null;
    }) => call<Block>('blocks.create', input),
    update: (input: {
      id: number;
      categoryId?: number;
      startAt?: string;
      endAt?: string;
      note?: string | null;
      kind?: 'plan' | 'actual';
      detached?: boolean;
      pomodoro?: BlockPomodoro | null;
    }) => call<Block>('blocks.update', input),
    delete: (id: number) => call<boolean>('blocks.delete', { id }),
  },
  goals: {
    list: () => call<Goal[]>('goals.list'),
    setWeekly: (input: { categoryId: number; minutes: number | null }) =>
      call<boolean>('goals.setWeekly', input),
    setHabit: (input: {
      categoryId: number;
      habit:
        | null
        | { kind: 'daily_habit' }
        | { kind: 'weekly_frequency'; target: number };
    }) => call<boolean>('goals.setHabit', input),
    listExemptions: (input: { from: string; to: string }) =>
      call<GoalExemption[]>('goals.listExemptions', input),
    setExemption: (input: {
      categoryId: number;
      date: string;
      excused: boolean;
    }) => call<boolean>('goals.setExemption', input),
  },
  settings: {
    get: () => call<AppSettings>('settings.get'),
    set: (partial: Partial<AppSettings>) =>
      call<AppSettings>('settings.set', partial),
  },
  days: {
    get: (date: string) => call<DayRecord | null>('days.get', { date }),
    listByRange: (input: { from: string; to: string }) =>
      call<DayRecord[]>('days.listByRange', input),
    upsert: (input: {
      date: string;
      energy?: DayEnergy | null;
      journal?: string | null;
    }) => call<DayRecord | null>('days.upsert', input),
  },
  paths: {
    get: () => call<AppPaths>('paths.get'),
  },
  activeSession: {
    get: () => call<ActiveSession | null>('activeSession.get'),
    start: (input: { categoryId: number; note?: string | null }) =>
      call<ActiveSession>('activeSession.start', input),
    update: (input: { categoryId?: number; note?: string | null }) =>
      call<ActiveSession>('activeSession.update', input),
    clear: () => call<boolean>('activeSession.clear'),
  },
  pomodoro: {
    start: (input: {
      categoryId: number;
      note?: string | null;
      workMinutes: number;
      breakMinutes: number;
      longBreakMinutes: number;
      pomodorosPerCycle: number;
      planBlockId?: number | null;
    }) => call<ActiveSession>('pomodoro.start', input),
    pause: () => call<PomodoroSnapshot>('pomodoro.pause'),
    resume: () => call<PomodoroSnapshot>('pomodoro.resume'),
    skipBreak: () => call<PomodoroSnapshot>('pomodoro.skipBreak'),
    extendWork: (input: { minutes: number }) =>
      call<PomodoroSnapshot>('pomodoro.extendWork', input),
    startNextRep: (input?: { workMinutes?: number }) =>
      call<PomodoroSnapshot>('pomodoro.startNextRep', input),
    setNextOverrides: (input: {
      workMinutes?: number | null;
      breakMinutes?: number | null;
    }) => call<PomodoroSnapshot>('pomodoro.setNextOverrides', input),
    dismissBreakOver: () => call<PomodoroSnapshot>('pomodoro.dismissBreakOver'),
    finish: () => call<Block | null>('pomodoro.finish'),
    discard: () => call<boolean>('pomodoro.discard'),
    getState: () => call<PomodoroSnapshot>('pomodoro.getState'),
    // Main-process push: 1 Hz while a timer runs, plus on every
    // transition. Returns an unsubscribe function.
    onTick: (cb: (snapshot: PomodoroSnapshot) => void): (() => void) => {
      const listener = (_e: unknown, snapshot: PomodoroSnapshot) =>
        cb(snapshot);
      ipcRenderer.on('pomodoro.tick', listener);
      return () => {
        ipcRenderer.removeListener('pomodoro.tick', listener);
      };
    },
  },
  calendar: {
    syncNow: () =>
      call<{ ok: boolean; error?: string; skipped?: boolean }>(
        'calendar.syncNow'
      ),
    disconnect: (input: { removeBlocks: boolean }) =>
      call<boolean>('calendar.disconnect', input),
    removeUrl: (input: { url: string }) =>
      call<boolean>('calendar.removeUrl', input),
  },
  export: {
    json: () => call<{ wrote: boolean; path?: string }>('export.json'),
    csvZip: () => call<{ wrote: boolean; path?: string }>('export.csvZip'),
  },
  import: {
    json: (opts: { confirm: boolean }) =>
      call<
        | { imported: false; preview?: { categories: number; blocks: number; exported_at: string; path: string } }
        | { imported: true; categories: number; blocks: number }
      >('import.json', opts),
  },
  capture: {
    commit: (input: { drafts: CommitDraft[] }) =>
      call<CaptureCommitResult>('capture.commit', input),
  },
  aliases: {
    get: () => call<AliasEntry[]>('aliases.get'),
  },
  phoneInbox: {
    getPending: () => call<PhoneInboxEntry[]>('phoneInbox.getPending'),
    markProcessed: (ids: string[]) =>
      call<boolean>('phoneInbox.markProcessed', { ids }),
    ensureCategory: () => call<number>('phoneInbox.ensureCategory'),
    // Main-process push: fired (debounced) when the iCloud inbox folder
    // changes. Returns an unsubscribe function.
    onNew: (cb: () => void): (() => void) => {
      const listener = () => cb();
      ipcRenderer.on('phoneInbox:new', listener);
      return () => {
        ipcRenderer.removeListener('phoneInbox:new', listener);
      };
    },
  },
  reveal: (path: string) => call<boolean>('reveal', { path }),
  openExternal: (url: string) => call<boolean>('openExternal', { url }),
};

export type Api = typeof api;

contextBridge.exposeInMainWorld('api', api);
