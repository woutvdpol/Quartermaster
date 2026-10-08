"use client";

import { useEffect } from "react";
import { THEME_PREVIEW_MESSAGE, THEME_PREVIEW_PARAM } from "@/lib/theme-preview";
import { shopThemeVars, type ThemeInput } from "@/server/storefront/theme";
import type { FONT_ALLOWLIST, SHOP_THEMES } from "@/server/settings/schema";

type FontName = (typeof FONT_ALLOWLIST)[number];
type ShopTheme = (typeof SHOP_THEMES)[number];

type PreviewTheme = {
  theme: ShopTheme;
  colors: ThemeInput["colors"];
  headingFont: FontName;
  textFont: FontName;
  corners: NonNullable<ThemeInput["corners"]>;
  buttonShape: NonNullable<ThemeInput["buttonShape"]>;
  density: NonNullable<ThemeInput["density"]>;
};

/**
 * Rendered only in staff theme preview (Website → Theme). Shows the "Theme preview" ribbon and
 * applies unsaved builder changes instantly: the builder (same origin, parent window) posts the
 * current theme, and this recomputes the `.shop-root` variables with the same function the server
 * layout uses. Anything else (logo, saved state) arrives with the next reload.
 */
export function ThemePreviewBridge({
  hasDraft,
  notLive = false,
  fonts,
  themes,
  faceCss,
}: {
  hasDraft: boolean;
  /** The shop is still in its setup wizard ("coming soon"): said in this ribbon instead of a second bar. */
  notLive?: boolean;
  fonts: Record<FontName, string>;
  themes: Record<ShopTheme, { accent: string; mono: string; accentFont: FontName }>;
  /** @font-face rules per family: the page only declares the live theme's fonts, the rest load on demand. */
  faceCss: Record<string, string>;
}) {
  useEffect(() => {
    // Families picked in the builder that the server-rendered page did not declare: add their rules once.
    const loaded = new Set<string>();
    function loadFamily(name: string) {
      if (loaded.has(name) || !faceCss[name]) return;
      loaded.add(name);
      const style = document.createElement("style");
      style.dataset.qmPreviewFont = name;
      style.textContent = faceCss[name];
      document.head.appendChild(style);
    }
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const data = event.data as { type?: string; theme?: PreviewTheme } | null;
      if (!data || data.type !== THEME_PREVIEW_MESSAGE || !data.theme) return;
      const t = data.theme;
      const root = document.querySelector<HTMLElement>(".shop-root");
      if (!root || !themes[t.theme] || !fonts[t.headingFont] || !fonts[t.textFont]) return;
      const vars = shopThemeVars({
        colors: t.colors,
        headingFontFamily: fonts[t.headingFont],
        textFontFamily: fonts[t.textFont],
        accentFontFamily: themes[t.theme].accent,
        monoFontFamily: themes[t.theme].mono,
        corners: t.corners,
        buttonShape: t.buttonShape,
        density: t.density,
      });
      for (const name of [t.headingFont, t.textFont, themes[t.theme].accentFont]) loadFamily(name);
      root.dataset.shopTheme = t.theme;
      for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    }
    window.addEventListener("message", onMessage);
    // Tell the builder we are ready, so it can push the current (possibly unsaved) state.
    if (window.parent !== window) window.parent.postMessage({ type: `${THEME_PREVIEW_MESSAGE}:ready` }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, [fonts, themes, faceCss]);

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-[60] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-[#1c1a16] px-4 py-1.5 text-center text-xs font-medium text-white"
      style={{ fontFamily: "system-ui, sans-serif" }}
    >
      <span>
        <strong className="font-semibold">Theme preview</strong> · {hasDraft ? "showing unpublished changes — visitors still see the live theme" : "no unpublished changes"}
        {notLive ? (
          <>
            {" "}
            · <strong className="font-semibold">Not live yet</strong> — visitors see “Opening soon”
          </>
        ) : null}
      </span>
      <a href={`?${THEME_PREVIEW_PARAM}=0`} className="underline underline-offset-2">
        Exit preview
      </a>
    </div>
  );
}
