import type { CaptureCommitResult, CommitDraft } from '@shared/types';
import { Blocks, Categories, getDb } from './db';
import { recordAlias } from './aliases';

// Commit reviewed capture drafts. Creates any proposed new categories
// (deduped within the batch, and reusing an existing category whose name
// collides case-insensitively), then the blocks — all in one
// transaction. Alias learning happens AFTER the transaction commits,
// since it's a separate file write.
export function commitCapture(drafts: CommitDraft[]): CaptureCommitResult {
  const conn = getDb();

  // name (lowercased) → category id, for categories we create or reuse
  // during this commit, so two drafts proposing "Gym" share one row.
  const resolvedNewByName = new Map<string, number>();
  const existing = Categories.list({ includeArchived: true });
  const existingByName = new Map(
    existing.map((c) => [c.name.trim().toLowerCase(), c.id])
  );
  const existingIds = new Set(existing.map((c) => c.id));

  // Aliases to learn once the blocks are safely written.
  const toLearn: { phrase: string; categoryId: number }[] = [];

  let createdCategories = 0;
  let createdBlocks = 0;

  const tx = conn.transaction(() => {
    for (const d of drafts) {
      let categoryId: number;
      if (d.newCategory) {
        const key = d.newCategory.name.trim().toLowerCase();
        const reused = existingByName.get(key);
        const alreadyCreated = resolvedNewByName.get(key);
        if (reused != null) {
          categoryId = reused;
        } else if (alreadyCreated != null) {
          categoryId = alreadyCreated;
        } else {
          const created = Categories.create({
            name: d.newCategory.name.trim(),
            color: d.newCategory.color,
          });
          resolvedNewByName.set(key, created.id);
          categoryId = created.id;
          createdCategories++;
        }
      } else {
        // Validated upstream: exactly one of categoryId / newCategory set.
        categoryId = d.categoryId!;
        // Guard against a stale id (e.g. the category was removed by a
        // replace-all import while this modal was open). Without this the
        // INSERT would fail the FK and roll back the WHOLE batch with an
        // opaque "FOREIGN KEY constraint failed".
        if (!existingIds.has(categoryId)) {
          throw new Error(
            'A category in this capture no longer exists — reopen capture and try again.'
          );
        }
      }

      Blocks.create({
        categoryId,
        startAt: d.startAt,
        endAt: d.endAt,
        note: d.note,
        kind: d.kind,
      });
      createdBlocks++;

      if (d.teach && d.rawPhrase.trim()) {
        toLearn.push({ phrase: d.rawPhrase.trim(), categoryId });
      }
    }
  });
  tx();

  // Alias learning is best-effort and happens AFTER the blocks are
  // durably committed. A failure here must never surface as a commit
  // error — that would tempt the user to retry and double-create blocks.
  try {
    for (const { phrase, categoryId } of toLearn) {
      recordAlias(phrase, categoryId);
    }
  } catch {
    // ignore — the blocks are saved; only the convenience aliases were lost.
  }

  return { categories: createdCategories, blocks: createdBlocks };
}
