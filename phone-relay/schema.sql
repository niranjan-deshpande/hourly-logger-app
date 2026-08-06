-- Mailbox between phone and Mac. Entries are deleted once the Mac acks
-- them (the Mac keeps its own dedup ledger, so a lost ack can never
-- double-import). kv holds the catalog the Mac pushes for preset chips.
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  ts TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
