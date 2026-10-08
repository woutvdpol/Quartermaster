import { fold } from "./normalize";

/*
 * "Did you mean …?" for searches without results (pure; unit-tested in spelling.test.ts).
 *
 * The vocabulary is the shop's own words (title words with their frequency + facet/synonym phrases),
 * so corrections always point at something the shop has. A word is only corrected when it is not in
 * the vocabulary itself; the replacement is the closest known word by edit distance (≤ 1 for short
 * words, ≤ 2 from 6 letters), ties broken by frequency. Numbers and very short words are left alone.
 */

/** Damerau-free Levenshtein distance with an early exit above `max` (returns max + 1 then). */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Allowed edit distance for a word of this length (0 = never corrected). */
export function maxEditsFor(word: string): number {
  if (word.length < 4 || /^\d+$/.test(word)) return 0;
  return word.length >= 6 ? 2 : 1;
}

/** Best known replacement for `word`, or null when it is known already / nothing is close enough. */
export function correctWord(word: string, vocabulary: ReadonlyMap<string, number>): string | null {
  const w = fold(word);
  const max = maxEditsFor(w);
  if (!max || vocabulary.has(w)) return null;
  let best: { word: string; d: number; freq: number } | null = null;
  for (const [candidate, freq] of vocabulary) {
    if (candidate.length < 3 || Math.abs(candidate.length - w.length) > max) continue;
    const d = editDistance(w, candidate, max);
    if (d > max) continue;
    if (!best || d < best.d || (d === best.d && freq > best.freq)) best = { word: candidate, d, freq };
  }
  return best?.word ?? null;
}

/**
 * The query with unknown words replaced by their closest known word, or null when nothing changed.
 * Keeps the visitor's other words (and their spelling) as typed.
 */
export function didYouMean(query: string, vocabulary: ReadonlyMap<string, number>): string | null {
  let changed = false;
  const out = query
    .split(/(\s+)/)
    .map((part) => {
      if (!part.trim()) return part;
      const m = /^([^\p{L}\p{N}]*)([\p{L}\p{N}][\p{L}\p{N}-]*[\p{L}\p{N}]|[\p{L}\p{N}])([^\p{L}\p{N}]*)$/u.exec(part);
      if (!m) return part;
      const fixed = correctWord(m[2], vocabulary);
      if (!fixed) return part;
      changed = true;
      return `${m[1]}${fixed}${m[3]}`;
    })
    .join("");
  return changed ? out : null;
}

/** Vocabulary from title words (with frequencies) and dictionary phrases (each word counts once). */
export function buildVocabulary(titleWords: Iterable<[string, number]>, phrases: Iterable<string> = []): Map<string, number> {
  const vocab = new Map<string, number>();
  for (const [w, n] of titleWords) {
    const f = fold(w);
    if (f.length >= 3) vocab.set(f, (vocab.get(f) ?? 0) + n);
  }
  for (const phrase of phrases) {
    for (const w of fold(phrase).split(/[^\p{L}\p{N}]+/u)) if (w.length >= 3 && !vocab.has(w)) vocab.set(w, 1);
  }
  return vocab;
}
