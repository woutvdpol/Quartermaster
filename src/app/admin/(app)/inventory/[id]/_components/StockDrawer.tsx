"use client";

import { startTransition, useState, type FormEvent } from "react";
import {
  ActionMessage,
  ActionToast,
  Button,
  DateTime,
  Drawer,
  NumberInput,
  SegmentedControl,
  Textarea,
  cx,
  useActionForm,
} from "@/components/admin/ui";
import type { StockMovementReason } from "@/generated/prisma/enums";
import { adjustStockAction } from "../actions";
import { copy } from "../_copy";

const t = copy.stock;

export type MovementDto = {
  id: string;
  delta: number;
  quantityAfter: number;
  reason: StockMovementReason;
  note: string | null;
  actorEmail: string | null;
  createdAt: Date;
};

/** Read-only quantity + "Adjust stock" drawer (adjustStock, reason ADJUSTMENT) with the ledger history. */
export function StockControl({
  productId,
  stockCode,
  quantity,
  movements,
  timeZone,
}: {
  productId: string;
  stockCode: number;
  quantity: number;
  movements: MovementDto[];
  timeZone: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"set" | "delta">("set");
  const [formKey, setFormKey] = useState(0);
  const { state, formAction, pending, error } = useActionForm(adjustStockAction);

  // Close + toast once per successful result (adjust state during render, no effect).
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) {
      setOpen(false);
      setFormKey((k) => k + 1);
    }
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // Manual dispatch: keeps typed values when the server rejects the input.
    startTransition(() => formAction(fd));
  }

  return (
    <div className="grid gap-1.5">
      <div className="flex items-end justify-between gap-2">
        <div className="grid gap-1">
          <span className="type-label text-[11.5px] text-muted">{t.onHand}</span>
          <span className="font-mono text-lg tabular-nums" aria-live="polite">
            {quantity}
          </span>
        </div>
        <Button size="sm" aria-haspopup="dialog" onClick={() => setOpen(true)}>
          {t.adjust}
        </Button>
      </div>

      <ActionToast state={state} errors={false} />
      <Drawer open={open} onOpenChange={setOpen} title={t.drawerTitle} description={t.drawerDescription(stockCode)}>
        <div className="grid gap-6">
          <form key={formKey} onSubmit={submit} className="grid gap-3" noValidate>
            <input type="hidden" name="id" value={productId} />
            <input type="hidden" name="mode" value={mode} />
            <p className="text-[13px] text-ink-2">
              {t.onHand}: <span className="font-mono tabular-nums">{quantity}</span>
            </p>
            <SegmentedControl
              name="modeChoice"
              legend={t.mode}
              size="sm"
              value={mode}
              onValueChange={(v) => setMode(v === "delta" ? "delta" : "set")}
              options={[
                { value: "set", label: t.modeSet },
                { value: "delta", label: t.modeDelta },
              ]}
            />
            {mode === "set" ? (
              <NumberInput label={t.quantity} name="quantity" defaultValue={String(quantity)} inputMode="numeric" required error={error("quantity")} />
            ) : (
              <NumberInput label={t.delta} name="delta" hint={t.deltaHint} inputMode="numeric" required placeholder="+1 / -1" error={error("delta")} />
            )}
            <Textarea label={t.note} name="note" rows={2} maxLength={500} placeholder={t.notePlaceholder} showOptional />
            <ActionMessage state={state} showSuccess={false} />
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>{t.close}</Button>
              <Button type="submit" variant="primary" disabled={pending}>
                {pending ? t.applying : t.apply}
              </Button>
            </div>
          </form>

          <section aria-labelledby="stock-history" className="grid gap-2">
            <h3 id="stock-history" className="type-label text-xs text-muted">
              {t.history}
            </h3>
            {movements.length === 0 ? (
              <p className="text-[13px] text-muted">{t.historyEmpty}</p>
            ) : (
              <ol className="grid divide-y divide-line rounded-card border border-line">
                {movements.map((m) => (
                  <li key={m.id} className="grid gap-0.5 px-3 py-2 text-[13px]">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{t.reasons[m.reason]}</span>
                      <span className={cx("font-mono tabular-nums", m.delta > 0 ? "text-ok" : m.delta < 0 ? "text-crit" : "text-muted")}>
                        {m.delta > 0 ? `+${m.delta}` : m.delta}
                        <span className="text-muted">
                          {" "}
                          → {m.quantityAfter}
                        </span>
                      </span>
                    </div>
                    <div className="text-xs text-muted">
                      <DateTime value={m.createdAt} format="datetime" timeZone={timeZone} />
                      {m.actorEmail && ` · ${t.by} ${m.actorEmail}`}
                    </div>
                    {m.note && <p className="text-xs text-ink-2">{m.note}</p>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </Drawer>
    </div>
  );
}
