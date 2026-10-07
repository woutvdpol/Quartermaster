import type { Metadata } from "next";
import { redirectOrNotFound } from "@/server/redirects/runtime";

/*
 * Target of the catch-all *fallback* rewrite in next.config.ts: Next only applies it after every page,
 * dynamic route and static file was tried, so this runs exclusively for URLs that would otherwise 404
 * (old Concept500 links, owner-managed redirects). It redirects or renders the shop's not-found page.
 */

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function UnmatchedPage({ params, searchParams }: PageProps<"/qm-unmatched/[...path]">) {
  const [{ path }, sp] = await Promise.all([params, searchParams]);
  return redirectOrNotFound(`/${path.join("/")}`, sp);
}
