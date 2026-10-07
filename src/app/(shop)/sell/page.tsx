import type { Metadata } from "next";
import { Suspense } from "react";
import { leadsCopy } from "@/components/shop/leads/_copy";
import { SellForm } from "@/components/shop/leads/SellForm";
import { FormSkeleton } from "@/components/shop/account/FormSkeleton";
import { Container } from "@/components/shop/ui/Container";
import { createLeadDraft } from "@/server/leads";
import { getLegalLinks } from "@/server/storefront/content";
import { requireShop } from "@/server/storefront/context";

const t = leadsCopy;

export async function generateMetadata(): Promise<Metadata> {
  const shop = await requireShop();
  return { title: t.title, description: t.metaDescription, alternates: { canonical: `${shop.origin}/sell` } };
}

export default async function SellPage() {
  const shop = await requireShop();
  return (
    <Container className="py-10 sm:py-16">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <div>
          <p className="mb-1.5 text-xs font-semibold tracking-[0.14em] text-shop-muted uppercase">{t.eyebrow}</p>
          <h1 className="text-3xl text-shop-ink sm:text-4xl">{t.title}</h1>
          <p className="mt-4 text-shop-muted">{t.intro(shop.shopName)}</p>
          <ol className="mt-8 grid gap-5">
            {t.steps.map((s, i) => (
              <li key={s.title} className="flex gap-4">
                <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-shop-sunken font-semibold text-shop-ink">
                  {i + 1}
                </span>
                <div>
                  <h2 className="font-semibold text-shop-ink">{s.title}</h2>
                  <p className="text-sm text-shop-muted">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="rounded-shop border border-shop-line bg-shop-surface p-5 sm:p-8">
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
