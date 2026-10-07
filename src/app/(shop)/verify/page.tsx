import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Container } from "@/components/shop/ui";
import { VerifyForm } from "@/components/shop/provenance/VerifyForm";
import { provenanceShopCopy } from "@/components/shop/provenance/_copy";
import { normalizeCertificateCode } from "@/server/provenance/code";
import { requireShop } from "@/server/storefront/context";

const t = provenanceShopCopy.verify;

export const metadata: Metadata = { title: t.title, robots: { index: false, follow: false } };

/** /verify — code entry (GET form). A valid-looking ?code= redirects to the canonical /verify/[code]. */
export default async function VerifyPage({ searchParams }: PageProps<"/verify">) {
  await requireShop();
  const raw = (await searchParams).code;
  const input = typeof raw === "string" ? raw.trim() : "";
  if (input) {
    const code = normalizeCertificateCode(input);
    if (code) redirect(`/verify/${code}`);
  }
  return (
    <Container size="narrow" className="py-10 sm:py-16">
      <h1 className="text-3xl text-shop-ink sm:text-4xl">{t.title}</h1>
      <p className="mt-3 text-shop-ink-2">{t.intro}</p>
      <div className="mt-8">
        <VerifyForm defaultValue={input.slice(0, 32)} error={input ? t.invalidCode : null} />
      </div>
    </Container>
  );
}
