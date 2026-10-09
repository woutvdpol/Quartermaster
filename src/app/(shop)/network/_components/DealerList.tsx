import Link from "next/link";
import { countryName } from "@/server/shipping/countries";
import type { NetworkDealer } from "@/server/network/service";
import { networkHref } from "@/lib/network";
import { networkQueryString } from "@/server/network/params";
import { networkCopy } from "../_copy";

const t = networkCopy.dealers;

/** Dealers in the network: logo, name, country, piece count, links to their shop and to their pieces here. */
export function DealerList({ dealers, base, headingLevel = 2 }: { dealers: NetworkDealer[]; base: string; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {dealers.map((d) => (
        <li key={d.id} className="flex items-center gap-3.5 rounded-xl border border-[#DEDCCF] bg-white p-3.5">
          <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-[#ECECE5]">
            {d.logoPath ? (
              // eslint-disable-next-line @next/next/no-img-element -- stored logo (served by /uploads on this host too)
              <img src={d.logoPath} alt="" width={56} height={56} loading="lazy" decoding="async" className="size-full object-contain" />
            ) : (
              <span aria-hidden="true" className="text-xl font-bold [font-family:var(--nw-display)]">
                {d.name.slice(0, 1).toUpperCase()}
              </span>
            )}
          </span>
          <span className="grid min-w-0 gap-0.5">
            <Heading className="truncate font-semibold">{d.name}</Heading>
            <span className="text-[13px] text-[#6B6E60]">
              {[d.country ? countryName(d.country) : null, t.pieces(d.productCount)].filter(Boolean).join(" · ")}
            </span>
            <span className="flex flex-wrap gap-x-3 text-[13px]">
              <Link href={`${networkHref(base)}${networkQueryString({ dealers: [d.slug] })}`} className="text-[#7E5416] underline-offset-2 hover:underline">
                {t.search(d.name)}
              </Link>
              <a href={d.shopUrl} className="text-[#7E5416] underline-offset-2 hover:underline">
                {t.visit}
              </a>
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
