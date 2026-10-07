/**
 * Tags are flat (no taxonomy yet — see docs/analysis/03 §9 #1). For the shop's facet sidebar we group
 * them heuristically into Period / Country / Branch by well-known names; everything else lands in
 * "More". Pure, no DB — safe for tests and client code.
 */

export type TagGroupKey = "period" | "country" | "branch" | "other";

export const TAG_GROUP_ORDER: readonly TagGroupKey[] = ["period", "country", "branch", "other"];

const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const PERIODS = [
  "ww1", "wwi", "ww 1", "wo1", "wo 1", "world war 1", "world war i", "first world war", "great war",
  "interbellum", "interwar", "inter war",
  "ww2", "wwii", "ww 2", "wo2", "wo 2", "world war 2", "world war ii", "second world war",
  "cold war", "koude oorlog", "korea", "korean war", "vietnam", "vietnam war", "post war", "postwar",
  "napoleonic", "boer war", "franco prussian war", "imperial", "weimar", "third reich", "modern",
  "pre ww1", "1870", "1914 1918", "1939 1945", "1940 1945",
];

const COUNTRIES = [
  "germany", "netherlands", "belgium", "france", "united kingdom", "uk", "great britain", "britain",
  "usa", "us", "united states", "soviet union", "ussr", "russia", "italy", "japan", "poland", "austria",
  "austria hungary", "hungary", "canada", "australia", "new zealand", "norway", "denmark", "sweden",
  "finland", "switzerland", "spain", "portugal", "czechoslovakia", "yugoslavia", "romania", "bulgaria",
  "greece", "luxembourg", "east germany", "ddr", "west germany", "prussia", "bavaria", "saxony",
  "duitsland", "nederland", "belgie", "frankrijk", "engeland", "verenigde staten", "rusland",
];

const BRANCHES = [
  "heer", "luftwaffe", "kriegsmarine", "waffen ss", "army", "navy", "air force", "raf", "royal navy",
  "marines", "usmc", "infantry", "airborne", "paratroopers", "fallschirmjager", "artillery", "cavalry",
  "armour", "armor", "panzer", "engineers", "medical", "signals", "police", "polizei", "knil", "kl",
  "klu", "koninklijke landmacht", "koninklijke marine", "luchtmacht", "landmacht", "marine",
  "mariniers", "volkssturm", "hitlerjugend", "rad", "ndap", "nsb", "resistance", "home guard",
];

const SETS: Record<Exclude<TagGroupKey, "other">, Set<string>> = {
  period: new Set(PERIODS.map(norm)),
  country: new Set(COUNTRIES.map(norm)),
  branch: new Set(BRANCHES.map(norm)),
};

/** Optional explicit prefix: "Period: WW2", "country - Germany", "branch/Heer". */
const PREFIX = /^\s*(period|era|country|nation|branch|unit|service)\s*[:/-]\s*(.+)$/i;
const PREFIX_GROUP: Record<string, TagGroupKey> = {
  period: "period",
  era: "period",
  country: "country",
  nation: "country",
  branch: "branch",
  unit: "branch",
  service: "branch",
};

/** Classifies one tag name, returning its group and display label (prefix stripped). */
export function classifyTag(name: string): { group: TagGroupKey; label: string } {
  const prefixed = PREFIX.exec(name);
  if (prefixed) return { group: PREFIX_GROUP[prefixed[1].toLowerCase()], label: prefixed[2].trim() };
  const n = norm(name);
  for (const key of ["period", "country", "branch"] as const) {
    if (SETS[key].has(n)) return { group: key, label: name };
  }
  // Year ranges like "1914-1918" or decades like "1950s" read as periods.
  if (/^(1[6-9]|20)\d\d(s| \d{2,4})?$/.test(n)) return { group: "period", label: name };
  return { group: "other", label: name };
}

export type GroupedTag<T> = T & { label: string };
export type TagGroup<T> = { key: TagGroupKey; tags: GroupedTag<T>[] };

/** Groups tags into the fixed facet order; empty groups are omitted. Tag order within a group is kept. */
export function groupTags<T extends { name: string }>(tags: readonly T[]): TagGroup<T>[] {
  const buckets = new Map<TagGroupKey, GroupedTag<T>[]>();
  for (const tag of tags) {
    const { group, label } = classifyTag(tag.name);
    const list = buckets.get(group) ?? [];
    list.push({ ...tag, label });
    buckets.set(group, list);
  }
  return TAG_GROUP_ORDER.flatMap((key) => {
    const list = buckets.get(key);
    return list?.length ? [{ key, tags: list }] : [];
  });
}
