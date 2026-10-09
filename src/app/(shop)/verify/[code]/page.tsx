import type { Metadata } from "next";
import { Container } from "@/components/shop/ui";
import { VerifyForm } from "@/components/shop/provenance/VerifyForm";
import { VerifyResult } from "@/components/shop/provenance/VerifyResult";
import { provenanceShopCopies } from "@/components/shop/provenance/_copy";
import { localeRedirect, shopCopy } from "@/server/i18n/locale";
import { normalizeCertificateCode } from "@/server/provenance/code";
import { verifyCertificateForVisitor } from "@/server/provenance/certificates";
import { requireShop } from "@/server/storefront/context";
import { requestClientIp } from "@/server/request-meta";

// Copy only (no certificate lookup here: that would run a second, rate-limited lookup).
export async function generateMetadata(): Promise<Metadata> {
  const t = (await shopCopy(provenanceShopCopies)).verify;
  return { title: t.title, robots: { index: false, follow: false } };
}

/**
 * /verify/[code] — public certificate verification (QR target). Shop-scoped: a code of another shop
 * is "not found". Rate limited per IP (VERIFY_RATE_LIMIT). Shows no personal data.
 */
export default async function VerifyCodePage({ params }: PageProps<"/verify/[code]">) {
  const shop = await requireShop();
  const t = (await shopCopy(provenanceShopCopies)).verify;
  const raw = (await params).code;
  const code = normalizeCertificateCode(raw);
  if (code && code !== raw) await localeRedirect(`/verify/${code}`);

  const ip = await requestClientIp();
  const result = code ? await verifyCertificateForVisitor(shop.tenant.id, code, ip) : ({ status: "unknown", code: null } as const);

  return (
    <Container size="narrow" className="py-14 sm:py-24">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-center text-[2.1rem] leading-[1.05] tracking-[-0.03em] text-shop-ink sm:text-[2.6rem]">{t.title}</h1>
        <div className="mt-10">
          <VerifyResult result={result} timeZone={shop.tenant.timezone} locale={shop.locale} />
        </div>
        <div className="mt-12 rounded-shop bg-shop-sunken p-5 sm:p-7">
          <h2 className="mb-4 font-shop-body text-base font-semibold tracking-normal text-shop-ink">{t.checkAnother}</h2>
          <VerifyForm locale={shop.locale} />
        </div>
      </div>
    </Container>
  );
}
