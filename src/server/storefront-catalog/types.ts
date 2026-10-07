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

export type CatalogFacets = {
  /** Direct counts per category id under the non-category filters; key "" = uncategorised. */
  categoryCounts: Record<string, number>;
  /** Tags of the current result set (count = results if the tag were added). */
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
  updatedAt: string;
  seoTitle: string | null;
  seoDescription: string | null;
  categoryId: string | null;
  /** Root → leaf; empty when uncategorised or the category is hidden. */
  categoryPath: { id: string; title: string; slug: string }[];
  tags: { id: string; name: string; slug: string }[];
  images: PublicImage[];
  /** Manually related products (ProductRelation order), ids only — resolved via getRelatedProducts. */
  relatedIds: string[];
};
