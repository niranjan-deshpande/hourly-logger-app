import { readdirSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Blocks, Categories, Days, Goals, getSchemaVersion } from './db';
import { getPaths } from './paths';
import type { ExportV1 } from '@shared/types';

const KEEP = 30;

export function buildSnapshot(): ExportV1 {
  return {
    format: 'hourly-logger-export',
    version: 1,
    exported_at: new Date().toISOString(),
    categories: Categories.list({ includeArchived: true }),
    blocks: Blocks.all(),
    days: Days.all(),
    goals: Goals.list(),
    goal_exemptions: Goals.allExemptions(),
  };
}

function listBackups() {
  const { backupDir } = getPaths();
  try {
    return readdirSync(backupDir)
      .filter((f) => f.startsWith('backup-') && f.endsWith('.json'))
      .map((f) => {
        const p = join(backupDir, f);
        return { path: p, mtime: statSync(p).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}

export function runDailyBackupIfDue(): { wrote: boolean; path?: string } {
  if (getSchemaVersion() === 0) return { wrote: false };
  const backups = listBackups();
  const now = Date.now();
  const newest = backups[0]?.mtime ?? 0;
  if (now - newest < 24 * 60 * 60 * 1000) return { wrote: false };

  const ts = new Date();
  const yyyy = ts.getFullYear();
  const mm = String(ts.getMonth() + 1).padStart(2, '0');
  const dd = String(ts.getDate()).padStart(2, '0');
  const hh = String(ts.getHours()).padStart(2, '0');
  const mi = String(ts.getMinutes()).padStart(2, '0');
  const filename = `backup-${yyyy}-${mm}-${dd}-${hh}${mi}.json`;
  const fullPath = join(getPaths().backupDir, filename);
  writeFileSync(fullPath, JSON.stringify(buildSnapshot(), null, 2), 'utf8');

  // rotate
  const after = listBackups();
  for (const b of after.slice(KEEP)) {
    try {
      unlinkSync(b.path);
    } catch {
      // ignore
    }
  }
  return { wrote: true, path: fullPath };
}
