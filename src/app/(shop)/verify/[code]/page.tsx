import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Container } from "@/components/shop/ui";
import { VerifyForm } from "@/components/shop/provenance/VerifyForm";
import { VerifyResult } from "@/components/shop/provenance/VerifyResult";
import { provenanceShopCopy } from "@/components/shop/provenance/_copy";
import { normalizeCertificateCode } from "@/server/provenance/code";
import { verifyCertificateForVisitor } from "@/server/provenance/certificates";
import { requireShop } from "@/server/storefront/context";

const t = provenanceShopCopy.verify;

// Static metadata on purpose: generateMetadata would run a second (rate-limited) lookup.
export const metadata: Metadata = { title: t.title, robots: { index: false, follow: false } };

/**
 * /verify/[code] — public certificate verification (QR target). Shop-scoped: a code of another shop
 * is "not found". Rate limited per IP (VERIFY_RATE_LIMIT). Shows no personal data.
 */
export default async function VerifyCodePage({ params }: PageProps<"/verify/[code]">) {
  const shop = await requireShop();
  const raw = (await params).code;
  const code = normalizeCertificateCode(raw);
  if (code && code !== raw) redirect(`/verify/${code}`);

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || null;
  const result = code ? await verifyCertificateForVisitor(shop.tenant.id, code, ip) : ({ status: "unknown", code: null } as const);

  return (
    <Container size="narrow" className="py-10 sm:py-16">
      <h1 className="text-3xl text-shop-ink sm:text-4xl">{t.title}</h1>
      <div className="mt-6">
        <VerifyResult result={result} timeZone={shop.tenant.timezone} />
      </div>
      <div className="mt-10 border-t border-shop-line pt-6">
        <h2 className="mb-3 font-shop-body text-base font-semibold text-shop-ink">{t.checkAnother}</h2>
        <VerifyForm />
      </div>
    </Container>
  );
}
