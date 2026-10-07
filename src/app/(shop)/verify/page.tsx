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
    <Container size="narrow" className="py-14 sm:py-24">
      <div className="mx-auto max-w-xl">
        <header className="text-center">
          <h1 className="text-[2.1rem] leading-[1.05] tracking-[-0.03em] text-shop-ink sm:text-[2.6rem]">{t.title}</h1>
          <p className="mx-auto mt-4 max-w-md text-[1.05rem] text-shop-muted">{t.intro}</p>
        </header>
        <div className="mt-10 rounded-shop bg-shop-sunken p-5 sm:p-7">
          <VerifyForm defaultValue={input.slice(0, 32)} error={input ? t.invalidCode : null} />
        </div>
      </div>
    </Container>
  );
}
