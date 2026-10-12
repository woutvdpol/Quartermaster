"use client";

import { useState, useTransition } from "react";
import { Button, Drawer, Spinner, toast } from "@/components/admin/ui";
import { addLotsAction } from "../actions";
import { auctionsCopy as t } from "../_copy";
import { CandidateSearch } from "./CandidateSearch";

/** "Add lots from inventory" drawer: search, tick items, add them with the default start / reserve. */
export function LotPicker({ auctionId, currency }: { auctionId: string; currency: string }) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [adding, start] = useTransition();

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        aria-haspopup="dialog"
        onClick={() => {
          setPicked(new Set());
          setSession((s) => s + 1);
          setOpen(true);
        }}
      >
        {t.lots.add}
      </Button>
      <Drawer
        open={open}
        onOpenChange={setOpen}
        size="lg"
        title={t.lots.addTitle}
        description={t.lots.addDescription}
        footer={
          <div className="flex justify-end">
            <Button
              variant="primary"
              disabled={!picked.size || adding}
              aria-busy={adding || undefined}
              onClick={() =>
                start(async () => {
                  const res = await addLotsAction(auctionId, [...picked]);
                  if (res.ok) {
                    toast.ok(res.message ?? "");
                    setOpen(false);
                  } else toast.crit(res.message ?? "Could not add the lots.");
                })
              }
            >
              {adding ? <Spinner /> : null}
              {t.lots.addSelected(picked.size)}
            </Button>
          </div>
        }
      >
        {open ? (
          <CandidateSearch
            key={session}
            auctionId={auctionId}
            currency={currency}
            mode="multi"
            picked={picked}
            onToggle={(c) =>
              setPicked((prev) => {
                const next = new Set(prev);
                if (next.has(c.id)) next.delete(c.id);
                else next.add(c.id);
                return next;
              })
            }
          />
        ) : null}
      </Drawer>
    </>
  );
}
