// Quick DB smoke test — exercises the same create/update/delete paths the
// IPC layer uses, against a throwaway sqlite file.
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'hl-smoke-'));
const dbPath = join(dir, 'data.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
  INSERT INTO schema_version VALUES (1);
  CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE TABLE blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (end_at > start_at)
  );
`);

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  } else {
    console.log('ok   ', msg);
  }
}

// 1) Create category
const cat = db
  .prepare('INSERT INTO categories (name, color) VALUES (?, ?)')
  .run('Work', '#A89F8A');
const catId = cat.lastInsertRowid;
assert(catId, 'category insert returns id');

// 2) Create block
const b1 = db
  .prepare(
    'INSERT INTO blocks (category_id, start_at, end_at) VALUES (?, ?, ?)'
  )
  .run(catId, '2026-05-21T13:00:00.000Z', '2026-05-21T14:00:00.000Z');
const b1Id = b1.lastInsertRowid;
assert(b1Id, 'block insert returns id');

// 3) Update via the same path
const updated = db
  .prepare(
    `UPDATE blocks SET category_id = ?, start_at = ?, end_at = ?, note = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`
  )
  .run(catId, '2026-05-21T13:00:00.000Z', '2026-05-21T14:30:00.000Z', 'edited', b1Id);
assert(updated.changes === 1, 'update affects exactly one row');

// 4) Delete
const del = db.prepare('DELETE FROM blocks WHERE id = ?').run(b1Id);
assert(del.changes === 1, 'delete affects exactly one row');
const left = db.prepare('SELECT COUNT(*) AS c FROM blocks').get();
assert(left.c === 0, 'block table is empty after delete');

// 5) Constraint: end > start
let threw = false;
try {
  db.prepare('INSERT INTO blocks (category_id, start_at, end_at) VALUES (?, ?, ?)')
    .run(catId, '2026-05-21T14:00:00.000Z', '2026-05-21T13:00:00.000Z');
} catch (e) {
  threw = true;
}
assert(threw, 'CHECK constraint rejects end <= start');

// 6) Overlapping blocks are allowed
db.prepare('INSERT INTO blocks (category_id, start_at, end_at) VALUES (?, ?, ?)')
  .run(catId, '2026-05-21T13:00:00.000Z', '2026-05-21T14:00:00.000Z');
db.prepare('INSERT INTO blocks (category_id, start_at, end_at) VALUES (?, ?, ?)')
  .run(catId, '2026-05-21T13:30:00.000Z', '2026-05-21T14:30:00.000Z');
const overlap = db.prepare('SELECT COUNT(*) AS c FROM blocks').get();
assert(overlap.c === 2, 'overlapping blocks coexist in storage');

db.close();
rmSync(dir, { recursive: true, force: true });
console.log('\nAll DB smoke tests passed.');
