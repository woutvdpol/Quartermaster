/**
 * German "to <country>": most countries take "nach" ("nach Deutschland"), but countries with an
 * article take "in" + accusative article ("in die Niederlande", "in die Schweiz", "ins Vereinigte
 * Königreich"). Country names come from Intl.DisplayNames("de").
 */
const WITH_ARTICLE: Record<string, string> = {
  Niederlande: "in die Niederlande",
  Schweiz: "in die Schweiz",
  Slowakei: "in die Slowakei",
  Türkei: "in die Türkei",
  Ukraine: "in die Ukraine",
  Mongolei: "in die Mongolei",
  Philippinen: "in die Philippinen",
  "Vereinigte Staaten": "in die Vereinigten Staaten",
  "Vereinigte Arabische Emirate": "in die Vereinigten Arabischen Emirate",
  USA: "in die USA",
  "Vereinigtes Königreich": "ins Vereinigte Königreich",
  Irak: "in den Irak",
  Iran: "in den Iran",
  Libanon: "in den Libanon",
  Vatikanstadt: "in die Vatikanstadt",
};

export function nachLand(country: string): string {
  return WITH_ARTICLE[country] ?? `nach ${country}`;
}
