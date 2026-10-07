import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Alert, SubmitButton } from "@/components/shop/account/form";
import { Container } from "@/components/shop/ui/Container";
import { Skeleton } from "@/components/shop/ui/Skeleton";
import { manageViewSigned } from "@/server/alerts";
import { getRequestTenant } from "@/server/tenant";
import { alertPagesCopy as t } from "../_copy";
import { stopManagedAlertAction } from "./actions";

export const metadata: Metadata = { title: t.manageTitle, robots: { index: false, follow: false }, referrer: "no-referrer" };

/** All alerts of one address, reached through the signed "Manage all alerts" link in alert mails. */
export default function ManageAlertsPage({ searchParams }: PageProps<"/alerts/manage">) {
  return (
    <Container size="narrow" className="py-10 sm:py-16">
      <h1 className="text-3xl text-shop-ink sm:text-4xl">{t.manageTitle}</h1>
      <Suspense fallback={<Skeleton className="mt-6 h-40 w-full" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/alerts/manage">["searchParams"] }) {
  const q = await searchParams;
  const link = { t: typeof q.t === "string" ? q.t : "", s: typeof q.s === "string" ? q.s : "", sig: typeof q.sig === "string" ? q.sig : "" };
  const tenant = await getRequestTenant();
  const view = tenant && tenant.id === link.t ? await manageViewSigned({ tenantId: link.t, savedSearchId: link.s, sig: link.sig }) : null;
  if (!view) {
    return (
      <div className="mt-6">
        <Alert tone="error">{t.status.invalid.body}</Alert>
      </div>
    );
  }
  const hidden = (
    <>
      <input type="hidden" name="t" value={link.t} />
      <input type="hidden" name="s" value={link.s} />
      <input type="hidden" name="sig" value={link.sig} />
    </>
  );
  return (
    <div className="mt-6 grid gap-4">
      {view.email ? <p className="text-shop-muted">{t.manageIntro(view.email)}</p> : null}
      {view.searches.length === 0 ? (
        <Alert tone="info">{t.manageEmpty}</Alert>
      ) : (
        <>
          <ul className="grid gap-3">
            {view.searches.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-shop border border-shop-line bg-shop-surface p-4">
                <div className="min-w-0">
                  <p className="font-medium text-shop-ink">{s.name}</p>
                  <p className="text-sm text-shop-muted">
                    {t.frequency[s.frequency]} ·{" "}
                    <Link href={s.description.href} className="text-shop-primary underline underline-offset-4">
                      {t.view}
                    </Link>
                  </p>
                </div>
                <form action={stopManagedAlertAction}>
                  {hidden}
                  <input type="hidden" name="target" value={s.id} />
                  <SubmitButton variant="outline">{t.stop}</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
          <form action={stopManagedAlertAction} className="justify-self-start">
            {hidden}
            <SubmitButton variant="outline">{t.stopAll}</SubmitButton>
          </form>
        </>
      )}
    </div>
  );
}
