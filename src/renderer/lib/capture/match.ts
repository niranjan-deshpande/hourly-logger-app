import type { AliasEntry, Category } from '@shared/types';

// Resolve an activity phrase to a category: learned aliases first
// (highest priority), then a fuzzy match against category names. All
// hand-rolled — no string-similarity dependency, consistent with the
// app's low-dependency ethos.

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'on', 'for', 'to', 'and', 'with', 'w', 'my',
  'in', 'at', 'some', 'that', 'this',
  // Sequence filler — never part of a real category name.
  'then', 'next', 'after', 'afterwards',
]);

// Lowercase, strip punctuation to spaces, collapse whitespace. This is
// also the canonical form stored for aliases.
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(s: string): string[] {
  return normalize(s)
    .split(' ')
    .filter((t) => t && !STOPWORDS.has(t));
}

const MATCH_THRESHOLD = 0.5;

export interface CategoryMatch {
  categoryId: number | null;
  score: number;
  viaAlias: boolean;
}

export function matchCategory(
  phrase: string,
  categories: Category[],
  aliases: AliasEntry[] = []
): CategoryMatch {
  const phraseTokens = tokenize(phrase);
  if (phraseTokens.length === 0) {
    return { categoryId: null, score: 0, viaAlias: false };
  }

  // Aliases whose target category still exists win outright. Prefer the
  // longest (most specific) matching alias.
  const liveIds = new Set(categories.map((c) => c.id));
  let bestAlias: { id: number; len: number } | null = null;
  for (const a of aliases) {
    if (!liveIds.has(a.categoryId)) continue;
    const needle = tokenize(a.phrase);
    if (needle.length === 0) continue;
    if (containsSubsequence(phraseTokens, needle)) {
      if (!bestAlias || needle.length > bestAlias.len) {
        bestAlias = { id: a.categoryId, len: needle.length };
      }
    }
  }
  if (bestAlias) return { categoryId: bestAlias.id, score: 1, viaAlias: true };

  let best: { id: number; score: number; nameLen: number } | null = null;
  for (const c of categories) {
    const s = scoreCategory(phrase, phraseTokens, c);
    if (
      s > 0 &&
      (!best ||
        s > best.score ||
        (s === best.score && c.name.length < best.nameLen))
    ) {
      best = { id: c.id, score: s, nameLen: c.name.length };
    }
  }
  if (best && best.score >= MATCH_THRESHOLD) {
    return { categoryId: best.id, score: best.score, viaAlias: false };
  }
  return { categoryId: null, score: best?.score ?? 0, viaAlias: false };
}

function scoreCategory(
  phrase: string,
  phraseTokens: string[],
  c: Category
): number {
  const normName = normalize(c.name);
  if (!normName) return 0;
  const normPhrase = normalize(phrase);
  // (a) containment. A phrase that contains the full category name is a
  // strong hit. The reverse (phrase IS a substring of the name) is only
  // trusted when the phrase is ≥3 chars — otherwise "e" would bind
  // perfectly to "Emails".
  if (normPhrase.includes(normName)) return 1;
  if (normPhrase.length >= 3 && normName.includes(normPhrase)) return 1;

  const nameTokens = tokenize(c.name);
  if (nameTokens.length === 0) return 0;

  // (b) fraction of category-name tokens present in the phrase.
  let nameHits = 0;
  for (const nt of nameTokens) {
    if (phraseTokens.some((pt) => tokenMatch(nt, pt))) nameHits++;
  }
  const nameFrac = nameHits / nameTokens.length;

  // (c) fraction of phrase tokens hitting a category-name token.
  let phraseHits = 0;
  for (const pt of phraseTokens) {
    if (nameTokens.some((nt) => tokenMatch(nt, pt))) phraseHits++;
  }
  const phraseFrac = phraseHits / phraseTokens.length;

  return Math.max(nameFrac, phraseFrac);
}

// Exact, or within edit-distance 1 for tokens long enough that a typo
// shouldn't collapse two distinct words.
function tokenMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && levenshtein(a, b) <= 1) return true;
  return false;
}

// True if `needle` appears as a contiguous run of tokens within `hay`.
function containsSubsequence(hay: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}
