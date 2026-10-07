import Link from "next/link";
import { Card, PageHeader, buttonClasses } from "@/components/admin/ui";
import { orderCopy as t } from "../_copy";

export default function OrderNotFound() {
  return (
    <>
      <PageHeader crumb={t.crumb} title="Order not found" />
      <div className="p-4 md:px-[22px] md:py-5">
        <Card className="max-w-xl">
          <p className="text-[13.5px] text-ink-2">{t.notFound}</p>
          <Link href="/admin/orders" className={buttonClasses({ className: "mt-4" })}>
            Back to orders
          </Link>
        </Card>
      </div>
    </>
  );
}
