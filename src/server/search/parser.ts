import type { PublicTaxonomy } from "@/server/storefront-catalog/types";
import { facetToken } from "@/server/storefront-catalog/params";
import { STOPWORDS, fold, tokenize } from "./normalize";
import type { SynonymEntry } from "./synonyms";

/*
 * Query understanding without an LLM: a fast, deterministic parser (pure, ~0.1 ms) that turns
 * "Duitse helm WW2 onder 500 euro" into
 *
 *   facets  country.germany, type.helmets, period.ww2
 *   max     500
 *   text    "helm"              (what is left for full-text + semantic search)
 *
 * using the shop's facet value names + the synonym list (./synonyms.ts), price phrases (NL/DE/EN),
 * status words ("verkocht", "sold"), sort hints ("goedkoop") and stock numbers ("#50212", "nr 50212").
 * Every piece that was understood becomes a chip with the query string that removes it again.
 *
 * Matching is greedy longest-phrase-first over folded tokens (case/accents ignored), max 5 tokens.
 * Words that match a TYPE facet stay in the search text as well ("helm" also ranks Stahlhelm first):
 * a type is a broad class, the word itself is still the best ranking signal. Country, period,
 * branch, unit and maker words are pure attributes and are consumed.
 */

export type ChipKind = "facet" | "price" | "status" | "sort" | "stock";

export type InterpretationChip = {
  kind: ChipKind;
  /** English UI label, e.g. "Country: Germany", "Max €500", "Sold items". */
  label: string;
  /** The words of the query this chip came from (as typed). */
  matched: string;
  /** Facet token ("country.germany") for facet chips. */
  token?: string;
  /** The query string without this chip's words — the "remove chip" link uses it as `q`. */
  removeQuery: string;
};

export type ParsedQuery = {
  original: string;
  /** Free text left after removing understood phrases (as typed, stopwords kept) — for semantic search. */
  text: string;
  /** Folded words for the lexical search (stopwords and pure numbers ≤ 3 digits removed). */
  terms: string[];
  /** Equivalent words per term from term-group synonyms (folded; may contain spaces). */
  expansions: Record<string, string[]>;
  /** Facet tokens understood from the query (`<facetSlug>.<valueSlug>`). */
  facets: string[];
  /** Whole currency units. */
  min: number | null;
  max: number | null;
  /** "sold": search the sold archive instead of the items for sale. */
  status: "sold" | null;
  sort: "price_asc" | "price_desc" | null;
  /** Explicit or likely stock number (exact hits are pinned to the top). */
  stockCode: number | null;
  chips: InterpretationChip[];
};

export type ParserInput = {
  taxonomy: PublicTaxonomy;
  synonyms: SynonymEntry[];
  /** ISO 4217 shop currency (labels). */
  currency?: string;
};

type Token = { folded: string; raw: string };

type Target =
  | { kind: "facet"; facetSlug: string; facetName: string; facetKind: string; valueSlug: string; valueName: string }
  | { kind: "status"; status: "sold" | "available" }
  | { kind: "sort"; sort: "price_asc" | "price_desc" };

const STATUS_WORDS: Record<string, "sold" | "available"> = {
  verkocht: "sold",
  verkochte: "sold",
  sold: "sold",
  verkauft: "sold",
  verkaufte: "sold",
  vendu: "sold",
  archief: "sold",
  beschikbaar: "available",
  "op voorraad": "available",
  "te koop": "available",
  available: "available",
  "in stock": "available",
  "for sale": "available",
  verfugbar: "available",
  lieferbar: "available",
};

const SORT_WORDS: Record<string, "price_asc" | "price_desc"> = {
  goedkoop: "price_asc",
  goedkope: "price_asc",
  goedkoopste: "price_asc",
  cheap: "price_asc",
  cheapest: "price_asc",
  budget: "price_asc",
  gunstig: "price_asc",
  gunstige: "price_asc",
  billig: "price_asc",
  duur: "price_desc",
  dure: "price_desc",
  duurste: "price_desc",
  expensive: "price_desc",
  teuer: "price_desc",
  teure: "price_desc",
};

/** Max price triggers that are never about years ("onder 500"). */
const MAX_STRICT = ["onder", "beneden", "minder dan", "goedkoper dan", "max", "maximaal", "maximum", "hoogstens", "under", "below", "less than", "cheaper than", "up to", "unter", "unterhalb", "weniger als", "hochstens", "billiger als", "moins de", "<", "<="];
/** Ambiguous max triggers ("tot 1945"): only with a currency marker or a number that is not a year. */
const MAX_LOOSE = ["tot", "bis", "to", "jusqu'a"];
const MIN_STRICT = ["boven", "meer dan", "duurder dan", "minimaal", "minimum", "min", "above", "more than", "over", "uber", "mehr als", "plus de", ">", ">="];
const MIN_LOOSE = ["vanaf", "from", "ab", "sinds", "since", "des"];
const RANGE_START = ["tussen", "between", "zwischen", "entre", "van", "von", "from", "vanaf"];
const RANGE_JOIN = ["en", "and", "und", "et", "tot", "to", "bis", "-", "–"];

const CURRENCY_WORDS = new Set(["euro", "euros", "eur", "€", "dollar", "dollars", "usd", "$", "pond", "pound", "pounds", "gbp", "£", ",-", "eu"]);
const STOCK_PREFIXES = new Set(["nr", "nr.", "no", "no.", "nummer", "number", "item", "artikel", "art", "art.", "stock", "voorraadnummer", "#"]);

const SYMBOL: Record<string, string> = { EUR: "€", USD: "$", GBP: "£" };

/** "€500", "500,-", "1.500", "1500.00", "500eur" → { value, currency } or null. */
export function parseAmount(token: string): { value: number; currency: boolean } | null {
  let t = token;
  let currency = false;
  const pre = /^(€|\$|£|eur|usd|gbp)/.exec(t);
  if (pre) {
    currency = true;
    t = t.slice(pre[0].length);
  }
  const post = /(€|\$|£|,-|eur|euro|euros|usd|gbp)$/.exec(t);
  if (post && t.length > post[0].length) {
    currency = true;
    t = t.slice(0, -post[0].length);
  }
  t = t.replace(/[.,]-$/, "");
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ""); // 1.500 (nl/de thousands)
  else if (/^\d{1,3}(,\d{3})+$/.test(t)) t = t.replace(/,/g, ""); // 1,500 (en)
  else if (/^\d+[.,]\d{1,2}$/.test(t)) t = t.replace(/[.,]\d+$/, ""); // 499,95 → 499
  if (!/^\d{1,7}$/.test(t)) return null;
  return { value: Number(t), currency };
}

const isYear = (n: number) => n >= 1800 && n <= 2035;

/** Dictionary key of a phrase: folded tokens joined by one space (same shape as the query side). */
export const phraseKey = (s: string) => tokenize(fold(s)).join(" ");

function phraseAt(tokens: Token[], i: number, phrases: string[]): number {
  // Returns the token length of the longest phrase in `phrases` starting at i, or 0.
  let best = 0;
  for (const p of phrases) {
    const parts = p.split(" ");
    if (parts.length <= best) continue;
    if (parts.every((w, k) => tokens[i + k]?.folded === w)) best = parts.length;
  }
  return best;
}

/** Builds the phrase dictionary (folded phrase → target) for a shop. Cache it per tenant. */
export function buildDictionary(input: ParserInput): Map<string, Target> {
  const dict = new Map<string, Target>();
  const { taxonomy } = input;
  const facetById = new Map(taxonomy.facets.map((f) => [f.id, f]));
  const valueByName = new Map<string, Target>();
  for (const v of taxonomy.values) {
    const f = facetById.get(v.facetId);
    if (!f) continue;
    const target: Target = { kind: "facet", facetSlug: f.slug, facetName: f.name, facetKind: f.kind, valueSlug: v.slug, valueName: v.name };
    for (const key of [phraseKey(v.name), v.slug.replace(/-/g, " "), v.slug]) {
      if (key.length < 2) continue;
      if (!valueByName.has(key)) valueByName.set(key, target);
    }
  }
  // Synonyms first (explicit), then the value names themselves (never overridden by a synonym of
  // another value: "Heer" stays branch.heer even if some line lists it as an alias).
  for (const entry of input.synonyms) {
    const target = valueByName.get(phraseKey(entry.canonical)) ?? valueByName.get(phraseKey(entry.canonical).replace(/\s+/g, "-"));
    if (!target) continue;
    for (const term of entry.terms.map(phraseKey)) if (term && !valueByName.has(term)) dict.set(term, target);
  }
  for (const [k, t] of valueByName) dict.set(k, t);
  for (const [w, status] of Object.entries(STATUS_WORDS)) if (!dict.has(w)) dict.set(w, { kind: "status", status });
  for (const [w, sort] of Object.entries(SORT_WORDS)) if (!dict.has(w)) dict.set(w, { kind: "sort", sort });
  return dict;
}

/** Term groups (synonym lines whose canonical is not a facet value): folded word → equivalents. */
export function buildExpansions(input: ParserInput): Map<string, string[]> {
  const facetNames = new Set(input.taxonomy.values.flatMap((v) => [phraseKey(v.name), v.slug]));
  const out = new Map<string, Set<string>>();
  for (const entry of input.synonyms) {
    const c = phraseKey(entry.canonical);
    if (facetNames.has(c) || facetNames.has(c.replace(/\s+/g, "-"))) continue;
    const terms = [...new Set(entry.terms.map(phraseKey).filter(Boolean))];
    for (const term of terms) {
      const set = out.get(term) ?? new Set<string>();
      for (const other of terms) if (other !== term) set.add(other);
      out.set(term, set);
    }
  }
  return new Map([...out].map(([k, v]) => [k, [...v]]));
}

const money = (n: number, currency?: string) => `${SYMBOL[currency ?? "EUR"] ?? `${currency} `}${n.toLocaleString("en-US")}`;

/**
 * Parses a search query. `dict`/`expansions` come from buildDictionary/buildExpansions (pass them
 * when parsing many queries for one shop; otherwise they are built from `input`).
 */
export function parseQuery(query: string, input: ParserInput, prepared?: { dict: Map<string, Target>; expansions: Map<string, string[]> }): ParsedQuery {
  const original = query.replace(/\s+/g, " ").trim();
  const dict = prepared?.dict ?? buildDictionary(input);
  const expansionsMap = prepared?.expansions ?? buildExpansions(input);
  const rawTokens = original.split(" ").filter(Boolean);
  // Token list with the raw (typed) form kept for chips/text; folded tokens may split further.
  const tokens: Token[] = [];
  for (const raw of rawTokens) {
    const parts = tokenize(fold(raw));
    // Keep a 1:1 mapping where possible (for removeQuery); split tokens share the raw word.
    if (parts.length === 1) tokens.push({ folded: parts[0], raw });
    else for (const p of parts) tokens.push({ folded: p, raw: p });
    // Keep operator-like tokens the tokenizer drops: "< 500", "€100 - €500".
    if (parts.length === 0 && /^([<>]=?|[-–])$/.test(raw)) tokens.push({ folded: raw === "–" ? "-" : raw, raw });
  }
  // Separate "€" / "eur" glued to a number is handled by parseAmount; "< 500" by the triggers.

  const used = new Array<boolean>(tokens.length).fill(false);
  const keepAsText = new Array<boolean>(tokens.length).fill(false);
  const chips: InterpretationChip[] = [];
  const facets: string[] = [];
  let min: number | null = null;
  let max: number | null = null;
  let status: ParsedQuery["status"] = null;
  let sort: ParsedQuery["sort"] = null;
  let stockCode: number | null = null;

  const span = (i: number, n: number) => tokens.slice(i, i + n).map((t) => t.raw).join(" ");
  const removeQuery = (i: number, n: number) =>
    tokens
      .filter((_, k) => k < i || k >= i + n)
      .map((t) => t.raw)
      .join(" ");
  const mark = (i: number, n: number) => {
    for (let k = i; k < i + n; k++) used[k] = true;
  };
  const currencyAt = (i: number) => (tokens[i] && CURRENCY_WORDS.has(tokens[i].folded) ? 1 : 0);

  // 1. Prices.
  for (let i = 0; i < tokens.length; i++) {
    if (used[i]) continue;
    // Range: "tussen 100 en 500 euro", "100-500 euro", "€100 - €500", "van 100 tot 500"
    const start = phraseAt(tokens, i, RANGE_START);
    const rangeFrom = i + start;
    const a = tokens[rangeFrom] ? parseAmount(tokens[rangeFrom].folded) : null;
    const dash = tokens[rangeFrom] ? /^(€?\d[\d.,]*)[-–](€?\d[\d.,]*(?:€|eur|euro)?)$/.exec(tokens[rangeFrom].folded) : null;
    if (dash) {
      const lo = parseAmount(dash[1]);
      const hi = parseAmount(dash[2]);
      const cur = currencyAt(rangeFrom + 1);
      if (lo && hi && lo.value <= hi.value && (lo.currency || hi.currency || cur || start) && !(isYear(lo.value) && isYear(hi.value) && !(lo.currency || hi.currency || cur))) {
        const n = start + 1 + cur;
        min = lo.value || null;
        max = hi.value;
        chips.push({ kind: "price", label: `${money(lo.value, input.currency)}–${money(hi.value, input.currency)}`, matched: span(i, n), removeQuery: removeQuery(i, n) });
        mark(i, n);
        continue;
      }
    }
    if (a) {
      const afterA = rangeFrom + 1 + currencyAt(rangeFrom + 1);
      const join = phraseAt(tokens, afterA, RANGE_JOIN);
      const b = join && tokens[afterA + join] ? parseAmount(tokens[afterA + join].folded) : null;
      if (b && a.value <= b.value) {
        const cur = currencyAt(afterA + join + 1);
        const hasCurrency = a.currency || b.currency || cur > 0 || afterA > rangeFrom + 1;
        const yearsOnly = isYear(a.value) && isYear(b.value) && !hasCurrency;
        if ((start > 0 || hasCurrency) && !yearsOnly) {
          const n = afterA + join + 1 + cur - i;
          min = a.value || null;
          max = b.value;
          chips.push({ kind: "price", label: `${money(a.value, input.currency)}–${money(b.value, input.currency)}`, matched: span(i, n), removeQuery: removeQuery(i, n) });
          mark(i, n);
          continue;
        }
      }
    }
    // Single bound: trigger + amount (+ currency word), or currency-only amount after a trigger.
    for (const [list, strict, bound] of [
      [MAX_STRICT, true, "max"],
      [MAX_LOOSE, false, "max"],
      [MIN_STRICT, true, "min"],
      [MIN_LOOSE, false, "min"],
    ] as const) {
      const t = phraseAt(tokens, i, list as unknown as string[]);
      if (!t) continue;
      let j = i + t;
      const pre = currencyAt(j); // "onder € 500"
      j += pre;
      const amount = tokens[j] ? parseAmount(tokens[j].folded) : null;
      if (!amount) continue;
      const post = currencyAt(j + 1);
      const hasCurrency = amount.currency || pre > 0 || post > 0;
      if (!strict && !hasCurrency && isYear(amount.value)) continue;
      if (!hasCurrency && !strict && amount.value < 10) continue;
      const n = j + 1 + post - i;
      if (bound === "max") max = amount.value;
      else min = amount.value || null;
      chips.push({
        kind: "price",
        label: bound === "max" ? `Max ${money(amount.value, input.currency)}` : `Min ${money(amount.value, input.currency)}`,
        matched: span(i, n),
        removeQuery: removeQuery(i, n),
      });
      mark(i, n);
      break;
    }
  }
  if (min !== null && max !== null && min > max) [min, max] = [max, min];

  // 2. Stock numbers: "#50212", "nr 50212", "no. 50212"; a bare 5–9 digit number is a likely one.
  for (let i = 0; i < tokens.length; i++) {
    if (used[i]) continue;
    const t = tokens[i].folded;
    const hash = /^#(\d{1,9})$/.exec(t);
    if (hash) {
      stockCode = Number(hash[1]);
      chips.push({ kind: "stock", label: `No. ${stockCode}`, matched: tokens[i].raw, removeQuery: removeQuery(i, 1) });
      mark(i, 1);
      continue;
    }
    if (STOCK_PREFIXES.has(t) && tokens[i + 1] && /^#?\d{1,9}$/.test(tokens[i + 1].folded)) {
      stockCode = Number(tokens[i + 1].folded.replace("#", ""));
      chips.push({ kind: "stock", label: `No. ${stockCode}`, matched: span(i, 2), removeQuery: removeQuery(i, 2) });
      mark(i, 2);
      continue;
    }
    if (stockCode === null && /^\d{5,9}$/.test(t)) stockCode = Number(t); // stays text too (SKU-like)
  }

  // 3. Facet values, status and sort words (longest phrase first).
  for (let i = 0; i < tokens.length; i++) {
    if (used[i]) continue;
    let hit: { n: number; target: Target } | null = null;
    for (let n = Math.min(5, tokens.length - i); n >= 1; n--) {
      if (tokens.slice(i, i + n).some((_, k) => used[i + k])) continue;
      const phrase = tokens
        .slice(i, i + n)
        .map((t) => t.folded)
        .join(" ");
      const target = dict.get(phrase);
      if (target) {
        hit = { n, target };
        break;
      }
    }
    if (!hit) continue;
    const { n, target } = hit;
    if (target.kind === "facet") {
      const token = facetToken(target.facetSlug, target.valueSlug);
      if (!facets.includes(token)) {
        facets.push(token);
        chips.push({ kind: "facet", label: `${target.facetName}: ${target.valueName}`, matched: span(i, n), token, removeQuery: removeQuery(i, n) });
      }
      if (target.facetKind === "TYPE") for (let k = i; k < i + n; k++) keepAsText[k] = true;
    } else if (target.kind === "status") {
      if (target.status === "sold" && status !== "sold") {
        status = "sold";
        chips.push({ kind: "status", label: "Sold items", matched: span(i, n), removeQuery: removeQuery(i, n) });
      }
    } else if (target.kind === "sort" && !sort) {
      sort = target.sort;
      chips.push({ kind: "sort", label: target.sort === "price_asc" ? "Lowest price first" : "Highest price first", matched: span(i, n), removeQuery: removeQuery(i, n) });
    }
    mark(i, n);
    i += n - 1;
  }

  // 4. What is left is free text.
  const left = tokens.filter((_, k) => !used[k] || keepAsText[k]);
  const meaningful = left.filter((t) => !STOPWORDS.has(t.folded) && !CURRENCY_WORDS.has(t.folded));
  const text = meaningful.map((t) => t.raw).join(" ");
  const terms = [
    ...new Set(
      meaningful
        .flatMap((t) => t.folded.split(/[^\p{L}\p{N}]+/u))
        .filter((w) => w && !STOPWORDS.has(w) && !/^\d{1,3}$/.test(w)),
    ),
  ].slice(0, 8);
  const expansions: Record<string, string[]> = {};
  for (const term of terms) {
    const e = expansionsMap.get(term);
    if (e?.length) expansions[term] = e.slice(0, 12);
  }
  // Multi-word term-group phrases ("ijzeren kruis") expand as a whole.
  for (let i = 0; i < meaningful.length - 1; i++) {
    for (let n = Math.min(4, meaningful.length - i); n >= 2; n--) {
      const phrase = meaningful
        .slice(i, i + n)
        .map((t) => t.folded)
        .join(" ");
      const e = expansionsMap.get(phrase);
      if (e?.length) expansions[phrase] = e.slice(0, 12);
    }
  }

  return { original, text, terms, expansions, facets, min, max, status, sort, stockCode, chips };
}
