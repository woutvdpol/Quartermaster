import Link from "next/link";
import { EmptyState, PageHeader, buttonClasses } from "@/components/admin/ui";
import { copy } from "../../_copy";

export default function PurchaseRecordNotFound() {
  return (
    <>
      <PageHeader crumb={copy.detail.crumb} title={copy.detail.titleFallback} />
      <EmptyState
        title="Purchase record not found"
        body="It may have been deleted, or it belongs to another shop."
        action={
          <Link href="/admin/sourcing" className={buttonClasses({ variant: "primary" })}>
            Back to purchase records
          </Link>
        }
      />
    </>
  );
}
