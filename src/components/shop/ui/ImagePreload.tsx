"use client";

import { preload } from "react-dom";

/**
 * Head preload for a priority image inside <picture> (React only auto-preloads a bare <img>).
 * A client component on purpose: `preload()` called during the SSR (Fizz) render lands in the
 * document <head> before the inline CSS; called from a server component it travels as an RSC hint that
 * reached the HTML too late to be emitted (measured: no <link> at all). Renders nothing.
 */
export function ImagePreload({ href, srcSet, sizes, type }: { href: string; srcSet: string; sizes: string; type: string }) {
  preload(href, { as: "image", imageSrcSet: srcSet, imageSizes: sizes, type, fetchPriority: "high" });
  return null;
}
