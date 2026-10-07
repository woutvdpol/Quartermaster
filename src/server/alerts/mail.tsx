import "server-only";
import type { z } from "zod";
import { db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import { decrypt } from "@/server/auth/encryption";
import { hashToken } from "@/server/auth/tokens";
import { imageUrl } from "@/server/media/product-images";
import { productHref } from "@/server/storefront-catalog/urls";
import type { BuiltMail } from "@/server/mail/builders";
import type { MailIdentity } from "@/server/mail/identity";
import { withQuery } from "@/server/mail/urls";
import SavedSearchConfirm, { savedSearchConfirmSubject } from "@/emails/SavedSearchConfirm";
import NewArrivalsDigest, { newArrivalsSubject } from "@/emails/NewArrivalsDigest";
import BackAvailable, { backAvailableSubject } from "@/emails/BackAvailable";
import PriceDrop, { priceDropSubject } from "@/emails/PriceDrop";
import type { AlertMailProduct } from "@/emails/AlertProduct";
import { ALERT_MAIL_PROPS } from "./mail-contracts";
import { ALERT_PATHS } from "./paths";
import { describeQuery } from "./query";
import { CONFIRM_TTL_DAYS, savedSearchStatus } from "./saved-searches";
import { searchLinkQuery, wishlistLinkQuery } from "./signing";

/*
 * Builders for the alert mail templates (spread into MAIL_BUILDERS, src/server/mail/builders.tsx).
 * Worker-only (renders React Email). Every builder re-checks the data at send time and returns null
 * (= skip) when the mail no longer makes sense: search stopped, item sold / reserved again, price
 * raised again, item removed from the wishlist.
 */

type Props = typeof ALERT_MAIL_PROPS;
type Input<T extends keyof Props> = { tenantId: string | null; to?: string; props: z.output<Props[T]>; identity: MailIdentity };

const MAX_LISTED = 24;

/** RFC 2369 + RFC 8058 one-click headers (same as the newsletter's; local to avoid an import cycle with builders.tsx). */
function listUnsubscribeHeaders(url: string): Record<string, string> {
  return { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

function tenantOf(tenantId: string | null, template: string): string {
  if (!tenantId) throw new Error(`${template}: tenantId is required`);
  return tenantId;
}

const productSelect = {
  id: true,
  title: true,
  slug: true,
  stockCode: true,
  price: true,
  blurred: true,
  status: true,
  quantity: true,
  category: { select: { title: true } },
  images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: 1, select: { storageKey: true, processedAt: true } },
} satisfies Prisma.ProductSelect;

type ProductRow = {
  title: string;
  slug: string;
  stockCode: number;
  price: number;
  blurred: boolean;
  category: { title: string } | null;
  images: { storageKey: string; processedAt: Date | null }[];
};

function toMailProduct(p: ProductRow, baseUrl: string, currency: string): AlertMailProduct {
  const img = p.images[0];
  return {
    title: p.title,
    stockCode: p.stockCode,
    url: `${baseUrl}${productHref(p)}`,
    // Sensitive (blurred) items never show their picture in a mail.
    imageUrl: img && !p.blurred ? `${baseUrl}${imageUrl(img.storageKey, img.processedAt ? "card" : "original")}` : null,
    price: p.price,
    currency,
    category: p.category?.title ?? null,
  };
}

async function currencyOf(tenantId: string): Promise<string> {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } });
  return t?.currency ?? "EUR";
}

export async function buildAlertConfirm({ tenantId, props, identity }: Input<"alert-confirm">): Promise<BuiltMail | null> {
  const tid = tenantOf(tenantId, "alert-confirm");
  const s = await db.savedSearch.findFirst({ where: { id: props.savedSearchId, tenantId: tid } });
  const token = decrypt(props.tokenEnc);
  if (!s || savedSearchStatus(s) !== "pending" || s.confirmTokenHash !== hashToken(token)) return null;
  const confirmUrl = withQuery(identity.brand.baseUrl, ALERT_PATHS.confirm, { token });
  return {
    to: s.email,
    subject: savedSearchConfirmSubject(identity.brand),
    react: <SavedSearchConfirm brand={identity.brand} searchName={s.name} confirmUrl={confirmUrl} expiresInDays={CONFIRM_TTL_DAYS} />,
  };
}

export async function buildNewArrivals({ tenantId, props, identity }: Input<"alert-new-arrivals">): Promise<BuiltMail | null> {
  const tid = tenantOf(tenantId, "alert-new-arrivals");
  const s = await db.savedSearch.findFirst({ where: { id: props.savedSearchId, tenantId: tid } });
  if (!s || savedSearchStatus(s) !== "active") return null;
  const now = new Date();
  const deliveries = await db.alertDelivery.findMany({
    where: {
      id: { in: props.deliveryIds },
      tenantId: tid,
      savedSearchId: s.id,
      // Still for sale and not in someone's basket right now.
      product: { status: "ACTIVE", quantity: { gt: 0 }, reservations: { none: { status: "ACTIVE", expiresAt: { gt: now } } } },
    },
    orderBy: { createdAt: "desc" },
    select: { product: { select: productSelect } },
  });
  if (!deliveries.length) return null;
  const currency = await currencyOf(tid);
  const base = identity.brand.baseUrl;
  const products = deliveries.slice(0, MAX_LISTED).map((d) => toMailProduct(d.product, base, currency));
  const moreCount = deliveries.length - products.length;
  const description = await describeQuery(tid, s.query);
  const unsubscribeUrl = withQuery(base, ALERT_PATHS.unsubscribe, searchLinkQuery("unsubscribe", tid, s.id));
  const oneClickUrl = withQuery(base, ALERT_PATHS.oneClick, searchLinkQuery("unsubscribe", tid, s.id));
  const manageUrl = withQuery(base, ALERT_PATHS.manage, searchLinkQuery("manage", tid, s.id));
  return {
    to: s.email,
    subject: newArrivalsSubject(identity.brand, s.name, products, moreCount),
    headers: listUnsubscribeHeaders(oneClickUrl),
    react: (
      <NewArrivalsDigest
        brand={identity.brand}
        searchName={s.name}
        frequency={s.frequency}
        products={products}
        moreCount={moreCount}
        searchUrl={`${base}${description.href}`}
        unsubscribeUrl={unsubscribeUrl}
        manageUrl={manageUrl}
      />
    ),
  };
}

async function wishlistTarget(tenantId: string, customerId: string, productId: string) {
  const [customer, item] = await Promise.all([
    db.customer.findFirst({ where: { id: customerId, tenantId }, select: { email: true } }),
    db.wishlistItem.findFirst({ where: { tenantId, customerId, productId }, select: { product: { select: productSelect } } }),
  ]);
  if (!customer || !item || item.product.status !== "ACTIVE" || item.product.quantity <= 0) return null;
  return { email: customer.email, product: item.product };
}

function wishlistLinks(base: string, tenantId: string, customerId: string, productId: string) {
  const q = wishlistLinkQuery(tenantId, customerId, productId);
  return {
    stopUrl: withQuery(base, ALERT_PATHS.unsubscribe, q),
    oneClickUrl: withQuery(base, ALERT_PATHS.oneClick, q),
    wishlistUrl: `${base}${ALERT_PATHS.wishlist}`,
  };
}

export async function buildBackAvailable({ tenantId, props, identity }: Input<"alert-back-available">): Promise<BuiltMail | null> {
  const tid = tenantOf(tenantId, "alert-back-available");
  const target = await wishlistTarget(tid, props.customerId, props.productId);
  if (!target) return null;
  const held = await db.reservation.findFirst({
    where: { tenantId: tid, productId: props.productId, status: "ACTIVE", expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  if (held) return null; // taken again before we got to send
  const base = identity.brand.baseUrl;
  const product = toMailProduct(target.product, base, await currencyOf(tid));
  const links = wishlistLinks(base, tid, props.customerId, props.productId);
  return {
    to: target.email,
    subject: backAvailableSubject(product),
    headers: listUnsubscribeHeaders(links.oneClickUrl),
    react: <BackAvailable brand={identity.brand} product={product} stopUrl={links.stopUrl} wishlistUrl={links.wishlistUrl} />,
  };
}

export async function buildPriceDrop({ tenantId, props, identity }: Input<"alert-price-drop">): Promise<BuiltMail | null> {
  const tid = tenantOf(tenantId, "alert-price-drop");
  const target = await wishlistTarget(tid, props.customerId, props.productId);
  if (!target || target.product.price >= props.oldPrice) return null;
  const base = identity.brand.baseUrl;
  const product = { ...toMailProduct(target.product, base, await currencyOf(tid)), oldPrice: props.oldPrice };
  const links = wishlistLinks(base, tid, props.customerId, props.productId);
  return {
    to: target.email,
    subject: priceDropSubject(product),
    headers: listUnsubscribeHeaders(links.oneClickUrl),
    react: <PriceDrop brand={identity.brand} product={product} stopUrl={links.stopUrl} wishlistUrl={links.wishlistUrl} />,
  };
}

/** Spread into MAIL_BUILDERS. */
export const ALERT_MAIL_BUILDERS = {
  "alert-confirm": buildAlertConfirm,
  "alert-new-arrivals": buildNewArrivals,
  "alert-back-available": buildBackAvailable,
  "alert-price-drop": buildPriceDrop,
};
