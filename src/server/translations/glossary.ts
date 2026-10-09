/*
 * Token protection for machine translation (pure, unit-tested in glossary.test.ts).
 *
 * Before a sentence goes to the translation model, everything that must come back unchanged — or as a
 * fixed glossary translation — is replaced by a placeholder `QZ<n>`. Opus-MT copies such unknown
 * letter+digit tokens through verbatim (measured: 100 % for NL and DE on product sentences, also at
 * the start of a sentence). After translation the placeholders are swapped back.
 *
 * Protected, in priority order (earlier wins on overlap):
 *  1. Markdown/HTML inline syntax: inline code, images, link targets, autolinks, HTML tags
 *  2. bare URLs and e-mail addresses
 *  3. glossary terms of the shop (case-insensitive, whole word, longest first):
 *     target null → the term is kept as written; target set → the term becomes that target
 *  4. codes: any word containing a digit (ET64, M40, 3721, 1943-45, 1./IR9, WW2) and short
 *     all-capital acronyms (RZM, DRGM, SS)
 */

export type GlossaryTerm = { source: string; target: string | null };

export type Protected = {
  /** The sentence with placeholders. */
  text: string;
  /** Replacement per placeholder index (what `QZ<i>` becomes after translation). */
  tokens: string[];
};

export const PLACEHOLDER_RE = /QZ(\d+)/g;

const placeholder = (i: number) => `QZ${i}`;

/** Word boundary that understands accented letters (é, ß, ü …). */
const B_START = "(?<![\\p{L}\\p{N}_])";
const B_END = "(?![\\p{L}\\p{N}_])";

const SYNTAX: RegExp[] = [
  /`[^`\n]+`/g, // inline code
  /!\[[^\]\n]*\]\([^)\n]*\)/g, // image (alt text stays as is)
  /(?<=\]\()[^)\s]+(?=\))/g, // link target: "[label](url)" → "[label](QZ0)", the label stays translatable
  /<(?:https?:\/\/|mailto:)[^>\s]+>/g, // autolink
  /<\/?[A-Za-z][^>\n]*>/g, // HTML tag
  /\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g, // bare URL (without trailing punctuation)
  /\bwww\.[^\s<>()]+[^\s<>().,;:!?'"]/g,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, // e-mail
];

const CODE_RE = new RegExp(`${B_START}[\\p{L}\\p{N}]*\\p{N}[\\p{L}\\p{N}]*(?:[./\\-]+[\\p{L}\\p{N}]+)*${B_END}`, "gu");
const ACRONYM_RE = new RegExp(`${B_START}\\p{Lu}{2,5}${B_END}`, "gu");

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One regex per term (whitespace inside a term matches any whitespace run). */
function termRegex(source: string): RegExp {
  const body = source
    .trim()
    .split(/\s+/)
    .map(escapeRegExp)
    .join("\\s+");
  return new RegExp(`${B_START}${body}${B_END}`, "giu");
}

/** Normalises glossary input: trimmed, unique per lower-cased source, longest source first. */
export function normalizeTerms(terms: readonly GlossaryTerm[]): GlossaryTerm[] {
  const seen = new Map<string, GlossaryTerm>();
  for (const t of terms) {
    const source = t.source.trim().replace(/\s+/g, " ");
    if (!source) continue;
    const target = t.target === null ? null : t.target.trim() || null;
    seen.set(source.toLowerCase(), { source, target });
  }
  return [...seen.values()].sort((a, b) => b.source.length - a.source.length);
}

type Span = { start: number; end: number; replacement: string };

/** Replaces protected tokens by placeholders. `terms` should come from normalizeTerms(). */
export function protect(text: string, terms: readonly GlossaryTerm[] = []): Protected {
  const spans: Span[] = [];
  const free = (start: number, end: number) => spans.every((s) => end <= s.start || start >= s.end);
  const add = (re: RegExp, replacement: (m: RegExpExecArray) => string) => {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m[0] === "") {
        re.lastIndex += 1;
        continue;
      }
      const start = m.index;
      const end = start + m[0].length;
      if (free(start, end)) spans.push({ start, end, replacement: replacement(m) });
    }
  };

  for (const re of SYNTAX) add(re, (m) => m[0]);
  for (const term of terms) add(termRegex(term.source), (m) => term.target ?? m[0]);
  add(CODE_RE, (m) => m[0]);
  add(ACRONYM_RE, (m) => m[0]);

  spans.sort((a, b) => a.start - b.start);
  let out = "";
  let pos = 0;
  const tokens: string[] = [];
  for (const s of spans) {
    out += text.slice(pos, s.start) + placeholder(tokens.length);
    tokens.push(s.replacement);
    pos = s.end;
  }
  out += text.slice(pos);
  return { text: out, tokens };
}

/**
 * Swaps placeholders back. `missing` counts placeholders the model dropped (their token is lost from
 * the translation; the reviewer sees the result before it goes online).
 */
export function restore(translated: string, tokens: readonly string[]): { text: string; missing: number } {
  const used = new Set<number>();
  const text = translated.replace(PLACEHOLDER_RE, (whole, n: string) => {
    const i = Number(n);
    if (!Number.isInteger(i) || i >= tokens.length) return whole;
    used.add(i);
    return tokens[i];
  });
  return { text, missing: tokens.length - used.size };
}

/**
 * Suggested "never translate" terms for a militaria shop (Settings → Translations → glossary,
 * "Add suggested terms"). Unit and organisation names come back mangled from the model otherwise
 * ("Wehrmacht belt buckle" → "Wehr.e rieme…").
 */
export const SUGGESTED_KEEP_TERMS = [
  "Wehrmacht",
  "Heer",
  "Luftwaffe",
  "Kriegsmarine",
  "Waffen-SS",
  "Stahlhelm",
  "Afrikakorps",
  "Fallschirmjäger",
  "Gebirgsjäger",
  "Reichswehr",
  "Volkssturm",
  "Hitlerjugend",
  "Feldbluse",
  "Schirmmütze",
  "Feldmütze",
  "Panzer",
] as const;

/**
 * Suggested collector-term translations per language ("Add suggested terms"). Opus-MT renders these
 * literally or wrongly ("age-appropriate wear" → "altersgerechte Kleidung", "edged weapons" →
 * "Kantenwaffen"); the shop can edit or delete each one.
 */
export const SUGGESTED_MAPPED_TERMS: Record<"nl" | "de", readonly { source: string; target: string | null }[]> = {
  de: [
    { source: "age-appropriate wear", target: "altersbedingte Gebrauchsspuren" },
    { source: "edged weapons", target: "Blankwaffen" },
    { source: "Broad arrow", target: null },
    { source: "liner", target: "Innenfutter" },
    { source: "decal", target: "Abzeichen" },
    { source: "chinstrap", target: "Kinnriemen" },
    { source: "maker-marked", target: "mit Herstellerkennung" },
    { source: "repaint", target: "Nachlackierung" },
  ],
  nl: [
    { source: "age-appropriate wear", target: "gebruikssporen passend bij de leeftijd" },
    { source: "edged weapons", target: "blanke wapens" },
    { source: "Broad arrow", target: null },
    { source: "liner", target: "binnenwerk" },
    { source: "decal", target: "embleem" },
    { source: "chinstrap", target: "kinriem" },
    { source: "maker-marked", target: "met fabrikantmerk" },
    { source: "repaint", target: "overgeschilderd" },
  ],
};
