import type { Metadata } from "next";
import { JsonLd } from "@/components/shop/ui/JsonLd";
import { getNetworkDirectory } from "@/server/network/service";
import { requireNetworkRequest } from "@/server/network/request";
import { networkHref, platformApplyUrl } from "@/lib/network";
import { NetworkShell } from "../_components/NetworkShell";
import { DealerList } from "../_components/DealerList";
import { networkCopy } from "../_copy";

const t = networkCopy.dealers;

/** /network/dealers (or /dealers on NETWORK_HOST): every shop in the network, with a link to its own shop. */

export async function generateMetadata(): Promise<Metadata> {
  const req = await requireNetworkRequest("/dealers");
  const url = `${req.origin}${networkHref(req.base, "/dealers")}`;
  const title = `${t.title} · ${networkCopy.brand} ${networkCopy.brandTag}`;
  return {
    title: { absolute: title },
    description: t.metaDescription,
    alternates: { canonical: url },
    openGraph: { type: "website", siteName: networkCopy.brand, title, description: t.metaDescription, url },
  };
}

export default async function NetworkDealersPage() {
  const req = await requireNetworkRequest("/dealers");
  const dir = await getNetworkDirectory();
  const list = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: t.title,
    itemListElement: dir.dealers.map((d, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: { "@type": "Organization", name: d.name, url: d.shopUrl, ...(d.logoPath ? { logo: `${req.origin}${d.logoPath}` } : {}) },
    })),
  };
  return (
    <NetworkShell base={req.base} applyUrl={platformApplyUrl(req.base)}>
      <JsonLd data={list} />
      <div className="bg-[#2A2F22] text-[#ECECE5]">
        <div className="mx-auto max-w-[1240px] px-4 pt-6 pb-10 sm:px-6">
          <h1 className="text-[40px] leading-none font-bold sm:text-[52px] [font-family:var(--nw-display)]">{t.title}</h1>
          <p className="mt-3 max-w-[680px] text-[#C9CBBC]">{networkCopy.trust}</p>
        </div>
      </div>
      <main id="main" className="mx-auto max-w-[1240px] px-4 pt-7 pb-16 sm:px-6">
        {dir.dealers.length ? (
          <DealerList dealers={dir.dealers} base={req.base} />
        ) : (
          <p className="rounded-xl border border-dashed border-[#DEDCCF] p-8 text-center text-[#4A4D40]">{networkCopy.empty}</p>
        )}
      </main>
    </NetworkShell>
  );
}
