import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { aliasFileSchema } from '@shared/schema';
import type { AliasEntry } from '@shared/types';
import { getPaths } from './paths';

// Learned phrase→category aliases, persisted as a flat JSON map next to
// settings.json. Aliases are convenience state, not user data, so (like
// settings) they live outside the export contract. A malformed file is
// treated as "no aliases" rather than crashing capture.

function aliasPath(): string {
  return join(getPaths().appDataDir, 'aliases.json');
}

function readMap(): Record<string, number> {
  const p = aliasPath();
  if (!existsSync(p)) return {};
  try {
    return aliasFileSchema.parse(JSON.parse(readFileSync(p, 'utf8')));
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, number>): void {
  // Atomic write: a crash or full disk mid-write would otherwise truncate
  // aliases.json and lose the entire learned map. Write a temp file, then
  // rename over the target (rename is atomic on the same filesystem).
  const p = aliasPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(map, null, 2), 'utf8');
  renameSync(tmp, p);
}

export function getAliases(): AliasEntry[] {
  return Object.entries(readMap()).map(([phrase, categoryId]) => ({
    phrase,
    categoryId,
  }));
}

// Upsert a normalized phrase → category mapping. An empty phrase (a teach
// with no usable activity text) is ignored. The phrase is expected to be
// already normalized by the caller; we only trim defensively.
export function recordAlias(phrase: string, categoryId: number): void {
  const key = phrase.trim();
  if (!key) return;
  const map = readMap();
  map[key] = categoryId;
  writeMap(map);
}
