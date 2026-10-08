import { fold, tokenize } from "./normalize";

/*
 * Search synonyms (Settings → Catalog → Search synonyms). One entry per line:
 *
 *     <canonical>: <alias>, <alias>, …
 *
 * - When <canonical> is the name (or slug) of one of the shop's facet values, every alias is a way to
 *   say that value: "Duitse helm" → filter Country: Germany. Facet names win, so the same default
 *   list works for every shop — a line whose canonical is not a facet value of this shop silently
 *   acts as a plain term group instead.
 * - Otherwise the line is a term group: the canonical and its aliases are equivalent words for the
 *   lexical search ("veldfles" also finds "canteen" and "Feldflasche"). Semantic search handles most
 *   translations by itself; term groups make the exact-word side multilingual too.
 * - Matching ignores case and accents. Lines starting with "#" are comments.
 *
 * Pure module (shared with the admin form and tests).
 */

export type SynonymEntry = {
  /** As written (trimmed). */
  canonical: string;
  /** Folded canonical + aliases, deduplicated, canonical first. */
  terms: string[];
};

export const MAX_SYNONYM_TEXT = 20_000;

/** Militaria defaults (NL/DE/EN). Facet lines use the names of the standard facets (src/server/facets/defaults.ts). */
export const DEFAULT_SYNONYMS = `# Countries (facet "Country")
Germany: duits, duitse, duitser, duitsland, german, germany, deutsch, deutsche, deutscher, deutsches, deutschland, allemand, allemande, wehrmacht, derde rijk, third reich, drittes reich
Netherlands: nederlands, nederlandse, nederland, dutch, holland, hollands, hollandse, niederlande, niederlandisch, niederlandische, neerlandais
United Kingdom: brits, britse, engels, engelse, groot-brittannie, british, english, england, britain, great britain, uk, britisch, britische, englisch, englische
USA: amerikaans, amerikaanse, verenigde staten, american, america, united states, us, u.s., us army, amerikanisch, amerikanische
France: frans, franse, frankrijk, french, franzosisch, franzosische, frankreich, francais, francaise
Belgium: belgisch, belgische, belgie, belgian, belgien, belge
Soviet Union: sovjet, sovjet-unie, sovjetunie, russisch, russische, rusland, soviet, russian, russia, ussr, cccp, sssr, sowjetisch, sowjetische, sowjetunion, rote armee, rode leger, red army
Italy: italiaans, italiaanse, italie, italian, italienisch, italienische, italien
Japan: japans, japanse, japanese, japanisch, japanische
Poland: pools, poolse, polen, polish, polnisch, polnische
Canada: canadees, canadese, canadian, kanada, kanadisch, kanadische

# Periods (facet "Period")
WW2: ww2, wwii, ww 2, ww ii, wo2, woii, wo 2, wo ii, wk2, wkii, 2e wereldoorlog, tweede wereldoorlog, second world war, world war 2, world war two, world war ii, 2. weltkrieg, zweiter weltkrieg, zweiten weltkrieg, 1939-1945, 1940-1945, 39-45, 40-45, seconde guerre mondiale
WW1: ww1, wwi, ww 1, ww i, wo1, woi, wo 1, wo i, wk1, wki, 1e wereldoorlog, eerste wereldoorlog, first world war, world war 1, world war one, world war i, great war, groote oorlog, 1. weltkrieg, erster weltkrieg, ersten weltkrieg, 1914-1918, 14-18, grande guerre
Interbellum: interbellum, interwar, inter-war, between the wars, zwischenkriegszeit, 1919-1939
Cold War: koude oorlog, cold war, kalter krieg, kalten krieg, guerre froide
Pre-WW1: pre-ww1, pre ww1, voor ww1, voor de eerste wereldoorlog, kaiserreich, imperial germany, keizerrijk
Post-Cold War: post-cold war, na de koude oorlog, nach dem kalten krieg

# Branches (facet "Branch")
Army: leger, landmacht, landstrijdkrachten, army, armee, heeres
Navy: marine, zeemacht, navy, koninklijke marine, royal navy
Air Force: luchtmacht, air force, raf, usaaf, lw, luchtvaart
Marines: mariniers, korps mariniers, marines, usmc, marinier
Waffen-SS: waffen ss, waffen-ss
Police: politie, polizei, police, marechaussee, gendarmerie
Civil defence: bescherming bevolking, luchtbescherming, luftschutz, civil defence, civil defense, zivilschutz

# Units (facet "Unit")
Airborne: para, paras, parachutist, parachutisten, paratrooper, paratroopers, luchtlandingstroepen, fallschirmjager, fallschirmjaeger, airborne
Infantry: infanterie, infanterist, infantry, infantrist, fanterie

# Types (facet "Type")
Helmets: helm, helmen, helme, helmet, helmets, stahlhelm, stahlhelme, staalhelm, casque, casques
Uniforms: uniform, uniformen, uniforme, uniforms, kleding, kleidung, clothing
Insignia: insigne, insignes, insignia, abzeichen, embleem, emblemen
Documents: document, documenten, dokumente, documents, papieren, papers, urkunde, oorkonde
Edged weapons: blankwapen, blankwapens, blanke wapens, edged weapon, edged weapons, blankwaffe, blankwaffen

# Term groups (equivalent words for the exact-word search)
jacket: jas, jassen, jack, jacke, tuniek, tunic, blouse, bluse, feldbluse, field blouse, field jacket, veldjas, vareuse, battledress
greatcoat: mantel, overjas, jas, greatcoat, overcoat, coat, shinel
trousers: broek, broeken, hose, pants, trousers
cap: pet, petten, muts, mutsen, cap, caps, mutze, muetze, feldmutze, schirmmutze, schiffchen, pilotka, kepi, beret, baret
collar tabs: kraagspiegel, kraagspiegels, kragenspiegel, kragenspiegeln, collar tab, collar tabs, collar patches
canteen: veldfles, veldflessen, drinkfles, feldflasche, canteen, water bottle, waterfles
bread bag: broodzak, broodtas, brotbeutel, bread bag, haversack
mess kit: eetketel, kookketel, kochgeschirr, mess kit, mess tin, gamelle
belt buckle: koppelslot, riemgesp, gesp, koppelschloss, koppelschloß, buckle, belt buckle, boucle
belt: koppel, riem, koppeltuig, belt, webbing, koppelzeug
medal: medaille, medailles, onderscheiding, onderscheidingen, decoratie, orden, ehrenzeichen, medal, medals, award, decoration
iron cross: ijzeren kruis, eisernes kreuz, ek1, ek2, iron cross
badge: badge, speld, abzeichen, badges, insigne
patch: patch, patches, embleem, armembleem, mouwembleem, armelabzeichen, arm patch, shoulder patch, sleeve insignia
bayonet: bajonet, bajonetten, bajonett, seitengewehr, bayonet, bayonets, baionnette
dagger: dolk, dolken, dolch, dagger, daggers, poignard
sword: sabel, zwaard, degen, sabre, saber, sabel, sword, swords, sabel
binoculars: verrekijker, kijker, fernglas, dienstglas, binoculars, binocular
compass: kompas, kompass, marschkompass, compass
gas mask: gasmasker, gasmaske, gas mask, gasmask
shovel: schep, schop, spade, klappspaten, spaten, entrenching tool, shovel
knapsack: ransel, rugzak, tornister, rucksack, knapsack, backpack, pack
field telephone: veldtelefoon, feldfernsprecher, field telephone, field phone
torch: zaklamp, lamp, taschenlampe, torch, flashlight, signal torch
tent: tent, zeltbahn, shelter half, poncho, tentdoek
camouflage: camo, camouflage, tarn, tarnmuster, splinter, erbsentarn
paybook: soldbuch, wehrpass, zakboekje, paybook, pay book, ausweis, id card
photo: foto, fotos, photo, photos, photograph, ansichtkaart, postkaart, postcard, postkarte
`;

/** Parses the settings text (or the defaults). Invalid lines are skipped. */
export function parseSynonyms(text: string | null | undefined): SynonymEntry[] {
  const out: SynonymEntry[] = [];
  for (const raw of (text ?? "").slice(0, MAX_SYNONYM_TEXT).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const canonical = line.slice(0, colon).trim();
    const aliases = line
      .slice(colon + 1)
      .split(",")
      .map((a) => fold(a))
      .filter((a) => a.length > 0 && a.length <= 60);
    const terms = [...new Set([fold(canonical), ...aliases])].filter((t) => tokenize(t).length > 0 && tokenize(t).length <= 5);
    if (canonical.length > 80 || terms.length === 0) continue;
    out.push({ canonical, terms });
  }
  return out;
}

/** Problems in an owner's synonym text, for the settings form (empty = fine). */
export function synonymProblems(text: string): string[] {
  const problems: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    if (line.indexOf(":") <= 0) problems.push(`Line ${i + 1}: expected "word: alias, alias"`);
  });
  return problems.slice(0, 5);
}
