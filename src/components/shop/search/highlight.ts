/*
 * Splits the visitor's query into plain and "understood" parts for the results heading
 * (“duitse helm ww2 *onder 500*”): every chip's matched words are emphasised. Pure; tested in
 * highlight.test.ts. Matching is case-insensitive on the text as typed; overlaps merge.
 */
export type QueryPart = { text: string; understood: boolean };

export function splitUnderstood(query: string, matched: string[]): QueryPart[] {
  const lower = query.toLowerCase();
  const marks = new Array<boolean>(query.length).fill(false);
  for (const m of matched) {
    const needle = m.trim().toLowerCase();
    if (!needle) continue;
    let from = 0;
    for (let i = lower.indexOf(needle, from); i >= 0; i = lower.indexOf(needle, from)) {
      const before = i === 0 || !/[\p{L}\p{N}]/u.test(lower[i - 1]);
      const after = i + needle.length >= lower.length || !/[\p{L}\p{N}]/u.test(lower[i + needle.length]);
      if (before && after) {
        marks.fill(true, i, i + needle.length);
        break;
      }
      from = i + 1;
    }
  }
  const parts: QueryPart[] = [];
  for (let i = 0; i < query.length; i++) {
    const last = parts.at(-1);
    if (last && last.understood === marks[i]) last.text += query[i];
    else parts.push({ text: query[i], understood: marks[i] });
  }
  return parts;
}
