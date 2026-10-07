import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { listCategoryTree } from "@/server/catalog/categories";
import { copy } from "../[id]/_copy";
import { getTenantDisplay } from "../[id]/_data";
import { categoryOptions } from "../[id]/_lib/options";
import { NewProductForm } from "./NewProductForm";

export const metadata: Metadata = { title: copy.newTitle };

export default async function NewProductPage() {
  const ctx = await requireStaffContext();
  const [tree, tenant] = await Promise.all([listCategoryTree(ctx), getTenantDisplay(ctx)]);
  return (
    <>
      <PageHeader
        crumb={
          <>
            <Link href="/admin/inventory" className="hover:text-ink hover:underline">
              {copy.crumbInventory}
            </Link>{" "}
            › {copy.newTitle}
          </>
        }
        title={copy.newTitle}
      />
      <div className="p-4 md:p-[22px]">
        <NewProductForm categories={categoryOptions(tree)} currency={tenant.currency} />
      </div>
    </>
  );
}
