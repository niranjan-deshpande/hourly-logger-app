import type { Block, Category } from '@shared/types';
import { fromIso } from './time';

export interface CategoryStat {
  category: Category;
  totalMs: number;
  sessions: number;
  avgMs: number;
  longestMs: number;
}

export function computeStats(blocks: Block[], categories: Category[]): CategoryStat[] {
  const byCat = new Map<number, Block[]>();
  for (const b of blocks) {
    // Plan blocks represent intent, not lived time — they shouldn't
    // count toward totals, averages, longest-session, or session counts.
    if (b.kind === 'plan') continue;
    const arr = byCat.get(b.category_id) ?? [];
    arr.push(b);
    byCat.set(b.category_id, arr);
  }
  const stats: CategoryStat[] = [];
  for (const cat of categories) {
    const items = byCat.get(cat.id) ?? [];
    let total = 0;
    let longest = 0;
    for (const b of items) {
      const ms = fromIso(b.end_at).getTime() - fromIso(b.start_at).getTime();
      total += ms;
      if (ms > longest) longest = ms;
    }
    stats.push({
      category: cat,
      totalMs: total,
      sessions: items.length,
      avgMs: items.length === 0 ? 0 : Math.round(total / items.length),
      longestMs: longest,
    });
  }
  return stats;
}

export function totalMs(stats: CategoryStat[]): number {
  return stats.reduce((a, s) => a + s.totalMs, 0);
}
