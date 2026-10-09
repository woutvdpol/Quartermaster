import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthPanel } from "@/components/shop/account/AuthPanel";
import { Alert, SubmitButton } from "@/components/shop/account/form";
import { FormSkeleton } from "@/components/shop/account/FormSkeleton";
import { db } from "@/server/db";
import { verifyAlertLink, verifyWishlistLink } from "@/server/alerts";
import { getRequestTenant } from "@/server/tenant";
import { shopCopy } from "@/server/i18n/locale";
import { alertPagesCopies } from "../_copy";
import { readUnsubscribeTarget, type UnsubscribeTarget } from "../_links";
import { unsubscribeAlertAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await shopCopy(alertPagesCopies);
  return { title: t.unsubscribeTitle, robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/** Unsubscribe link from alert mails. GET shows a confirmation button; only the POST stops anything. */
export default async function AlertUnsubscribePage({ searchParams }: PageProps<"/alerts/unsubscribe">) {
  const t = await shopCopy(alertPagesCopies);
  return (
    <AuthPanel title={t.unsubscribeTitle}>
      <Suspense fallback={<FormSkeleton fields={0} />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </AuthPanel>
  );
}

/** Small read for the question text (title only; the signature is verified first). */
async function describeTarget(target: UnsubscribeTarget): Promise<string | null> {
  const t = await shopCopy(alertPagesCopies);
  if (target.kind === "search") {
    if (!verifyAlertLink("unsubscribe", target.tenantId, target.savedSearchId, target.sig)) return null;
    const s = await db.savedSearch.findFirst({ where: { id: target.savedSearchId, tenantId: target.tenantId }, select: { name: true } });
    return s ? t.unsubscribeSearch(s.name) : t.unsubscribeSearchGone;
  }
  if (!verifyWishlistLink(target.tenantId, target.customerId, target.productId, target.sig)) return null;
  const p = await db.product.findFirst({ where: { id: target.productId, tenantId: target.tenantId }, select: { title: true } });
  return t.unsubscribeWishlist(p?.title ?? t.thisItem);
}

async function Content({ searchParams }: { searchParams: PageProps<"/alerts/unsubscribe">["searchParams"] }) {
  const q = await searchParams;
  const t = await shopCopy(alertPagesCopies);
  const target = readUnsubscribeTarget(q);
  const tenant = await getRequestTenant();
  const question = target && (!tenant || tenant.id === target.tenantId) ? await describeTarget(target) : null;
  if (!target || !question) return <Alert tone="error">{t.status.invalid.body}</Alert>;
  return (
    <form action={unsubscribeAlertAction} className="grid gap-4">
      <p className="text-shop-ink-2">{question}</p>
      {Object.entries(q).flatMap(([k, v]) =>
        ["t", "s", "c", "p", "sig"].includes(k) && typeof v === "string" ? [<input key={k} type="hidden" name={k} value={v.slice(0, 128)} />] : [],
      )}
      <SubmitButton pendingLabel={t.unsubscribing} fullWidth>
        {t.unsubscribeButton}
      </SubmitButton>
    </form>
  );
}
