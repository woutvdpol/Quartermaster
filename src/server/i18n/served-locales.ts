import "server-only";
import { getSettings } from "@/server/settings";
import { hasModule } from "@/server/modules";
import { servedLocales, type ShopLocale } from "@/lib/i18n/shop-locales";

/*
 * Which languages a shop serves (docs/i18n.md § Shop-routing, docs/modules.md): English always, the
 * extras from settings.i18n.locales only with the Translations module. Without it "/nl" and "/de"
 * behave exactly as when those languages are switched off — routes 404, no hreflang alternates, no
 * language switcher — because every storefront reader goes through ShopContext.locales. The
 * settings and the translation rows are kept, so switching the module back on restores everything.
 */

/** Pure: served languages from the enabled setting and the Translations flag (ShopContext.locales). */
export function entitledServedLocales(enabled: readonly unknown[] | null | undefined, translations: boolean): ShopLocale[] {
  return servedLocales(translations ? enabled : []);
}

/** Served languages of a shop outside a shop request (jobs, scripts, tests). */
export async function shopServedLocales(tenantId: string): Promise<ShopLocale[]> {
  const [i18n, translations] = await Promise.all([getSettings(tenantId, "i18n"), hasModule(tenantId, "translations")]);
  return entitledServedLocales(i18n.locales, translations);
}
