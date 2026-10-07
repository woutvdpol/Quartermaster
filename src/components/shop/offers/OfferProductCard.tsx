import Link from "next/link";
import type { ReactNode } from "react";

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
    <div className="grid gap-6 rounded-shop border border-shop-line bg-shop-surface p-5 shadow-shop sm:grid-cols-[200px_1fr] sm:p-6">
      <div className="relative aspect-square overflow-hidden rounded-shop-sm bg-shop-sunken">
        {showImage && product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- pre-generated card variant
          <img src={product.imageUrl} alt={product.imageAlt} className="absolute inset-0 h-full w-full object-cover" />
        ) : null}
      </div>
      <div className="flex flex-col gap-4">
        <div>
          <Link href={product.href} className="font-shop-heading text-2xl text-shop-ink hover:underline">
            {product.title}
          </Link>
          <p className="text-sm text-shop-muted">#{product.stockCode}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

export function formatShopDate(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone }).format(d);
}
