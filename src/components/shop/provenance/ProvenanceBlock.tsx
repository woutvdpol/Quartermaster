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
    <section className="rounded-shop bg-shop-sunken p-6 sm:p-8" aria-labelledby="pd-provenance">
      <h2 id="pd-provenance" className="mb-5 text-xl text-shop-ink sm:text-2xl">
        {t.title}
      </h2>

      {badge ? (
        <div className="mb-6 flex items-start gap-4 rounded-shop bg-shop-surface p-4 sm:p-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-shop-control bg-shop-primary-soft text-shop-primary" aria-hidden="true">
            <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M10 2.5l6 2.5v4.5c0 3.8-2.6 6.6-6 8-3.4-1.4-6-4.2-6-8V5z" strokeLinejoin="round" />
              <path d="M7.5 10l2 2 3.5-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="grid min-w-0 gap-2 text-sm">
            <div className="flex flex-wrap gap-1.5">
              {data.certificateIncluded || data.authenticityGuaranteed ? <Badge tone="ok">{t.certificateIncluded}</Badge> : null}
              {data.authenticityGuaranteed ? <Badge tone="primary">{t.guaranteed}</Badge> : null}
            </div>
            {data.certificateIncluded ? <p className="text-shop-ink-2">{t.certificateIncludedBody}</p> : null}
            {data.authenticityGuaranteed ? <p className="text-shop-ink-2">{provenanceCopy.guaranteeText}</p> : null}
            <p>
              <Link href="/verify" className="font-medium text-shop-ink underline decoration-shop-line-strong underline-offset-4 hover:decoration-shop-ink">
                {t.verifyLink} <span aria-hidden="true">→</span>
              </Link>
            </p>
          </div>
        </div>
      ) : null}

      {data.provenance ? <Markdown source={data.provenance} /> : null}

      {data.documents.length ? (
        <div className="mt-6">
          <h3 className="mb-3 font-shop-body text-sm font-semibold tracking-normal text-shop-ink">{t.documents}</h3>
          <ul className="divide-y divide-shop-line overflow-hidden rounded-shop bg-shop-surface" role="list">
            {data.documents.map((d) => (
              <li key={d.id}>
                <a href={d.url} target="_blank" rel="noopener" className="group flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-shop-ink underline-offset-4 group-hover:underline">{d.title}</span>
                    <span className="text-xs text-shop-muted">{t.kinds[d.kind]}</span>
                  </span>
                  <span className="shrink-0 font-shop-mono text-xs text-shop-muted">
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
