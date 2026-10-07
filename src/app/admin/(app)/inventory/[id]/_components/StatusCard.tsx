"use client";

import { useOptimistic, useState, useTransition } from "react";
import {
  Button,
  Card,
  DateTime,
  InlineAlert,
  KeyValue,
  ProductStatusPill,
  SegmentedControl,
  Select,
  Spinner,
  toast,
} from "@/components/admin/ui";
import type { ProductStatus } from "@/generated/prisma/enums";
import { bumpToTopAction, releaseReservationAction, setStatusAction } from "../actions";
import { copy } from "../_copy";

const t = copy.status;
const MAIN = ["DRAFT", "ACTIVE", "SOLD", "ARCHIVED"] as const;
const OTHER = ["RESERVED", "STOLEN"] as const;

function labelOf(s: ProductStatus): string {
  return (t.options as Record<string, string>)[s] ?? (t.otherOptions as Record<string, string>)[s] ?? s;
}

/** Status (immediate, separate from Save), publish/sold dates, live reservation, wishlist count. */
export function StatusCard({
  productId,
  status,
  activeBlocker,
  publishedAt,
  soldAt,
  reservation,
  wishlistCount,
  timeZone,
}: {
  productId: string;
  status: ProductStatus;
  /** Why ACTIVE is not allowed right now (statusBlocker), or null. */
  activeBlocker: string | null;
  publishedAt: Date | null;
  soldAt: Date | null;
  reservation: { expiresAt: Date } | null;
  wishlistCount: number;
  timeZone: string;
}) {
  const [optimistic, setOptimistic] = useOptimistic(status);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmRelease, setConfirmRelease] = useState(false);

  function change(next: string) {
    if (!next || next === optimistic) return;
    const s = next as ProductStatus;
    setError(null);
    startTransition(async () => {
      setOptimistic(s);
      const r = await setStatusAction(productId, s);
      if (r.ok) toast.ok(t.changed(labelOf(s)));
      else {
        setError(r.message ?? copy.errors.generic);
        toast.crit(r.message ?? copy.errors.generic);
      }
    });
  }

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    startTransition(async () => {
      const r = await action();
      if (r.ok) toast.ok(r.message ?? "");
      else toast.crit(r.message ?? copy.errors.generic);
    });
  }

  const isMain = (MAIN as readonly string[]).includes(optimistic);

  return (
    <Card title={t.legend} aside={pending ? <Spinner label="Saving status" /> : <ProductStatusPill status={optimistic} />}>
      <div className="grid gap-3">
        <SegmentedControl
          name="statusChoice"
          legend={t.legend}
          legendHidden
          size="sm"
          value={isMain ? optimistic : ""}
          onValueChange={change}
          disabled={pending}
          options={MAIN.map((s) => ({
            value: s,
            label: t.options[s],
            disabled: s === "ACTIVE" && optimistic !== "ACTIVE" && activeBlocker !== null,
          }))}
          hint={activeBlocker && optimistic !== "ACTIVE" ? `${t.blocked(activeBlocker.toLowerCase())} ${t.blockedHint}` : undefined}
        />
        <Select
          label={t.other}
          value={isMain ? "" : optimistic}
          onChange={(e) => change(e.target.value)}
          disabled={pending}
          options={[{ value: "", label: t.otherNone }, ...OTHER.map((s) => ({ value: s, label: t.otherOptions[s] }))]}
        />
        {error && (
          <InlineAlert tone="crit" live="alert">
            {error}
          </InlineAlert>
        )}

        <KeyValue
          items={[
            {
              label: optimistic === "SOLD" ? t.sold : t.published,
              value:
                optimistic === "SOLD" && soldAt ? (
                  <DateTime value={soldAt} format="date" timeZone={timeZone} />
                ) : publishedAt ? (
                  <DateTime value={publishedAt} format="date" timeZone={timeZone} />
                ) : (
                  t.notPublished
                ),
              mono: true,
            },
            {
              label: t.reserved,
              value: reservation ? (
                <span>
                  {t.reservedUntil} <DateTime value={reservation.expiresAt} format="time" timeZone={timeZone} />
                </span>
              ) : (
                t.notReserved
              ),
            },
            { label: t.wishlist, value: `${wishlistCount}×`, mono: true },
          ]}
        />

        {reservation &&
          (confirmRelease ? (
            <div role="group" aria-label={t.releaseConfirm} className="grid gap-2 rounded-control border border-warn bg-warn-soft p-2.5">
              <p className="text-[13px]">{t.releaseConfirm}</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  disabled={pending}
                  onClick={() => {
                    setConfirmRelease(false);
                    run(() => releaseReservationAction(productId));
                  }}
                >
                  {t.releaseYes}
                </Button>
                <Button size="sm" onClick={() => setConfirmRelease(false)}>
                  {t.releaseCancel}
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" onClick={() => setConfirmRelease(true)} disabled={pending}>
              {t.release}
            </Button>
          ))}

        <Button size="sm" onClick={() => run(() => bumpToTopAction(productId))} disabled={pending}>
          {t.bump}
        </Button>
      </div>
    </Card>
  );
}
