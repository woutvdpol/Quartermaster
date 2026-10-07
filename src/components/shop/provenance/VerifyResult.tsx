import { cn } from "@/components/shop/ui";
import type { VerifyResult as Result } from "@/server/provenance/certificates";
import { provenanceShopCopy } from "./_copy";

const t = provenanceShopCopy.verify;

function formatDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone }).format(new Date(iso));
}

/** Outcome of a certificate lookup: valid / revoked / unknown / rate limited. No personal data. */
export function VerifyResult({ result, timeZone }: { result: Result; timeZone: string }) {
  if (result.status === "rate_limited" || result.status === "unknown") {
    const s = result.status === "unknown" ? t.unknown : t.rateLimited;
    return (
      <div role="status" className="rounded-shop border border-shop-warn/30 bg-shop-warn-soft p-4">
        <h2 className="font-shop-body text-lg font-semibold text-shop-warn">{s.title}</h2>
        <p className="mt-1 text-sm text-shop-ink-2">{s.body}</p>
        {result.status === "unknown" && result.code ? <p className="mt-2 font-mono text-sm text-shop-ink">{result.code}</p> : null}
      </div>
    );
  }

  const c = result.certificate;
  const valid = result.status === "valid";
  const s = valid ? t.valid : t.revoked;
  return (
    <article className="overflow-hidden rounded-shop border border-shop-line bg-shop-surface">
      <div role="status" className={cn("flex items-start gap-3 p-4", valid ? "bg-shop-ok-soft" : "bg-shop-crit-soft")}>
        <span aria-hidden="true" className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full", valid ? "bg-shop-ok text-shop-bg" : "bg-shop-crit text-shop-bg")}>
          <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {valid ? <path d="M5 10.5l3.2 3L15 6.5" /> : <path d="M6 6l8 8M14 6l-8 8" />}
          </svg>
        </span>
        <div>
          <h2 className={cn("font-shop-body text-lg font-semibold", valid ? "text-shop-ok" : "text-shop-crit")}>{s.title}</h2>
          <p className="text-sm text-shop-ink-2">{s.body(c.shopName)}</p>
        </div>
      </div>

      <div className="grid gap-5 p-4 sm:grid-cols-[minmax(0,14rem)_1fr]">
        {c.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- stored JPEG served by /uploads
          <img src={c.photoUrl} alt={t.photoAlt(c.title)} className="w-full rounded-shop-sm border border-shop-line object-contain" loading="lazy" />
        ) : null}
        <div className={cn("min-w-0", !c.photoUrl && "sm:col-span-2")}>
          <h3 className="text-xl text-shop-ink">{c.title}</h3>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-shop-muted">{t.code}</dt>
            <dd className="font-mono text-shop-ink">{c.code}</dd>
            <dt className="text-shop-muted">{t.stockCode}</dt>
            <dd className="font-mono text-shop-ink">#{c.stockCode}</dd>
            <dt className="text-shop-muted">{t.issuedBy}</dt>
            <dd className="text-shop-ink">{c.shopName}</dd>
            <dt className="text-shop-muted">{t.issuedOn}</dt>
            <dd className="text-shop-ink">{formatDate(c.issuedAt, timeZone)}</dd>
            {c.revokedAt ? (
              <>
                <dt className="text-shop-muted">{t.revokedOn}</dt>
                <dd className="text-shop-crit">{formatDate(c.revokedAt, timeZone)}</dd>
              </>
            ) : null}
            {c.specifications.map((r, i) => (
              <div key={`${i}-${r.label}`} className="contents">
                <dt className="text-shop-muted">{r.label}</dt>
                <dd className="text-shop-ink">{r.value}</dd>
              </div>
            ))}
          </dl>
          {valid && c.authenticityGuaranteed ? <p className="mt-4 text-sm font-medium text-shop-ink">{t.guaranteed}</p> : null}
        </div>
      </div>
    </article>
  );
}
