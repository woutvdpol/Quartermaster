/*
 * Text preparation for machine translation (pure, unit-tested in text.test.ts).
 *
 *   prepareText(text, { markdown, terms }) → { units, assemble(translatedUnits) }
 *
 * `units` are the sentences the model translates (with placeholders from ./glossary.ts); `assemble`
 * puts the translated sentences back into the original layout. Markdown structure stays intact:
 * headings, list markers, quotes, tables (cells are translated one by one), fenced code, horizontal
 * rules, blank lines and hard line breaks are copied, only the text in between is translated.
 * Plain fields (titles, labels, SEO texts) are handled the same way, minus the Markdown rules.
 */
import { protect, restore, type GlossaryTerm, normalizeTerms } from "./glossary";

/** Characters per sentence sent to the model (the embedder accepts 600; Opus-MT handles ≤ 512 tokens). */
export const MAX_UNIT_CHARS = 450;

type Part = string | { unit: number };

export type PreparedText = {
  units: string[];
  /** Translated units (same order/length as `units`) → the translated text. */
  assemble: (translated: readonly string[]) => { text: string; missing: number };
};

const ABBREVIATIONS = new Set(
  ["no", "nr", "nos", "ca", "approx", "e.g", "i.e", "etc", "vs", "mr", "mrs", "ms", "dr", "st", "lt", "col", "gen", "sgt", "capt", "maj", "cpl", "pte", "fig", "vol", "pp", "p", "ref", "inc", "ltd", "co", "jr", "sr", "u.s", "u.k", "approx", "incl", "excl", "dept", "div", "regt", "bn", "coy"].map((s) => s.toLowerCase()),
);

/**
 * Splits a paragraph into sentences: after . ! ? … (plus closing quotes/brackets) followed by
 * whitespace and an upper-case letter, digit, quote or bracket. Not after abbreviations ("No. 5",
 * "ca. 1943"), initials ("J. Smith") or short ordinals ("2. Weltkrieg"). Separators are kept so the
 * text can be put back together exactly.
 */
export function splitSentences(text: string): { sentences: string[]; separators: string[] } {
  const sentences: string[] = [];
  const separators: string[] = [];
  const re = /([.!?…]+["'”’)\]]*)(\s+)(?=["'“‘(\[*_]*[\p{Lu}\p{N}])/gu;
  let start = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const endOfSentence = m.index + m[1].length;
    const before = text.slice(start, m.index);
    const lastWord = /([\p{L}\p{N}.]+)$/u.exec(before)?.[1] ?? "";
    if (m[1] === ".") {
      if (ABBREVIATIONS.has(lastWord.toLowerCase())) continue;
      if (/^\p{Lu}$/u.test(lastWord)) continue; // initial
      if (/^\d{1,2}$/.test(lastWord)) continue; // ordinal
    }
    sentences.push(text.slice(start, endOfSentence));
    separators.push(m[2]);
    start = endOfSentence + m[2].length;
  }
  sentences.push(text.slice(start));
  return { sentences, separators };
}

/** Breaks an over-long sentence at "; ", ", " or a space near the middle (recursively). */
export function chunkLong(sentence: string, max = MAX_UNIT_CHARS): { pieces: string[]; separators: string[] } {
  if (sentence.length <= max) return { pieces: [sentence], separators: [] };
  const mid = Math.floor(sentence.length / 2);
  let cut = -1;
  for (const sep of ["; ", ", ", " "]) {
    let best = -1;
    for (let i = sentence.indexOf(sep); i !== -1; i = sentence.indexOf(sep, i + 1)) {
      if (best === -1 || Math.abs(i - mid) < Math.abs(best - mid)) best = i;
    }
    if (best > 0) {
      cut = best + sep.length - 1; // keep the punctuation on the left side, the space is the separator
      break;
    }
  }
  if (cut <= 0) cut = max; // one giant word: hard cut
  const left = sentence.slice(0, cut).replace(/\s+$/, "");
  const sepMatch = /^\s*/.exec(sentence.slice(left.length))![0];
  const right = sentence.slice(left.length + sepMatch.length);
  const a = chunkLong(left, max);
  const b = chunkLong(right, max);
  return { pieces: [...a.pieces, ...b.pieces], separators: [...a.separators, sepMatch || "", ...b.separators] };
}

/** Collapses whitespace the model inserts inside emphasis ("** zeer zeldzaam**" → "**zeer zeldzaam**"). */
/**
 * Machine output safety net: Opus-MT sometimes loops on punctuation ("Kleidung............",
 * "beschrieben.?????????"). A run of 4+ punctuation marks collapses to its first mark (an ellipsis "..."
 * of exactly three stays).
 */
export function collapseRepeats(text: string): string {
  return text.replace(/([.?!,;:*·—-])[.?!,;:*·—-]{3,}/g, "$1");
}

export function tidyEmphasis(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      // Pair the markers in order (1st+2nd, 3rd+4th …); only lines with complete pairs are touched.
      const parts = line.split(/(\*\*|__)/);
      const markers = parts.filter((_, i) => i % 2 === 1);
      if (!markers.length || markers.length % 2 !== 0) return line;
      for (let m = 0; m < markers.length; m += 2) {
        const inner = 2 * m + 2; // index of the text between marker m and m+1
        if (parts[inner - 1] !== parts[inner + 1]) return line;
        parts[inner] = parts[inner].trim();
      }
      return parts.join("");
    })
    .join("\n");
}

class Builder {
  parts: Part[] = [];
  units: string[] = [];
  tokens: string[][] = [];
  constructor(private terms: GlossaryTerm[]) {}

  literal(s: string) {
    if (s) this.parts.push(s);
  }

  /** Inline text: sentences become units, whitespace around them stays literal. */
  inline(text: string) {
    const lead = /^\s*/.exec(text)![0];
    const trail = /\s*$/.exec(text.slice(lead.length))![0];
    const body = text.slice(lead.length, text.length - trail.length);
    this.literal(lead);
    if (body) {
      const { sentences, separators } = splitSentences(body);
      sentences.forEach((sentence, i) => {
        const { pieces, separators: inner } = chunkLong(sentence);
        pieces.forEach((piece, j) => {
          this.unit(piece);
          if (j < inner.length) this.literal(inner[j]);
        });
        if (i < separators.length) this.literal(separators[i]);
      });
    }
    this.literal(trail);
  }

  private unit(text: string) {
    // Nothing to translate (only codes, numbers, punctuation, URLs): copy as is.
    const p = protect(text, this.terms);
    if (!/\p{L}{2,}/u.test(p.text.replace(/QZ\d+/g, ""))) {
      this.literal(p.tokens.length ? restore(p.text, p.tokens).text : text);
      return;
    }
    this.parts.push({ unit: this.units.length });
    this.units.push(p.text);
    this.tokens.push(p.tokens);
  }
}

const FENCE_RE = /^\s{0,3}(```|~~~)/;
const RULE_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const LINE_PREFIX_RE = /^(\s*(?:>\s?)*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d{1,9}[.)]\s+)?)/;

function markdownLine(b: Builder, line: string) {
  if (line.trim() === "" || RULE_RE.test(line) || TABLE_SEPARATOR_RE.test(line)) {
    b.literal(line);
    return;
  }
  if (/^\s*\|/.test(line)) {
    // Table row: translate cell by cell, keep the pipes.
    const cells = line.split(/(?<!\\)\|/);
    cells.forEach((cell, i) => {
      if (i > 0) b.literal("|");
      b.inline(cell);
    });
    return;
  }
  const prefix = LINE_PREFIX_RE.exec(line)![1];
  b.literal(prefix);
  b.inline(line.slice(prefix.length));
}

export function prepareText(text: string, opts: { markdown: boolean; terms?: readonly GlossaryTerm[] }): PreparedText {
  const b = new Builder(normalizeTerms(opts.terms ?? []));
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let fence: string | null = null;
  lines.forEach((line, i) => {
    if (i > 0) b.literal("\n");
    if (opts.markdown) {
      const f = FENCE_RE.exec(line)?.[1] ?? null;
      if (fence) {
        b.literal(line);
        if (f === fence) fence = null;
        return;
      }
      if (f) {
        fence = f;
        b.literal(line);
        return;
      }
      markdownLine(b, line);
    } else {
      b.inline(line);
    }
  });

  const { parts, units, tokens } = b;
  return {
    units,
    assemble(translated) {
      if (translated.length !== units.length) throw new Error(`expected ${units.length} translated units, got ${translated.length}`);
      let missing = 0;
      const out = parts
        .map((p) => {
          if (typeof p === "string") return p;
          const r = restore(collapseRepeats(translated[p.unit].trim()), tokens[p.unit]);
          missing += r.missing;
          return r.text;
        })
        .join("");
      return { text: opts.markdown ? tidyEmphasis(out) : out, missing };
    },
  };
}
