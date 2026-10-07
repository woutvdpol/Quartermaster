import { Card, ConfirmDialog } from "@/components/admin/ui";
import { archiveProductAction, deleteProductAction } from "../actions";
import { copy } from "../_copy";

const t = copy.danger;

/**
 * Delete is offered only when the service would allow it (DRAFT, no order lines, at most the
 * opening stock movement); the service still enforces it and answers CONFLICT → "archive instead".
 */
export function DangerZone({
  productId,
  stockCode,
  deletable,
  archived,
}: {
  productId: string;
  stockCode: number;
  deletable: boolean;
  archived: boolean;
}) {
  if (!deletable && archived) return null;
  return (
    <Card title={<span className="text-crit">{copy.cards.danger}</span>}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-[13px] text-ink-2">{deletable ? t.deleteBody(stockCode) : t.cannotDelete}</p>
        {deletable ? (
          <ConfirmDialog
            trigger={t.deleteTrigger}
            title={t.deleteTitle}
            description={t.deleteBody(stockCode)}
            confirmLabel={t.deleteConfirm}
            action={deleteProductAction}
            fields={{ id: productId }}
          />
        ) : (
          <ConfirmDialog
            trigger={t.archive}
            title={t.archiveTitle}
            description={t.archiveBody}
            confirmLabel={t.archiveConfirm}
            action={archiveProductAction}
            fields={{ id: productId }}
          />
        )}
      </div>
    </Card>
  );
}
