"use client";

import dynamic from "next/dynamic";

/*
 * Code-split entry points for shop-layout widgets that most page views never render (performance,
 * docs/perf/round2.md): a client component imported directly by the layout lands in the layout's
 * shared chunk and is downloaded on every page even when not rendered. Through next/dynamic (which
 * must be called from a client module to split) the chunk only loads when the server rendered the
 * widget — SSR output is unchanged.
 */

/** Age confirmation dialog — only for visitors without the confirmation cookie. */
export const AgeGate = dynamic(() => import("./AgeGate").then((m) => m.AgeGate));

/** Staff theme preview ribbon + live builder bridge — only in theme preview. */
export const ThemePreviewBridge = dynamic(() => import("./ThemePreviewBridge").then((m) => m.ThemePreviewBridge));
