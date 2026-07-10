import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AppPaths } from '@shared/types';

let cached: AppPaths | null = null;

export function getPaths(): AppPaths {
  if (cached) return cached;
  const appDataDir = join(app.getPath('appData'), 'HourlyLogger');
  const backupDir = join(appDataDir, 'backups');
  mkdirSync(appDataDir, { recursive: true });
  mkdirSync(backupDir, { recursive: true });
  cached = {
    appDataDir,
    dbPath: join(appDataDir, 'data.db'),
    backupDir,
    settingsPath: join(appDataDir, 'settings.json'),
  };
  return cached;
}
