import { permanentRedirect } from "next/navigation";
import { SHOP_PATH } from "@/server/storefront-catalog/urls";

/** /search?q=… is an alias: the catalog itself handles search (/shop?q=…). */
export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const sp = await searchParams;
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const value of Array.isArray(v) ? v : v === undefined ? [] : [v]) out.append(k, value);
  const qs = out.toString();
  permanentRedirect(`${SHOP_PATH}${qs ? `?${qs}` : ""}`);
}
