import type { ImageSource } from "@/lib/media/variants";

/**
 * Public, serialisable catalog DTOs (safe for the client and for the data cache: no Dates, no Prisma
 * types). They never carry purchase prices, internal notes, legacyData or other tenants' data.
 */

/** Shop-facing status. "reserved" = RESERVED status or (computed per request) held in someone's cart. */
export type PublicStatus = "available" | "reserved" | "sold";

export type PublicImage = {
  id: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  /** 320w */
  thumb: string;
  /** 800w */
  card: string;
  /** 2000w ("deep zoom" source) */
  large: string;
  /** 24w, for sensitive items shown to guests */
  blur: string;
  /** Inline LQIP, null for unprocessed images */
  blurDataUrl: string | null;
  /** Responsive WebP/AVIF widths (src/lib/media/variants.ts); null for unprocessed images. */
  sources: ImageSource[] | null;
};

export type CatalogCard = {
  id: string;
  stockCode: number;
  slug: string;
  href: string;
  title: string;
  /** Minor units, shop currency. */
  price: number;
  status: PublicStatus;
  onSale: boolean;
  blurred: boolean;
  /** Sold item whose price the dealer shows in the archive (docs/sold-archive.md); `price` is 0 otherwise. */
  showSoldPrice: boolean;
  publishedAt: string | null;
  soldAt: string | null;
  category: { title: string; slug: string } | null;
  cover: PublicImage | null;
};

export type PublicCategoryNode = {
  id: string;
  parentId: string | null;
  title: string;
  slug: string;
  /** Visible (for sale / reserved) products directly in this category. */
  count: number;
  /** Visible products in this category and its descendants. */
  total: number;
  children: PublicCategoryNode[];
};

export type PublicCategory = {
  id: string;
  parentId: string | null;
  title: string;
  slug: string;
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
};

export type TagFacet = { id: string; name: string; slug: string; count: number };

/** One facet value in the sidebar (tree). `count` includes products linked to any descendant. */
export type FacetValueOption = {
  id: string;
  name: string;
  slug: string;
  /** URL token "<facetSlug>.<valueSlug>". */
  token: string;
  count: number;
  selected: boolean;
  children: FacetValueOption[];
};

/** A filterable facet with its value tree (counts under every filter except this facet's own). */
export type FacetGroup = { id: string; kind: string; name: string; slug: string; values: FacetValueOption[] };

/** Public taxonomy of a shop (cached; no counts). */
export type PublicFacetValue = { id: string; facetId: string; parentId: string | null; name: string; slug: string; sortOrder: number };
export type PublicFacet = { id: string; kind: string; name: string; slug: string; sortOrder: number; isFilterable: boolean };
export type PublicTaxonomy = { facets: PublicFacet[]; values: PublicFacetValue[] };

/** A product's values of one facet (product page eyebrow / details table). */
export type ProductFacet = {
  facet: { id: string; kind: string; name: string; slug: string; isFilterable: boolean };
  values: { id: string; name: string; slug: string; token: string; path: string[] }[];
};

export type CatalogFacets = {
  /** Direct counts per category id under the non-category filters; key "" = uncategorised. */
  categoryCounts: Record<string, number>;
  /** Facet filters (filterable facets with at least one value), in facet order. */
  facets: FacetGroup[];
  /** Tags of the current result set that are not mapped to a facet value (count = results if the tag were added). */
  tags: TagFacet[];
  /** Price bounds (minor units) under every filter except price; null when empty. */
  price: { min: number; max: number } | null;
};

export type CatalogPage = { items: CatalogCard[]; total: number };

export type Specification = { label: string; value: string };

export type PublicProduct = {
  id: string;
  tenantId: string;
  stockCode: number;
  sku: string | null;
  slug: string;
  href: string;
  title: string;
  description: string | null;
  specifications: Specification[];
  price: number;
  status: PublicStatus;
  onSale: boolean;
  weightGrams: number;
  blurred: boolean;
  ageRestricted: boolean;
  restrictedSymbols: boolean;
  acceptsOffers: boolean;
  publishedAt: string | null;
  soldAt: string | null;
  /** Sold archive (docs/sold-archive.md): left out of the archive list / sitemap / index. */
  archiveHidden: boolean;
  /** Sold price shown; when false and sold, `price` is 0 (never sent to the visitor). */
  showSoldPrice: boolean;
  updatedAt: string;
  seoTitle: string | null;
  seoDescription: string | null;
  categoryId: string | null;
  /** Root → leaf; empty when uncategorised or the category is hidden. */
  categoryPath: { id: string; title: string; slug: string }[];
  tags: { id: string; name: string; slug: string }[];
  /** Facet values, grouped per facet in facet order. */
  facets: ProductFacet[];
  /** Deactivated weapon (EU 2018/337) — a certificate is on file before the item goes live. */
  requiresDeactivationCert: boolean;
  images: PublicImage[];
  /** Manually related products (ProductRelation order), ids only — resolved via getRelatedProducts. */
  relatedIds: string[];
};
