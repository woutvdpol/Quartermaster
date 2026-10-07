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
    <Container size="narrow" className="py-14 sm:py-24">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-center text-[2.1rem] leading-[1.05] tracking-[-0.03em] text-shop-ink sm:text-[2.6rem]">{t.title}</h1>
        <div className="mt-10">
          <VerifyResult result={result} timeZone={shop.tenant.timezone} />
        </div>
        <div className="mt-12 rounded-shop bg-shop-sunken p-5 sm:p-7">
          <h2 className="mb-4 font-shop-body text-base font-semibold tracking-normal text-shop-ink">{t.checkAnother}</h2>
          <VerifyForm />
        </div>
      </div>
    </Container>
  );
}
