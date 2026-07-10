import { dialog, ipcMain, shell } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import {
  activeSessionStartSchema,
  activeSessionUpdateSchema,
  blockCreateSchema,
  blockUpdateSchema,
  captureCommitSchema,
  categoryCreateSchema,
  categoryUpdateSchema,
  dayUpsertSchema,
  exportV1Schema,
  goalListExemptionsSchema,
  goalSetExemptionSchema,
  goalSetHabitSchema,
  goalSetWeeklySchema,
  phoneInboxMarkProcessedSchema,
  pomodoroExtendSchema,
  pomodoroNextOverridesSchema,
  pomodoroStartNextRepSchema,
  pomodoroStartSchema,
} from '@shared/schema';
import type { AppSettings, Goal } from '@shared/types';
import { Blocks, Categories, Days, Goals, replaceAll } from './db';
import { buildSnapshot } from './backup';
import { getPaths } from './paths';
import { getSettings, updateSettings } from './settings';
import { commitCapture } from './capture';
import { getAliases } from './aliases';
import {
  clearActiveSession,
  readActiveSession,
  writeActiveSession,
} from './activeSession';
import {
  disconnectCalendar,
  removeCalendarUrl,
  restartCalendarSyncTimer,
  syncNow as syncCalendarNow,
} from './calendarSync';
import {
  ensureInboxCategory,
  getPending as getPhonePending,
  markProcessed as markPhoneProcessed,
  restartPhoneInbox,
} from './phoneInbox';
import * as pomodoro from './pomodoro/engine';

function handle<T>(channel: string, fn: (arg: any) => T | Promise<T>) {
  ipcMain.handle(channel, async (_e, arg) => {
    try {
      return { ok: true, value: await fn(arg) };
    } catch (err: any) {
      return { ok: false, reason: err?.message ?? String(err) };
    }
  });
}

export function registerIpc() {
  handle('categories.list', ({ includeArchived }: { includeArchived?: boolean } = {}) =>
    Categories.list({ includeArchived })
  );
  handle('categories.create', (raw) => {
    const input = categoryCreateSchema.parse(raw);
    return Categories.create(input);
  });
  handle('categories.update', (raw) => {
    const input = categoryUpdateSchema.parse(raw);
    return Categories.update(input);
  });

  handle('blocks.listByRange', ({ from, to }: { from: string; to: string }) =>
    Blocks.listByRange({ from, to })
  );
  handle('blocks.create', (raw) => {
    const input = blockCreateSchema.parse(raw);
    return Blocks.create({
      categoryId: input.categoryId,
      startAt: input.startAt,
      endAt: input.endAt,
      note: input.note ?? null,
      kind: input.kind,
      pomodoro: input.pomodoro,
    });
  });
  handle('blocks.update', (raw) => {
    const input = blockUpdateSchema.parse(raw);
    return Blocks.update({
      id: input.id,
      categoryId: input.categoryId,
      startAt: input.startAt,
      endAt: input.endAt,
      note: input.note,
      kind: input.kind,
      detached: input.detached,
      pomodoro: input.pomodoro,
    });
  });
  handle('blocks.delete', ({ id }: { id: number }) => {
    Blocks.delete(id);
    return true;
  });

  // Per-day energy + journal.
  handle('days.get', ({ date }: { date: string }) => Days.get(date) ?? null);
  handle('days.listByRange', ({ from, to }: { from: string; to: string }) =>
    Days.listByRange({ from, to })
  );
  handle('days.upsert', (raw) => {
    const input = dayUpsertSchema.parse(raw);
    return Days.upsert(input) ?? null;
  });

  // Goals (v8): effective-dated targets + per-day exemptions.
  handle('goals.list', () => Goals.list());
  handle('goals.setWeekly', (raw) => {
    const input = goalSetWeeklySchema.parse(raw);
    Goals.setWeekly(input);
    return true;
  });
  handle('goals.setHabit', (raw) => {
    const input = goalSetHabitSchema.parse(raw);
    Goals.setHabit(input);
    return true;
  });
  handle('goals.listExemptions', (raw) => {
    const input = goalListExemptionsSchema.parse(raw);
    return Goals.listExemptions(input);
  });
  handle('goals.setExemption', (raw) => {
    const input = goalSetExemptionSchema.parse(raw);
    Goals.setExemption(input);
    return true;
  });

  handle('settings.get', () => getSettings());
  handle('settings.set', (partial: Partial<AppSettings>) => {
    const before = getSettings();
    const after = updateSettings(partial);
    // If the user changed the sync interval, restart the timer so
    // the new cadence takes effect immediately rather than at next
    // tick (which could be 15 min away).
    if (
      partial.gcalSyncIntervalMinutes != null &&
      before.gcalSyncIntervalMinutes !== after.gcalSyncIntervalMinutes
    ) {
      restartCalendarSyncTimer();
    }
    // Re-watch when the phone-inbox toggle or folder changes, so the new
    // configuration takes effect immediately.
    if (
      (partial.phoneInboxEnabled != null &&
        before.phoneInboxEnabled !== after.phoneInboxEnabled) ||
      (partial.phoneInboxFolderPath != null &&
        before.phoneInboxFolderPath !== after.phoneInboxFolderPath)
    ) {
      restartPhoneInbox();
    }
    return after;
  });
  handle('paths.get', () => getPaths());

  handle('calendar.syncNow', () => syncCalendarNow());
  handle(
    'calendar.disconnect',
    ({ removeBlocks }: { removeBlocks: boolean }) => {
      disconnectCalendar({ removeBlocks });
      return true;
    }
  );
  handle('calendar.removeUrl', ({ url }: { url: string }) => {
    removeCalendarUrl(url);
    return true;
  });

  // Active session: tiny JSON file backing the live-recording feature.
  // `start` captures the current wall-clock moment server-side so the
  // renderer can't fudge the start time later.
  handle('activeSession.get', () => readActiveSession());
  handle('activeSession.start', (raw) => {
    const input = activeSessionStartSchema.parse(raw);
    // One live session at a time, same guard the pomodoro engine has —
    // otherwise a start racing the engine would silently overwrite its
    // persisted session file.
    if (readActiveSession()) {
      throw new Error('A session is already running — finish or discard it first.');
    }
    return writeActiveSession({
      startAt: new Date().toISOString(),
      categoryId: input.categoryId,
      note: input.note ?? null,
    });
  });
  handle('activeSession.update', (raw) => {
    const input = activeSessionUpdateSchema.parse(raw);
    const current = readActiveSession();
    if (!current) {
      throw new Error('No active session to update');
    }
    // Spread `current` so fields this handler doesn't know about (the
    // pomodoro machine state) survive a category/note edit.
    const next = writeActiveSession({
      ...current,
      categoryId: input.categoryId ?? current.categoryId,
      note: input.note === undefined ? current.note : input.note,
    });
    // Keep the engine's in-memory copy in sync, or its next persist()
    // would clobber this edit.
    pomodoro.noteSessionUpdated(next);
    return next;
  });
  handle('activeSession.clear', () => {
    clearActiveSession();
    return true;
  });

  // Pomodoro sequence engine — see src/main/pomodoro/engine.ts.
  handle('pomodoro.start', (raw) => {
    const input = pomodoroStartSchema.parse(raw);
    return pomodoro.startSequence(input);
  });
  handle('pomodoro.pause', () => pomodoro.pause());
  handle('pomodoro.resume', () => pomodoro.resume());
  handle('pomodoro.skipBreak', () => pomodoro.skipBreak());
  handle('pomodoro.extendWork', (raw) => {
    const input = pomodoroExtendSchema.parse(raw);
    return pomodoro.extendWork(input.minutes);
  });
  handle('pomodoro.startNextRep', (raw) => {
    const input = pomodoroStartNextRepSchema.parse(raw ?? {});
    return pomodoro.startNextRep(input.workMinutes);
  });
  handle('pomodoro.setNextOverrides', (raw) => {
    const input = pomodoroNextOverridesSchema.parse(raw ?? {});
    return pomodoro.setNextOverrides(input);
  });
  handle('pomodoro.dismissBreakOver', () => pomodoro.dismissBreakOver());
  handle('pomodoro.finish', () => pomodoro.finish());
  handle('pomodoro.discard', () => pomodoro.discard());
  handle('pomodoro.getState', () => pomodoro.getSnapshot());

  handle('export.json', async () => {
    const res = await dialog.showSaveDialog({
      title: 'Export Hourly Logger data',
      defaultPath: defaultExportName('json'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return { wrote: false };
    writeFileSync(res.filePath, JSON.stringify(buildSnapshot(), null, 2), 'utf8');
    return { wrote: true, path: res.filePath };
  });

  handle('export.csvZip', async () => {
    const res = await dialog.showSaveDialog({
      title: 'Export Hourly Logger as CSV zip',
      defaultPath: defaultExportName('zip'),
      filters: [{ name: 'Zip', extensions: ['zip'] }],
    });
    if (res.canceled || !res.filePath) return { wrote: false };
    const snap = buildSnapshot();
    const zip = new JSZip();
    zip.file('categories.csv', toCsv(snap.categories));
    zip.file('blocks.csv', toCsv(snap.blocks));
    zip.file('days.csv', toCsv(snap.days));
    zip.file('goals.csv', toCsv(snap.goals));
    zip.file('goal_exemptions.csv', toCsv(snap.goal_exemptions));
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    writeFileSync(res.filePath, buf);
    return { wrote: true, path: res.filePath };
  });

  handle('import.json', async ({ confirm }: { confirm: boolean } = { confirm: false }) => {
    // A replace-all import under a live session would orphan the
    // session's category id — the engine's finish() would then fail on
    // the FK and the block could never be saved. Refuse up front.
    if (readActiveSession()) {
      throw new Error(
        'A session is running. Finish or discard it before importing.'
      );
    }
    const res = await dialog.showOpenDialog({
      title: 'Import Hourly Logger data',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return { imported: false };
    const raw = readFileSync(res.filePaths[0], 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('File is not valid JSON');
    }
    if (parsed?.format !== 'hourly-logger-export') {
      throw new Error('Not an Hourly Logger export file (wrong "format" field)');
    }
    if (parsed?.version !== 1) {
      throw new Error(
        `Unsupported export version: ${parsed?.version}. This build understands version 1.`
      );
    }
    const validated = exportV1Schema.parse(parsed);
    if (!confirm) {
      return {
        imported: false,
        preview: {
          categories: validated.categories.length,
          blocks: validated.blocks.length,
          exported_at: validated.exported_at,
          path: res.filePaths[0],
        },
      };
    }
    // Pre-v8 exports carry goals as legacy columns on each category. When
    // `goals` is absent, synthesize revisions from them (same mapping as
    // the v8 migration); otherwise use the exported rows verbatim.
    let goals: Goal[];
    if (validated.goals === undefined) {
      goals = [];
      let gid = 1;
      for (const c of validated.categories) {
        if (c.weekly_goal_minutes != null) {
          goals.push({
            id: gid++,
            category_id: c.id,
            kind: 'weekly_minutes',
            target: c.weekly_goal_minutes,
            effective_from: '1970-01-01',
            retired_from: null,
            created_at: c.created_at,
          });
        }
        if (c.daily_goal) {
          goals.push({
            id: gid++,
            category_id: c.id,
            kind: 'daily_habit',
            target: 1,
            effective_from: '1970-01-01',
            retired_from: null,
            created_at: c.created_at,
          });
        }
      }
    } else {
      goals = validated.goals;
    }
    replaceAll({
      categories: validated.categories,
      blocks: validated.blocks,
      days: validated.days,
      goals,
      goalExemptions: validated.goal_exemptions,
    });
    return {
      imported: true,
      categories: validated.categories.length,
      blocks: validated.blocks.length,
    };
  });

  // Quick capture: commit reviewed natural-language drafts as blocks.
  // Parsing happens in the renderer (pure, instant); only the write
  // crosses into main, where it's transactional.
  handle('capture.commit', (raw) => {
    const input = captureCommitSchema.parse(raw);
    return commitCapture(input.drafts);
  });
  handle('aliases.get', () => getAliases());

  // Phone inbox: files an iOS Shortcut dropped into iCloud. The renderer
  // pulls pending entries, parses + commits them through the normal
  // capture path, then reports the ids back here to be filed away.
  handle('phoneInbox.getPending', () => getPhonePending());
  handle('phoneInbox.markProcessed', (raw) => {
    const input = phoneInboxMarkProcessedSchema.parse(raw);
    markPhoneProcessed(input.ids);
    return true;
  });
  handle('phoneInbox.ensureCategory', () => ensureInboxCategory());

  handle('reveal', ({ path }: { path: string }) => {
    shell.showItemInFolder(path);
    return true;
  });

  handle('openExternal', ({ url }: { url: string }) => {
    shell.openExternal(url);
    return true;
  });
}

function defaultExportName(ext: 'json' | 'zip') {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(
    d.getHours()
  )}${pad(d.getMinutes())}`;
  return join(
    require('node:os').homedir(),
    'Desktop',
    `hourly-logger-${stamp}.${ext}`
  );
}

function toCsv(rows: Record<string, any>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: any) => {
    if (v === null || v === undefined) return '';
    // Object-valued cells (the blocks.pomodoro JSON meta) serialize as
    // JSON, not "[object Object]".
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(','));
  }
  return lines.join('\n');
}
