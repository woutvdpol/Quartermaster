import type { Metadata } from "next";
import { Suspense } from "react";
import { Alert } from "@/components/shop/account/form";
import { ButtonLink } from "@/components/shop/ui/Button";
import { Container } from "@/components/shop/ui/Container";
import { Skeleton } from "@/components/shop/ui/Skeleton";
import { shopCopy } from "@/server/i18n/locale";
import { alertPagesCopies, alertPagesCopy } from "./_copy";

export async function generateMetadata(): Promise<Metadata> {
  const t = await shopCopy(alertPagesCopies);
  return { title: t.statusTitle, robots: { index: false, follow: true } };
}

type StatusKey = keyof typeof alertPagesCopy.status;

/** Outcome page of confirm / unsubscribe links: `/alerts?status=confirmed|unsubscribed|expired|invalid`. */
export default async function AlertsStatusPage({ searchParams }: PageProps<"/alerts">) {
  const t = await shopCopy(alertPagesCopies);
  return (
    <Container size="narrow" className="py-12 sm:py-20">
      <div className="mx-auto max-w-md text-center">
        <Suspense fallback={<Skeleton className="mx-auto h-24 w-full" />}>
          <Status searchParams={searchParams} />
        </Suspense>
        <ButtonLink href="/" variant="outline" className="mt-8">
          {t.backHome}
        </ButtonLink>
      </div>
    </Container>
  );
}

async function Status({ searchParams }: { searchParams: PageProps<"/alerts">["searchParams"] }) {
  const raw = (await searchParams).status;
  const t = await shopCopy(alertPagesCopies);
  const key: StatusKey = typeof raw === "string" && raw in t.status ? (raw as StatusKey) : "unknown";
  const s = t.status[key];
  return (
    <>
      <h1 className="text-[2.1rem] leading-[1.05] tracking-[-0.03em] text-shop-ink sm:text-[2.6rem]">{s.title}</h1>
      <div className="mt-5 text-left">
        <Alert tone={key === "confirmed" || key === "unsubscribed" ? "success" : key === "unknown" ? "info" : "error"}>{s.body}</Alert>
      </div>
    </>
  );
}
