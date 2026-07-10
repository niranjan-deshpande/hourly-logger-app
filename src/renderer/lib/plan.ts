import type { Block } from '@shared/types';
import { fromIso } from './time';

// A Plan block is "Done-eligible" when:
//   - it has ended (end_at <= now), AND
//   - no Actual block of the same category overlaps its time range.
//
// Both the per-block Done chip and the bulk "Mirror plan to now" button
// use this predicate as their gate. Centralized here so the chip and
// the button can never disagree about what's eligible.
export function eligibleForDone(
  blocks: Block[],
  nowMs: number = Date.now()
): Block[] {
  const actualsByCat = new Map<number, Block[]>();
  for (const b of blocks) {
    if (b.kind !== 'actual') continue;
    const arr = actualsByCat.get(b.category_id) ?? [];
    arr.push(b);
    actualsByCat.set(b.category_id, arr);
  }
  const out: Block[] = [];
  for (const p of blocks) {
    if (p.kind !== 'plan') continue;
    const pe = fromIso(p.end_at).getTime();
    if (pe > nowMs) continue;
    const ps = fromIso(p.start_at).getTime();
    const acts = actualsByCat.get(p.category_id);
    const hasOverlap = (acts ?? []).some((a) => {
      const as = fromIso(a.start_at).getTime();
      const ae = fromIso(a.end_at).getTime();
      return as < pe && ae > ps;
    });
    if (!hasOverlap) out.push(p);
  }
  return out;
}

// Inverse predicate for Actual blocks: does any Plan block of the same
// category overlap this Actual block's time range? Used to render the
// subtle "matches plan" dot in the corner of Actual blocks.
export function actualsMatchingPlan(blocks: Block[]): Set<number> {
  const plansByCat = new Map<number, Block[]>();
  for (const p of blocks) {
    if (p.kind !== 'plan') continue;
    const arr = plansByCat.get(p.category_id) ?? [];
    arr.push(p);
    plansByCat.set(p.category_id, arr);
  }
  const out = new Set<number>();
  for (const a of blocks) {
    if (a.kind !== 'actual') continue;
    const plans = plansByCat.get(a.category_id);
    if (!plans) continue;
    const as = fromIso(a.start_at).getTime();
    const ae = fromIso(a.end_at).getTime();
    for (const p of plans) {
      const ps = fromIso(p.start_at).getTime();
      const pe = fromIso(p.end_at).getTime();
      if (ps < ae && pe > as) {
        out.add(a.id);
        break;
      }
    }
  }
  return out;
}
