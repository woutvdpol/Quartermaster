import Link from "next/link";
import { EmptyState, buttonClasses } from "@/components/admin/ui";

/** Rendered inside the admin shell when a page calls notFound() (unknown product, order, …). */
export default function AdminNotFound() {
  return (
    <div className="p-6">
      <EmptyState
        title="Not found"
        body="This item doesn't exist in the selected shop, or it was removed. If you switched shops, check the shop switcher in the sidebar."
        action={
          <Link href="/admin/dashboard" className={buttonClasses({ variant: "secondary" })}>
            Back to dashboard
          </Link>
        }
      />
    </div>
  );
}
