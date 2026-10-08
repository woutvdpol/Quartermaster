/*
 * Text normalisation shared by the query parser, the synonym list and the lexical query builder.
 * Pure (no server-only): unit-tested and usable on the client.
 */

/** Lower case, accents stripped (Feldmütze → feldmutze, Croix → croix), whitespace collapsed. */
export function fold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Splits folded text into tokens. Keeps `-`, `.`, `,`, `/`, `#`, `€`, `$`, `£` inside tokens (prices,
 * "1939-1945", "waffen-ss", "#50212", "m.35"), trims them at the edges; other punctuation separates.
 */
export function tokenize(folded: string): string[] {
  return folded
    .split(/[\s;:!?()[\]{}"'“”‘’«»|+*=<>]+/u)
    .map((t) => t.replace(/^[-.,/]+|[-.,/]+$/g, ""))
    .filter(Boolean);
}

/** Words for the lexical (tsquery) side: letters/digits only, as Postgres' `simple` parser sees them. */
export function lexemes(text: string): string[] {
  return fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Function words (NL/DE/EN/FR) that carry no meaning for a product search. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  // nl
  "de", "het", "een", "en", "of", "van", "uit", "met", "voor", "in", "op", "aan", "bij", "naar", "die", "dat", "is", "zijn", "ik", "zoek", "zoeken", "graag", "mooi", "mooie", "origineel", "originele",
  // de
  "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "und", "oder", "mit", "von", "aus", "fur", "im", "am", "zum", "zur", "suche",
  // en
  "the", "a", "an", "and", "or", "of", "from", "with", "for", "in", "on", "to", "by", "original", "looking",
  // fr
  "le", "la", "les", "du", "des", "et",
]);
