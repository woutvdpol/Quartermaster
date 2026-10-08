/*
 * JSON contracts of the search route handlers (pure types — safe to import in client components).
 *
 *   GET  /api/search/suggest?q=…          → SuggestResponse
 *   POST /api/search/image (multipart)    → ImageSearchResponse | SearchErrorResponse
 *        fields: file (JPEG/PNG/WebP ≤ 10 MB), q? (text refinement), f? (facet tokens), min?, max?, page?
 */
import type { ProductCardData } from "@/components/shop/ui/types";
import type { InterpretationChip } from "./parser";

export type ApiInterpretation = {
  original: string;
  text: string;
  facets: string[];
  min: number | null;
  max: number | null;
  status: "sold" | null;
  sort: "price_asc" | "price_desc" | null;
  stockCode: number | null;
  chips: InterpretationChip[];
  relaxed: boolean;
};

export type SuggestResponse = {
  query: string;
  interpretation: ApiInterpretation;
  /** Facet values to offer as filters ("Country: Germany") with the /shop URL that applies them. */
  facets: { token: string; facet: string; value: string; label: string; href: string }[];
  /** Up to 5 products (same lock/blur rules as the catalog grid). */
  products: ProductCardData[];
  /** /shop?q=… for "show all results". */
  searchHref: string;
  /** Server time in ms; `semantic` tells whether the language model contributed. */
  timing: { totalMs: number; semantic: "used" | "cold" | "off" | "skipped" };
};

export type ImageSearchResponse = {
  items: ProductCardData[];
  total: number;
  page: number;
  pageSize: number;
  interpretation: ApiInterpretation;
  timing: { totalMs: number; imageMs: number };
};

export type SearchErrorResponse = { error: "too_large" | "unsupported" | "undecodable" | "rate_limited" | "unavailable" | "bad_request" | "not_found"; message: string };
