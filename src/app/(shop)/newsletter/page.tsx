import type { Metadata } from "next";
import { Suspense } from "react";
import { accountCopies, accountCopy } from "@/components/shop/account/_copy";
import { shopCopy } from "@/server/i18n/locale";
import { Alert } from "@/components/shop/account/form";
import { ButtonLink } from "@/components/shop/ui/Button";
import { Container } from "@/components/shop/ui/Container";
import { Skeleton } from "@/components/shop/ui/Skeleton";

export async function generateMetadata(): Promise<Metadata> {
  const t = (await shopCopy(accountCopies)).newsletter;
  return { title: t.title, robots: { index: false, follow: true } };
}

type StatusKey = keyof typeof accountCopy.newsletter.status;

/** Outcome page for confirm/unsubscribe links: `/newsletter?status=confirmed|expired|invalid|unsubscribed`. */
export default async function NewsletterStatusPage({ searchParams }: PageProps<"/newsletter">) {
  const t = (await shopCopy(accountCopies)).newsletter;
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

async function Status({ searchParams }: { searchParams: PageProps<"/newsletter">["searchParams"] }) {
  const raw = (await searchParams).status;
  const t = (await shopCopy(accountCopies)).newsletter;
  const key: StatusKey = typeof raw === "string" && raw in t.status ? (raw as StatusKey) : "unknown";
  const s = t.status[key];
  return (
    <>
      <h1 className="text-[2.25rem] tracking-tight text-shop-ink sm:text-5xl">{s.title}</h1>
      <div className="mt-5 text-left">
        <Alert tone={key === "confirmed" || key === "unsubscribed" ? "success" : key === "unknown" ? "info" : "error"}>{s.body}</Alert>
      </div>
    </>
  );
}
