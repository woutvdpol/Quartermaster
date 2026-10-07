import { getShopCurrencyOptions, getVisitorDisplayCurrency } from "@/server/rates/display";
import { CurrencySwitcher } from "./CurrencySwitcher";

/**
 * Server wrapper for the header: loads the shop's display currencies (cached) and the visitor's
 * choice (cookie → render it inside <Suspense> on cached/static shells).
 *
 *   <Suspense fallback={null}><CurrencySwitcherSlot tenantId={tenant.id} /></Suspense>
 */
export async function CurrencySwitcherSlot({ tenantId, className }: { tenantId: string; className?: string }) {
  const [options, chosen] = await Promise.all([getShopCurrencyOptions(tenantId), getVisitorDisplayCurrency(tenantId)]);
  if (options.rates.length === 0) return null;
  return (
    <CurrencySwitcher
      shopCurrency={options.shopCurrency}
      options={options.rates.map((r) => r.currency)}
      current={chosen?.currency ?? null}
      className={className}
    />
  );
}
