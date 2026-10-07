import type { Metadata } from "next";
import { Suspense } from "react";
import { Alert } from "@/components/shop/account/form";
import { ButtonLink } from "@/components/shop/ui/Button";
import { Container } from "@/components/shop/ui/Container";
import { Skeleton } from "@/components/shop/ui/Skeleton";
import { alertPagesCopy as t } from "./_copy";

export const metadata: Metadata = { title: t.statusTitle, robots: { index: false, follow: true } };

type StatusKey = keyof typeof t.status;

/** Outcome page of confirm / unsubscribe links: `/alerts?status=confirmed|unsubscribed|expired|invalid`. */
export default function AlertsStatusPage({ searchParams }: PageProps<"/alerts">) {
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
  const key: StatusKey = typeof raw === "string" && raw in t.status ? (raw as StatusKey) : "unknown";
  const s = t.status[key];
  return (
    <>
      <h1 className="text-3xl text-shop-ink sm:text-4xl">{s.title}</h1>
      <div className="mt-5 text-left">
        <Alert tone={key === "confirmed" || key === "unsubscribed" ? "success" : key === "unknown" ? "info" : "error"}>{s.body}</Alert>
      </div>
    </>
  );
}
