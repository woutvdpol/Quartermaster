import Link from "next/link";
import { Badge, Markdown } from "@/components/shop/ui";
import { getShopContext } from "@/server/storefront/context";
import { getShopViewer } from "@/server/storefront/viewer";
import { getPublicProvenance } from "@/server/provenance/public";
import { provenanceCopy } from "@/server/provenance/copy";
import { provenanceShopCopy } from "./_copy";

const t = provenanceShopCopy.block;

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Product page block (server component): provenance Markdown, public documents (served through the
 * access-checked /api/documents/[id]), "Certificate of authenticity included" badge (valid
 * certificate or lifetime guarantee) and the guarantee text. Renders nothing when there is nothing
 * to show, for non-public products, or for sensitive items viewed by guests (when the shop blurs them).
 * Tenant = the request's shop host. Data is cached per tenant ("catalog" tag, invalidated by every
 * provenance mutation).
 */
export async function ProvenanceBlock({ productId }: { productId: string }) {
  const shop = await getShopContext();
  if (!shop) return null;
  const data = await getPublicProvenance(shop.tenant.id, productId);
  if (!data) return null;
  if (data.blurred && shop.settings.legal.blurSensitiveForGuests && !(await getShopViewer(shop.tenant.id))) return null;

  const badge = data.certificateIncluded || data.authenticityGuaranteed;
  if (!data.provenance && !data.documents.length && !badge) return null;

  return (
    <section className="mt-10 max-w-3xl" aria-labelledby="pd-provenance">
      <h2 id="pd-provenance" className="mb-4 text-2xl text-shop-ink">
        {t.title}
      </h2>

      {badge ? (
        <div className="mb-5 grid grid-cols-[2.75rem_1fr] items-start gap-3 rounded-shop border border-shop-line-strong bg-shop-surface p-4">
          <span className="grid size-11 place-items-center rounded-shop-sm bg-shop-primary-soft text-shop-primary" aria-hidden="true">
            <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M10 2.5l6 2.5v4.5c0 3.8-2.6 6.6-6 8-3.4-1.4-6-4.2-6-8V5z" strokeLinejoin="round" />
              <path d="M7.5 10l2 2 3.5-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="grid gap-2 text-sm">
            <div className="flex flex-wrap gap-2">
              {data.certificateIncluded || data.authenticityGuaranteed ? <Badge tone="ok">{t.certificateIncluded}</Badge> : null}
              {data.authenticityGuaranteed ? <Badge tone="primary">{t.guaranteed}</Badge> : null}
            </div>
            {data.certificateIncluded ? <p className="text-shop-ink-2">{t.certificateIncludedBody}</p> : null}
            {data.authenticityGuaranteed ? <p className="text-shop-ink-2">{provenanceCopy.guaranteeText}</p> : null}
            <p>
              <Link href="/verify" className="text-shop-primary underline underline-offset-2 hover:no-underline">
                {t.verifyLink}
              </Link>
            </p>
          </div>
        </div>
      ) : null}

      {data.provenance ? <Markdown source={data.provenance} /> : null}

      {data.documents.length ? (
        <div className="mt-6">
          <h3 className="mb-2 font-shop-body text-base font-semibold text-shop-ink">{t.documents}</h3>
          <ul className="divide-y divide-shop-line rounded-shop border border-shop-line bg-shop-surface" role="list">
            {data.documents.map((d) => (
              <li key={d.id}>
                <a href={d.url} target="_blank" rel="noopener" className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-shop-sunken">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-shop-ink">{d.title}</span>
                    <span className="text-xs text-shop-muted">{t.kinds[d.kind]}</span>
                  </span>
                  <span className="shrink-0 font-mono text-xs text-shop-muted">
                    {d.mimeType === "application/pdf" ? "PDF" : d.mimeType.replace("image/", "").toUpperCase()} · {formatBytes(d.byteSize)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
