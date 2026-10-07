import "server-only";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { getShopContext } from "@/server/storefront/context";
import { recordRedirectHits, resolveRedirect } from "./lookup";

/*
 * Storefront 404 → redirect hook. Shop pages call `redirectOrNotFound(path, searchParams)` where they
 * would call `notFound()` for a URL that doesn't exist (unknown CMS slug, unknown product/category),
 * and every URL no route matches reaches it via the catch-all fallback rewrite in next.config.ts
 * (→ src/app/(shop)/qm-unmatched/[...path]). Pages that render never get here, so normal requests
 * pay nothing. Only tenant shop hosts redirect; the platform host / unknown hosts just 404, and
 * /admin is never involved (the admin has its own catch-all).
 *
 * Status: Server Components can't emit 301/302 — Next uses 308 (permanentRedirect) and 307
 * (redirect). Search engines treat 308 like 301 (permanent) and 307 like 302 (temporary).
 */

export type SearchParamsInput = Record<string, string | string[] | undefined> | URLSearchParams | undefined;

/** Rebuilds "?a=1&b=2" from page searchParams (order kept; normalisation sorts later). */
export function searchString(sp: SearchParamsInput): string {
  if (!sp) return "";
  const out = new URLSearchParams();
  if (sp instanceof URLSearchParams) {
    sp.forEach((v, k) => out.append(k, v));
  } else {
    for (const [k, v] of Object.entries(sp)) {
      if (v === undefined) continue;
      for (const one of Array.isArray(v) ? v : [v]) out.append(k, one);
    }
  }
  const s = out.toString();
  return s ? `?${s}` : "";
}

/**
 * Redirects when a stored or built-in redirect matches `path` (+ query); otherwise notFound().
 * `path` may list candidates tried in order (e.g. "/product/12/old-slug", then "/product/12").
 */
export async function redirectOrNotFound(path: string | readonly string[], searchParams?: SearchParamsInput): Promise<never> {
  const shop = await getShopContext();
  if (!shop) notFound();
  const search = searchString(searchParams);
  let hit = null;
  for (const candidate of typeof path === "string" ? [path] : path) {
    hit = await resolveRedirect(shop.tenant.id, candidate + search);
    if (hit) break;
  }
  if (!hit) notFound();
  recordRedirectHits(hit.ids);
  if (hit.statusCode === 301) permanentRedirect(hit.target);
  redirect(hit.target);
}
