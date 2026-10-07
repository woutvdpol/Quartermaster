import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClasses } from "@/components/admin/Button";
import { Card } from "@/components/admin/Card";
import { PageHeader } from "@/components/admin/PageHeader";
import { WipBadge } from "@/components/admin/StatusPill";
import { findNavItemBySlug } from "@/lib/admin-nav";
import { getDictionary } from "@/lib/i18n";

const t = getDictionary();

/** Shared "Not built yet" page for nav items that have no screen yet. Unknown paths 404. */
function resolve(missing: string[]) {
  const item = missing.length === 1 ? findNavItemBySlug(missing[0]) : undefined;
  return item && !item.built ? item : null;
}

export async function generateMetadata({ params }: PageProps<"/admin/[...missing]">): Promise<Metadata> {
  const item = resolve((await params).missing);
  return { title: item ? t.nav.items[item.key] : t.notBuilt.title };
}

export default async function NotBuiltPage({ params }: PageProps<"/admin/[...missing]">) {
  const item = resolve((await params).missing);
  if (!item) notFound();
  const feature = t.nav.items[item.key];

  return (
    <>
      <PageHeader crumb={t.app.name} title={feature} actions={item.wip ? <WipBadge /> : undefined} />
      <div className="p-4 md:px-[22px] md:py-5">
        <Card title={t.notBuilt.title} className="max-w-xl">
          <p className="text-[13.5px] text-ink-2">{item.wip ? t.notBuilt.wipBody(feature) : t.notBuilt.body(feature)}</p>
          <Link href="/admin/dashboard" className={buttonClasses({ className: "mt-4" })}>
            {t.notBuilt.back}
          </Link>
        </Card>
      </div>
    </>
  );
}
