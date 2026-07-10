import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { appSettingsSchema } from '@shared/schema';
import type { AppSettings } from '@shared/types';
import { getPaths } from './paths';

const DEFAULTS: AppSettings = {
  dayStartHour: 6,
  dayEndHour: 24,
  theme: 'system',
  showArchived: false,
  // Calendar sync — unset by default; user opts in via Settings panel.
  gcalIcsUrls: [],
  gcalSyncIntervalMinutes: 15,
  gcalCategoryId: null,
  gcalLastSyncAt: null,
  gcalLastSyncError: null,
  // Pomodoro defaults — classic 25/5 with a 15-min long break every 4th.
  pomodoroWorkMinutes: 25,
  pomodoroBreakMinutes: 5,
  pomodoroLongBreakMinutes: 15,
  pomodorosPerCycle: 4,
  // Phone inbox — on by default; empty path resolves to the iCloud Drive
  // default at runtime. See src/main/phoneInbox.ts.
  phoneInboxEnabled: true,
  phoneInboxFolderPath: '',
  phoneInboxCategoryId: null,
  phoneInboxDefaultMinutes: 30,
  phoneInboxLastImportAt: null,
  phoneInboxLastError: null,
};

let cache: AppSettings | null = null;

export function getSettings(): AppSettings {
  if (cache) return cache;
  const { settingsPath } = getPaths();
  if (!existsSync(settingsPath)) {
    cache = { ...DEFAULTS };
    writeFileSync(settingsPath, JSON.stringify(cache, null, 2), 'utf8');
    return cache;
  }
  try {
    const raw = JSON.parse(readFileSync(settingsPath, 'utf8'));
    // Backward-compat: an earlier build stored a single URL in
    // `gcalIcsUrl`. Migrate it into the new array shape before parse,
    // so the legacy URL doesn't get silently dropped by Zod's strip-
    // unknowns behavior. Mutates `raw` in place; safe — it's a
    // throwaway object.
    if (
      typeof raw.gcalIcsUrl === 'string' &&
      raw.gcalIcsUrl.length > 0 &&
      !Array.isArray(raw.gcalIcsUrls)
    ) {
      raw.gcalIcsUrls = [raw.gcalIcsUrl];
    }
    delete raw.gcalIcsUrl;
    cache = appSettingsSchema.parse({ ...DEFAULTS, ...raw });
    // Persist the normalized shape so the legacy field is removed
    // from settings.json on disk.
    writeFileSync(settingsPath, JSON.stringify(cache, null, 2), 'utf8');
    return cache;
  } catch {
    cache = { ...DEFAULTS };
    return cache;
  }
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const current = getSettings();
  const merged = appSettingsSchema.parse({ ...current, ...partial });
  cache = merged;
  writeFileSync(getPaths().settingsPath, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}
