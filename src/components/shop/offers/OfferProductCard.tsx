import Link from "next/link";
import type { ReactNode } from "react";
import { uiCopy } from "@/components/shop/ui/_copy";

/** Product block shared by the offer pages. */
export function OfferProductCard({
  product,
  showImage,
  children,
}: {
  product: { title: string; href: string; stockCode: number; imageUrl: string | null; imageAlt: string };
  showImage: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-6 rounded-shop border border-shop-line bg-shop-surface p-5 sm:grid-cols-[200px_1fr] sm:gap-8 sm:p-7">
      <div className="relative aspect-[4/5] overflow-hidden rounded-shop bg-shop-sunken sm:aspect-square">
        {showImage && product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- pre-generated card variant
          <img src={product.imageUrl} alt={product.imageAlt} className="absolute inset-0 h-full w-full object-cover" />
        ) : null}
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <p className="font-shop-mono text-xs text-shop-accent">
            {uiCopy.product.stockCode} {product.stockCode}
          </p>
          <Link href={product.href} className="font-shop-heading text-2xl leading-tight font-semibold tracking-[-0.02em] text-shop-ink underline-offset-4 hover:underline">
            {product.title}
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}

export function formatShopDate(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone }).format(d);
}
