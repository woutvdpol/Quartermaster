import Link from "next/link";
import { Card } from "@/components/admin/ui";
import { requireStaffContext, ServiceError } from "@/server/context";
import { getEntityTranslations } from "@/server/translations/service";
import { TranslationsPanel } from "./TranslationsPanel";

/**
 * Product editor card "Translations" (docs/i18n.md § Vertalen): per enabled shop language the English
 * original next to the editable translation, with Approve & publish / Translate again. Self-contained
 * server component; renders nothing when the shop has no extra languages.
 */
export async function TranslationsCard({ productId }: { productId: string }) {
  const ctx = await requireStaffContext();
  let data;
  try {
    data = await getEntityTranslations(ctx, "PRODUCT", productId);
  } catch (err) {
    if (err instanceof ServiceError && err.code === "NOT_FOUND") return null;
    throw err;
  }
  if (!data.locales.length) return null;
  const open = data.fields.reduce((n, f) => n + data.locales.filter((l) => f.source && f.cells[l]?.status !== "APPROVED").length, 0);
  return (
    <Card
      title="Translations"
      aside={
        <Link href="/admin/translations" className="text-accent underline-offset-2 hover:underline">
          {open ? `${open} to review` : "All reviewed"} · review list
        </Link>
      }
    >
      <TranslationsPanel productId={productId} locales={data.locales} fields={data.fields} />
    </Card>
  );
}
