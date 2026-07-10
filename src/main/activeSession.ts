import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { activeSessionSchema } from '@shared/schema';
import type { ActiveSession } from '@shared/types';
import { getPaths } from './paths';

// The session lives in a tiny JSON file next to settings.json. It's read
// once on app launch (for recovery) and on demand from the renderer; while
// the app is closed it's just an inert file on disk — no background
// process, no memory cost.

function sessionPath(): string {
  return join(getPaths().appDataDir, 'active-session.json');
}

export function readActiveSession(): ActiveSession | null {
  const p = sessionPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    return activeSessionSchema.parse(raw);
  } catch {
    // A malformed file shouldn't crash the app or block recording. Treat as
    // "no session" — the user can start a fresh one.
    return null;
  }
}

export function writeActiveSession(s: ActiveSession): ActiveSession {
  const parsed = activeSessionSchema.parse(s);
  writeFileSync(sessionPath(), JSON.stringify(parsed, null, 2), 'utf8');
  return parsed;
}

export function clearActiveSession(): void {
  const p = sessionPath();
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    // If the file is locked or already gone, ignore — the next read will
    // return null either way.
  }
}
