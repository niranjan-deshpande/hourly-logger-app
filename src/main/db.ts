import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import type {
  Block,
  Category,
  DayEnergy,
  DayRecord,
  Goal,
  GoalExemption,
  GoalKind,
  ID,
} from '@shared/types';
import { getPaths } from './paths';

let db: DB | null = null;

export function getDb(): DB {
  if (db) return db;
  const { dbPath } = getPaths();
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function currentVersion(db: DB): number {
  const exists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
    )
    .get();
  if (!exists) return 0;
  const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as
    | { version: number }
    | undefined;
  return row?.version ?? 0;
}

function migrate(db: DB) {
  const version = currentVersion(db);
  if (version === 0) {
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
      INSERT INTO schema_version (version) VALUES (1);

      CREATE TABLE categories (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL UNIQUE,
        color      TEXT NOT NULL,
        archived   INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE TABLE blocks (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL REFERENCES categories(id),
        start_at    TEXT NOT NULL,
        end_at      TEXT NOT NULL,
        note        TEXT,
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        CHECK (end_at > start_at)
      );

      CREATE INDEX idx_blocks_start ON blocks(start_at);
      CREATE INDEX idx_blocks_category ON blocks(category_id);
    `);
  }
  // v2: every block gets a kind. Up to this point the app only logged
  // actuals, so existing rows default to 'actual' via the DEFAULT clause.
  // The CHECK constraint makes a corrupt value impossible.
  if (currentVersion(db) < 2) {
    db.exec(`
      ALTER TABLE blocks
        ADD COLUMN kind TEXT NOT NULL DEFAULT 'actual'
          CHECK (kind IN ('plan','actual'));
      UPDATE schema_version SET version = 2;
    `);
  }
  // v3: synced-block identity. `external_source` ('gcal' for now)
  // namespaces the id space for future sources; `external_id` is the
  // stable per-instance id from the source (UID for non-recurring,
  // UID + instance-start for recurring). `detached=1` means the user
  // edited the block in HL — sync ignores it from then on.
  if (currentVersion(db) < 3) {
    db.exec(`
      ALTER TABLE blocks ADD COLUMN external_source TEXT;
      ALTER TABLE blocks ADD COLUMN external_id     TEXT;
      ALTER TABLE blocks ADD COLUMN detached        INTEGER NOT NULL DEFAULT 0;
      CREATE UNIQUE INDEX idx_blocks_external
        ON blocks(external_source, external_id)
        WHERE external_id IS NOT NULL;
      UPDATE schema_version SET version = 3;
    `);
  }
  // v4: clean up legacy single-URL sync rows. The previous build used
  // a flat `external_source = 'gcal'` for ALL synced blocks. The new
  // multi-URL build uses `gcal:<hash12 of url>` so we can distinguish
  // calendars. Without this cleanup, post-upgrade syncs would produce
  // duplicates: old rows with source `gcal` (now orphans, source
  // matches no current URL hash) plus new rows with source
  // `gcal:<hash>`. We only nuke non-detached rows — detached blocks
  // are user-owned now and survive.
  if (currentVersion(db) < 4) {
    db.exec(`
      DELETE FROM blocks WHERE external_source = 'gcal' AND detached = 0;
      UPDATE schema_version SET version = 4;
    `);
  }
  // v5: pomodoro metadata. Nullable JSON TEXT — a plan block carries the
  // launchable sequence params; an actual block carries provenance + rep
  // count. Nothing queries inside the JSON, so one column beats five
  // sparse ones.
  if (currentVersion(db) < 5) {
    db.exec(`
      ALTER TABLE blocks ADD COLUMN pomodoro TEXT;
      UPDATE schema_version SET version = 5;
    `);
  }
  // v6: per-category goals. weekly_goal_minutes — a weekly hour target
  // (NULL = no goal); daily_goal — 0/1 habit flag ("do this at least
  // once a day"), progress/streaks computed from blocks at render time.
  if (currentVersion(db) < 6) {
    db.exec(`
      ALTER TABLE categories ADD COLUMN weekly_goal_minutes INTEGER;
      ALTER TABLE categories ADD COLUMN daily_goal INTEGER NOT NULL DEFAULT 0;
      UPDATE schema_version SET version = 6;
    `);
  }
  // v7: per-day reflection. A whole-day energy preset and a short journal
  // entry, keyed by local calendar date. Independent of blocks — the day,
  // not the block, is the unit for "how it felt".
  if (currentVersion(db) < 7) {
    db.exec(`
      CREATE TABLE days (
        date       TEXT PRIMARY KEY,
        energy     TEXT,
        journal    TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      UPDATE schema_version SET version = 7;
    `);
  }
  // v8: goals get their own effective-dated table. A goal row is one
  // *revision*: it applies to local days in [effective_from, retired_from);
  // retired_from IS NULL means active. Changing a target retires the old
  // row (retired_from = today) and inserts a new one (effective_from =
  // today), so history views can score past weeks against the target that
  // applied then. `target` is minutes/week for weekly_minutes, always 1
  // for daily_habit, and days/week (1–6) for weekly_frequency. Exemptions
  // are keyed by category (not goal id) so they survive goal revisions.
  // Legacy categories.weekly_goal_minutes/daily_goal are seeded into goals
  // here and then left as dead columns (migrations run outside a
  // transaction and every prior one was additive — dropping would break
  // that). At most one active weekly_minutes goal and one active habit-kind
  // goal per category — enforced by the write API, not the schema.
  if (currentVersion(db) < 8) {
    db.exec(`
      CREATE TABLE goals (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id    INTEGER NOT NULL REFERENCES categories(id),
        kind           TEXT NOT NULL CHECK (kind IN ('weekly_minutes','daily_habit','weekly_frequency')),
        target         INTEGER NOT NULL,
        effective_from TEXT NOT NULL,
        retired_from   TEXT,
        created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE goal_exemptions (
        category_id INTEGER NOT NULL REFERENCES categories(id),
        date        TEXT NOT NULL,
        PRIMARY KEY (category_id, date)
      );
      INSERT INTO goals (category_id, kind, target, effective_from)
        SELECT id, 'weekly_minutes', weekly_goal_minutes, '1970-01-01' FROM categories WHERE weekly_goal_minutes IS NOT NULL;
      INSERT INTO goals (category_id, kind, target, effective_from)
        SELECT id, 'daily_habit', 1, '1970-01-01' FROM categories WHERE daily_goal = 1;
      UPDATE schema_version SET version = 8;
    `);
  }
}

export function getSchemaVersion(): number {
  return currentVersion(getDb());
}

// --- helpers for boolean coercion ---
function rowToCategory(r: any): Category {
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    archived: !!r.archived,
    created_at: r.created_at,
  };
}

// Local calendar day as YYYY-MM-DD — the anchor for goal revisions.
function localToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function rowToGoal(r: any): Goal {
  return {
    id: r.id,
    category_id: r.category_id,
    kind: r.kind as GoalKind,
    target: r.target,
    effective_from: r.effective_from,
    retired_from: r.retired_from ?? null,
    created_at: r.created_at,
  };
}

function rowToBlock(r: any): Block {
  return {
    id: r.id,
    category_id: r.category_id,
    start_at: r.start_at,
    end_at: r.end_at,
    note: r.note,
    kind: r.kind,
    external_source: r.external_source ?? null,
    external_id: r.external_id ?? null,
    detached: !!r.detached,
    pomodoro: parsePomodoro(r.pomodoro),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// Corrupt JSON in the column must never take a block down with it — the
// block just loses its pomodoro affordances.
function parsePomodoro(raw: unknown): Block['pomodoro'] {
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// --- Categories CRUD ---
export const Categories = {
  list({ includeArchived = false }: { includeArchived?: boolean } = {}): Category[] {
    const sql = includeArchived
      ? 'SELECT * FROM categories ORDER BY archived ASC, name COLLATE NOCASE ASC'
      : 'SELECT * FROM categories WHERE archived = 0 ORDER BY name COLLATE NOCASE ASC';
    return (getDb().prepare(sql).all() as any[]).map(rowToCategory);
  },
  get(id: ID): Category | undefined {
    const r = getDb().prepare('SELECT * FROM categories WHERE id = ?').get(id);
    return r ? rowToCategory(r) : undefined;
  },
  create({ name, color }: { name: string; color: string }): Category {
    const info = getDb()
      .prepare('INSERT INTO categories (name, color) VALUES (?, ?)')
      .run(name, color);
    return Categories.get(info.lastInsertRowid as number)!;
  },
  update({
    id,
    name,
    color,
    archived,
  }: {
    id: ID;
    name?: string;
    color?: string;
    archived?: boolean;
  }): Category {
    const existing = Categories.get(id);
    if (!existing) throw new Error(`Category ${id} not found`);
    const merged = {
      name: name ?? existing.name,
      color: color ?? existing.color,
      archived: archived ?? existing.archived,
    };
    getDb()
      .prepare(
        `UPDATE categories
         SET name = ?, color = ?, archived = ?
         WHERE id = ?`
      )
      .run(merged.name, merged.color, merged.archived ? 1 : 0, id);
    return Categories.get(id)!;
  },
};

// --- Goals CRUD (v8). Goals are effective-dated revisions; see the v8
// migration comment. The write API enforces "at most one active
// weekly_minutes goal and one active habit-kind goal per category". ---
export const Goals = {
  // All rows, active AND retired — the renderer needs retired revisions to
  // score past weeks against the target that applied then.
  list(): Goal[] {
    return (
      getDb()
        .prepare('SELECT * FROM goals ORDER BY category_id, effective_from')
        .all() as any[]
    ).map(rowToGoal);
  },
  // minutes: a new weekly target, or null to clear it. Retires the active
  // revision and inserts a new one dated today; but if the active revision
  // already started today it's updated (or deleted, for null) in place, so
  // we never leave a zero-length [today, today) revision. A no-op when the
  // target is unchanged.
  setWeekly({ categoryId, minutes }: { categoryId: ID; minutes: number | null }) {
    const db = getDb();
    const today = localToday();
    const active = db
      .prepare(
        `SELECT * FROM goals
         WHERE category_id = ? AND kind = 'weekly_minutes' AND retired_from IS NULL`
      )
      .get(categoryId) as any;
    const current = active ? (active.target as number) : null;
    if (minutes === current) return; // unchanged
    if (active && active.effective_from === today) {
      if (minutes === null) {
        db.prepare('DELETE FROM goals WHERE id = ?').run(active.id);
      } else {
        db.prepare('UPDATE goals SET target = ? WHERE id = ?').run(minutes, active.id);
      }
      return;
    }
    if (active) {
      db.prepare('UPDATE goals SET retired_from = ? WHERE id = ?').run(today, active.id);
    }
    if (minutes !== null) {
      db.prepare(
        `INSERT INTO goals (category_id, kind, target, effective_from)
         VALUES (?, 'weekly_minutes', ?, ?)`
      ).run(categoryId, minutes, today);
    }
  },
  // habit: null (off), an every-day habit, or an N-days-per-week habit.
  // Replaces whichever habit-kind revision (daily_habit OR
  // weekly_frequency) is active — this is how daily ⇄ frequency switches
  // happen. Same retire/replace/in-place rules as setWeekly.
  setHabit({
    categoryId,
    habit,
  }: {
    categoryId: ID;
    habit: null | { kind: 'daily_habit' } | { kind: 'weekly_frequency'; target: number };
  }) {
    const db = getDb();
    const today = localToday();
    const active = db
      .prepare(
        `SELECT * FROM goals
         WHERE category_id = ?
           AND kind IN ('daily_habit','weekly_frequency')
           AND retired_from IS NULL`
      )
      .get(categoryId) as any;
    const desiredKind = habit ? habit.kind : null;
    const desiredTarget = habit ? (habit.kind === 'daily_habit' ? 1 : habit.target) : null;
    if (!active && habit === null) return; // nothing to do
    if (active && active.kind === desiredKind && active.target === desiredTarget) {
      return; // unchanged
    }
    if (active && active.effective_from === today) {
      if (habit === null) {
        db.prepare('DELETE FROM goals WHERE id = ?').run(active.id);
      } else {
        db.prepare('UPDATE goals SET kind = ?, target = ? WHERE id = ?').run(
          desiredKind,
          desiredTarget,
          active.id
        );
      }
      return;
    }
    if (active) {
      db.prepare('UPDATE goals SET retired_from = ? WHERE id = ?').run(today, active.id);
    }
    if (habit) {
      db.prepare(
        `INSERT INTO goals (category_id, kind, target, effective_from)
         VALUES (?, ?, ?, ?)`
      ).run(categoryId, desiredKind, desiredTarget, today);
    }
  },
  listExemptions({ from, to }: { from: string; to: string }): GoalExemption[] {
    return getDb()
      .prepare(
        `SELECT category_id, date FROM goal_exemptions
         WHERE date >= ? AND date <= ? ORDER BY category_id, date`
      )
      .all(from, to) as GoalExemption[];
  },
  allExemptions(): GoalExemption[] {
    return getDb()
      .prepare('SELECT category_id, date FROM goal_exemptions ORDER BY category_id, date')
      .all() as GoalExemption[];
  },
  setExemption({
    categoryId,
    date,
    excused,
  }: {
    categoryId: ID;
    date: string;
    excused: boolean;
  }) {
    const db = getDb();
    if (excused) {
      db.prepare(
        'INSERT OR IGNORE INTO goal_exemptions (category_id, date) VALUES (?, ?)'
      ).run(categoryId, date);
    } else {
      db.prepare('DELETE FROM goal_exemptions WHERE category_id = ? AND date = ?').run(
        categoryId,
        date
      );
    }
  },
};

// --- Blocks CRUD ---
export const Blocks = {
  listByRange({ from, to }: { from: string; to: string }): Block[] {
    const rows = getDb()
      .prepare(
        `SELECT * FROM blocks
         WHERE end_at > ? AND start_at < ?
         ORDER BY start_at ASC`
      )
      .all(from, to) as any[];
    return rows.map(rowToBlock);
  },
  get(id: ID): Block | undefined {
    const r = getDb().prepare('SELECT * FROM blocks WHERE id = ?').get(id);
    return r ? rowToBlock(r) : undefined;
  },
  create(input: {
    categoryId: ID;
    startAt: string;
    endAt: string;
    note: string | null;
    kind?: 'plan' | 'actual';
    externalSource?: string | null;
    externalId?: string | null;
    pomodoro?: Block['pomodoro'];
  }): Block {
    const info = getDb()
      .prepare(
        `INSERT INTO blocks
           (category_id, start_at, end_at, note, kind, external_source, external_id, pomodoro)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.categoryId,
        input.startAt,
        input.endAt,
        input.note ?? null,
        input.kind ?? 'actual',
        input.externalSource ?? null,
        input.externalId ?? null,
        input.pomodoro ? JSON.stringify(input.pomodoro) : null
      );
    return Blocks.get(info.lastInsertRowid as number)!;
  },
  update(input: {
    id: ID;
    categoryId?: ID;
    startAt?: string;
    endAt?: string;
    note?: string | null;
    kind?: 'plan' | 'actual';
    detached?: boolean;
    pomodoro?: Block['pomodoro'];
  }): Block {
    const existing = Blocks.get(input.id);
    if (!existing) throw new Error(`Block ${input.id} not found`);
    const merged = {
      category_id: input.categoryId ?? existing.category_id,
      start_at: input.startAt ?? existing.start_at,
      end_at: input.endAt ?? existing.end_at,
      note: input.note === undefined ? existing.note : input.note,
      kind: input.kind ?? existing.kind,
      // Detach is sticky: once set, you can only re-set it via this
      // path. The sync engine never clears it.
      detached: input.detached === undefined ? existing.detached : input.detached,
      // undefined leaves it untouched; explicit null clears it.
      pomodoro: input.pomodoro === undefined ? existing.pomodoro : input.pomodoro,
    };
    getDb()
      .prepare(
        `UPDATE blocks
         SET category_id = ?, start_at = ?, end_at = ?, note = ?, kind = ?,
             detached = ?, pomodoro = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      )
      .run(
        merged.category_id,
        merged.start_at,
        merged.end_at,
        merged.note,
        merged.kind,
        merged.detached ? 1 : 0,
        merged.pomodoro ? JSON.stringify(merged.pomodoro) : null,
        input.id
      );
    return Blocks.get(input.id)!;
  },
  delete(id: ID) {
    getDb().prepare('DELETE FROM blocks WHERE id = ?').run(id);
  },
  all(): Block[] {
    const rows = getDb()
      .prepare('SELECT * FROM blocks ORDER BY start_at ASC')
      .all() as any[];
    return rows.map(rowToBlock);
  },
};

// --- Days CRUD (per-day energy + journal) ---
function rowToDay(r: any): DayRecord {
  return {
    date: r.date,
    energy: (r.energy ?? null) as DayEnergy | null,
    journal: r.journal ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export const Days = {
  get(date: string): DayRecord | undefined {
    const r = getDb().prepare('SELECT * FROM days WHERE date = ?').get(date);
    return r ? rowToDay(r) : undefined;
  },
  listByRange({ from, to }: { from: string; to: string }): DayRecord[] {
    const rows = getDb()
      .prepare(
        'SELECT * FROM days WHERE date >= ? AND date <= ? ORDER BY date ASC'
      )
      .all(from, to) as any[];
    return rows.map(rowToDay);
  },
  all(): DayRecord[] {
    const rows = getDb()
      .prepare('SELECT * FROM days ORDER BY date ASC')
      .all() as any[];
    return rows.map(rowToDay);
  },
  // Upsert: undefined leaves a field as-is; explicit null clears it. A row
  // that ends up fully empty (no energy, no journal) is deleted so the
  // table doesn't accumulate blank days.
  upsert(input: {
    date: string;
    energy?: DayEnergy | null;
    journal?: string | null;
  }): DayRecord | undefined {
    const existing = Days.get(input.date);
    const energy =
      input.energy === undefined ? existing?.energy ?? null : input.energy;
    const journal =
      input.journal === undefined ? existing?.journal ?? null : input.journal;
    const trimmedJournal = journal && journal.trim() ? journal : null;

    if (energy == null && trimmedJournal == null) {
      if (existing) getDb().prepare('DELETE FROM days WHERE date = ?').run(input.date);
      return undefined;
    }
    if (existing) {
      getDb()
        .prepare(
          `UPDATE days SET energy = ?, journal = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE date = ?`
        )
        .run(energy, trimmedJournal, input.date);
    } else {
      getDb()
        .prepare('INSERT INTO days (date, energy, journal) VALUES (?, ?, ?)')
        .run(input.date, energy, trimmedJournal);
    }
    return Days.get(input.date);
  },
};

export function replaceAll({
  categories,
  blocks,
  days,
  goals,
  goalExemptions,
}: {
  categories: Category[];
  blocks: Block[];
  days: DayRecord[];
  goals: Goal[];
  goalExemptions: GoalExemption[];
}) {
  const conn = getDb();
  const tx = conn.transaction(() => {
    // Delete children before parents (foreign_keys = ON).
    conn.exec(
      'DELETE FROM blocks; DELETE FROM goals; DELETE FROM goal_exemptions; DELETE FROM categories; DELETE FROM days;'
    );
    // Legacy goal columns still exist on `categories` (dead as of v8) but
    // carry NOT NULL / DEFAULT constraints only on daily_goal, so we let
    // them default and never write them.
    const insertCat = conn.prepare(
      `INSERT INTO categories (id, name, color, archived, created_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const c of categories) {
      insertCat.run(c.id, c.name, c.color, c.archived ? 1 : 0, c.created_at);
    }
    const insertGoal = conn.prepare(
      `INSERT INTO goals
         (id, category_id, kind, target, effective_from, retired_from, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const g of goals) {
      insertGoal.run(
        g.id,
        g.category_id,
        g.kind,
        g.target,
        g.effective_from,
        g.retired_from ?? null,
        g.created_at
      );
    }
    const insertExemption = conn.prepare(
      'INSERT INTO goal_exemptions (category_id, date) VALUES (?, ?)'
    );
    for (const e of goalExemptions) {
      insertExemption.run(e.category_id, e.date);
    }
    const insertBlock = conn.prepare(
      `INSERT INTO blocks
         (id, category_id, start_at, end_at, note, kind,
          external_source, external_id, detached, pomodoro,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const b of blocks) {
      insertBlock.run(
        b.id,
        b.category_id,
        b.start_at,
        b.end_at,
        b.note,
        // Older exports (pre-kind) round-trip as 'actual' — the only thing
        // the app could have written when those exports were created.
        b.kind ?? 'actual',
        // Pre-v3 exports won't have these; default to non-synced.
        b.external_source ?? null,
        b.external_id ?? null,
        b.detached ? 1 : 0,
        // Pre-v5 exports won't have this; default to no pomodoro meta.
        b.pomodoro ? JSON.stringify(b.pomodoro) : null,
        b.created_at,
        b.updated_at
      );
    }
    const insertDay = conn.prepare(
      `INSERT INTO days (date, energy, journal, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const d of days) {
      insertDay.run(
        d.date,
        d.energy ?? null,
        d.journal ?? null,
        d.created_at,
        d.updated_at
      );
    }
  });
  tx();
}
