import type { FacetKindName } from "./tree";

/**
 * The six standard facets every shop starts with, with starter values for period, country and
 * branch. `children` builds a hierarchy (Army › Heer: selecting "Army" in the shop also matches
 * items tagged "Heer"). Pure data — used by seedDefaultFacets.
 */
export type DefaultValue = { name: string; children?: DefaultValue[] };
export type DefaultFacet = { kind: FacetKindName; name: string; slug: string; values: DefaultValue[] };

export const DEFAULT_FACETS: readonly DefaultFacet[] = [
  {
    kind: "PERIOD",
    name: "Period",
    slug: "period",
    values: [
      { name: "Pre-WW1" },
      { name: "WW1" },
      { name: "Interbellum" },
      { name: "WW2" },
      { name: "Cold War" },
      { name: "Post-Cold War" },
    ],
  },
  {
    kind: "COUNTRY",
    name: "Country",
    slug: "country",
    values: [
      { name: "Germany" },
      { name: "Netherlands" },
      { name: "United Kingdom" },
      { name: "USA" },
      { name: "France" },
      { name: "Belgium" },
      { name: "Soviet Union" },
      { name: "Italy" },
      { name: "Japan" },
      { name: "Poland" },
      { name: "Canada" },
    ],
  },
  {
    kind: "BRANCH",
    name: "Branch",
    slug: "branch",
    values: [
      { name: "Army", children: [{ name: "Heer" }] },
      { name: "Navy", children: [{ name: "Kriegsmarine" }] },
      { name: "Air Force", children: [{ name: "Luftwaffe" }] },
      { name: "Marines" },
      { name: "Waffen-SS" },
      { name: "Police" },
      { name: "Civil defence" },
    ],
  },
  { kind: "UNIT", name: "Unit", slug: "unit", values: [] },
  { kind: "TYPE", name: "Type", slug: "type", values: [] },
  { kind: "MAKER", name: "Maker", slug: "maker", values: [] },
];
