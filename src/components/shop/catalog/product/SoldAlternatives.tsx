import { Suspense, cache } from "react";
import { AlertDialogButton } from "@/components/shop/alerts/AlertDialog";
import { resolveCompliance } from "@/server/compliance";
import { getSimilarProducts } from "@/server/search";
import { liveReservedIds, withLiveStatus } from "@/server/storefront-catalog";
import { catalogCopy as copy } from "../_copy";

const t = copy.product.want;

/**
 * "Looks like this" neighbours (smart search, data-cached per product) that the visitor may see:
 * compliance-hidden items dropped, live cart reservations applied. Memoised per request, so the
 * "Want one like this?" box and the similar rail share one lookup.
 */
export const similarForSale = cache(async (tenantId: string, productId: string, country: string | null) => {
  const candidates = await getSimilarProducts(tenantId, productId).catch(() => []);
  if (!candidates.length) return { items: [], verdicts: {} as Awaited<ReturnType<typeof resolveCompliance>> };
  const ids = candidates.map((c) => c.id);
  const [reserved, verdicts] = await Promise.all([
    liveReservedIds(tenantId, ids),
    country ? resolveCompliance(tenantId, ids, country) : Promise.resolve({} as Awaited<ReturnType<typeof resolveCompliance>>),
  ]);
  return { items: withLiveStatus(candidates.filter((c) => !verdicts[c.id]?.hidden), reserved), verdicts };
});

/**
 * Sold product page (design "SoldProduct", docs/sold-archive.md): instead of a buy box, "Want one like
 * this?" — an alert pre-filled from the item's category and facet values (suggestedQueryForProduct)
 * and the number of similar pieces for sale now, linking to the "Looks like this" rail (#pd-similar).
 * The count streams in; the box and the alert button render immediately.
 */
export function SoldAlternatives({ tenantId, productId, country }: { tenantId: string; productId: string; country: string | null }) {
  return (
    <section className="flex flex-col gap-3 rounded-shop bg-shop-sunken p-5" aria-labelledby="pd-want">
      <h2 id="pd-want" className="font-shop-body text-base font-semibold tracking-normal text-shop-ink">
        {t.title}
      </h2>
      <Suspense fallback={<p className="text-sm text-shop-ink-2">{t.next}</p>}>
        <SimilarCount tenantId={tenantId} productId={productId} country={country} />
      </Suspense>
      <AlertDialogButton source={{ productId }} label={t.alert} title={t.alertTitle} intro={t.alertIntro} variant="primary" fullWidth defaultFrequency="INSTANT" />
      <Suspense fallback={null}>
        <SimilarLink tenantId={tenantId} productId={productId} country={country} />
      </Suspense>
    </section>
  );
}

async function countForSale(tenantId: string, productId: string, country: string | null) {
  const { items } = await similarForSale(tenantId, productId, country);
  return items.filter((c) => c.status === "available").length;
}

async function SimilarCount({ tenantId, productId, country }: { tenantId: string; productId: string; country: string | null }) {
  const n = await countForSale(tenantId, productId, country);
  return <p className="text-sm text-shop-ink-2">{n ? `${t.similar(n)} · ${t.nextAfter}` : t.next}</p>;
}

async function SimilarLink({ tenantId, productId, country }: { tenantId: string; productId: string; country: string | null }) {
  const n = await countForSale(tenantId, productId, country);
  if (!n) return null;
  return (
    <a href="#pd-similar" className="text-center text-sm text-shop-ink underline decoration-shop-line-strong underline-offset-4 hover:decoration-shop-ink">
      {t.see(n)}
    </a>
  );
}
