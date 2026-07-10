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
} from '@shared/types';

export interface Api {
  categories: {
    list: (opts?: { includeArchived?: boolean }) => Promise<Category[]>;
    create: (input: { name: string; color: string }) => Promise<Category>;
    update: (input: {
      id: number;
      name?: string;
      color?: string;
      archived?: boolean;
    }) => Promise<Category>;
  };
  goals: {
    list: () => Promise<Goal[]>;
    setWeekly: (input: {
      categoryId: number;
      minutes: number | null;
    }) => Promise<boolean>;
    setHabit: (input: {
      categoryId: number;
      habit:
        | null
        | { kind: 'daily_habit' }
        | { kind: 'weekly_frequency'; target: number };
    }) => Promise<boolean>;
    listExemptions: (input: {
      from: string;
      to: string;
    }) => Promise<GoalExemption[]>;
    setExemption: (input: {
      categoryId: number;
      date: string;
      excused: boolean;
    }) => Promise<boolean>;
  };
  blocks: {
    listByRange: (input: { from: string; to: string }) => Promise<Block[]>;
    create: (input: {
      categoryId: number;
      startAt: string;
      endAt: string;
      note: string | null;
      kind?: 'plan' | 'actual';
      pomodoro?: BlockPomodoro | null;
    }) => Promise<Block>;
    update: (input: {
      id: number;
      categoryId?: number;
      startAt?: string;
      endAt?: string;
      note?: string | null;
      kind?: 'plan' | 'actual';
      detached?: boolean;
      pomodoro?: BlockPomodoro | null;
    }) => Promise<Block>;
    delete: (id: number) => Promise<boolean>;
  };
  settings: {
    get: () => Promise<AppSettings>;
    set: (partial: Partial<AppSettings>) => Promise<AppSettings>;
  };
  days: {
    get: (date: string) => Promise<DayRecord | null>;
    listByRange: (input: { from: string; to: string }) => Promise<DayRecord[]>;
    upsert: (input: {
      date: string;
      energy?: DayEnergy | null;
      journal?: string | null;
    }) => Promise<DayRecord | null>;
  };
  paths: {
    get: () => Promise<AppPaths>;
  };
  activeSession: {
    get: () => Promise<ActiveSession | null>;
    start: (input: {
      categoryId: number;
      note?: string | null;
    }) => Promise<ActiveSession>;
    update: (input: {
      categoryId?: number;
      note?: string | null;
    }) => Promise<ActiveSession>;
    clear: () => Promise<boolean>;
  };
  pomodoro: {
    start: (input: {
      categoryId: number;
      note?: string | null;
      workMinutes: number;
      breakMinutes: number;
      longBreakMinutes: number;
      pomodorosPerCycle: number;
      planBlockId?: number | null;
    }) => Promise<ActiveSession>;
    pause: () => Promise<PomodoroSnapshot>;
    resume: () => Promise<PomodoroSnapshot>;
    skipBreak: () => Promise<PomodoroSnapshot>;
    extendWork: (input: { minutes: number }) => Promise<PomodoroSnapshot>;
    startNextRep: (input?: { workMinutes?: number }) => Promise<PomodoroSnapshot>;
    setNextOverrides: (input: {
      workMinutes?: number | null;
      breakMinutes?: number | null;
    }) => Promise<PomodoroSnapshot>;
    dismissBreakOver: () => Promise<PomodoroSnapshot>;
    finish: () => Promise<Block | null>;
    discard: () => Promise<boolean>;
    getState: () => Promise<PomodoroSnapshot>;
    onTick: (cb: (snapshot: PomodoroSnapshot) => void) => () => void;
  };
  calendar: {
    syncNow: () => Promise<{
      ok: boolean;
      error?: string;
      skipped?: boolean;
    }>;
    disconnect: (input: { removeBlocks: boolean }) => Promise<boolean>;
    removeUrl: (input: { url: string }) => Promise<boolean>;
  };
  export: {
    json: () => Promise<{ wrote: boolean; path?: string }>;
    csvZip: () => Promise<{ wrote: boolean; path?: string }>;
  };
  import: {
    json: (opts: { confirm: boolean }) => Promise<
      | {
          imported: false;
          preview?: {
            categories: number;
            blocks: number;
            exported_at: string;
            path: string;
          };
        }
      | { imported: true; categories: number; blocks: number }
    >;
  };
  capture: {
    commit: (input: { drafts: CommitDraft[] }) => Promise<CaptureCommitResult>;
  };
  aliases: {
    get: () => Promise<AliasEntry[]>;
  };
  phoneInbox: {
    getPending: () => Promise<PhoneInboxEntry[]>;
    markProcessed: (ids: string[]) => Promise<boolean>;
    ensureCategory: () => Promise<number>;
    onNew: (cb: () => void) => () => void;
  };
  reveal: (path: string) => Promise<boolean>;
  openExternal: (url: string) => Promise<boolean>;
}
