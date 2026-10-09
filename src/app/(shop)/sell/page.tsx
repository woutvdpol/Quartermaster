import type { Metadata } from "next";
import { Suspense } from "react";
import { leadsCopies } from "@/components/shop/leads/_copy";
import { localizedUrl } from "@/lib/i18n/shop-locales";
import { pickCopy } from "@/lib/i18n/shop-copy";
import { SellForm } from "@/components/shop/leads/SellForm";
import { FormSkeleton } from "@/components/shop/account/FormSkeleton";
import { Container } from "@/components/shop/ui/Container";
import { createLeadDraft } from "@/server/leads";
import { getLegalLinks } from "@/server/storefront/content";
import { requireShop } from "@/server/storefront/context";

export async function generateMetadata(): Promise<Metadata> {
  const shop = await requireShop();
  const t = pickCopy(leadsCopies, shop.locale);
  return { title: t.title, description: t.metaDescription, alternates: { canonical: localizedUrl(shop.origin, "/sell", shop.locale) } };
}

export default async function SellPage() {
  const shop = await requireShop();
  const t = pickCopy(leadsCopies, shop.locale);
  return (
    <Container className="py-10 sm:py-16">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <p className="mb-3 text-sm font-semibold text-shop-primary">{t.eyebrow}</p>
          <h1 className="text-[2.25rem] leading-[1.05] tracking-tight text-shop-ink sm:text-5xl">{t.title}</h1>
          <p className="mt-5 text-lg text-shop-ink-2">{t.intro(shop.shopName)}</p>
          <ol className="mt-10 grid border-t border-shop-line">
            {t.steps.map((s, i) => (
              <li key={s.title} className="flex gap-5 border-b border-shop-line py-5">
                <span aria-hidden="true" className="w-6 shrink-0 pt-0.5 font-shop-mono text-sm text-shop-accent">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h2 className="font-shop-body text-base font-semibold tracking-normal text-shop-ink">{s.title}</h2>
                  <p className="mt-1 text-sm text-shop-ink-2">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="rounded-shop border border-shop-line bg-shop-surface p-5 sm:p-9">
          <Suspense fallback={<FormSkeleton fields={5} />}>
            <SellFormLoader tenantId={shop.tenant.id} shopName={shop.shopName} />
          </Suspense>
        </div>
      </div>
    </Container>
  );
}

async function SellFormLoader({ tenantId, shopName }: { tenantId: string; shopName: string }) {
  const legal = await getLegalLinks(tenantId);
  const privacy = legal.find((l) => l.key === "PRIVACY")?.href ?? null;
  return <SellForm draft={createLeadDraft(tenantId)} shopName={shopName} privacyHref={privacy} />;
}
