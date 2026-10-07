"use client";

import { useTransition } from "react";
import { Button, toast } from "@/components/admin/ui";
import { moveZoneAction } from "../actions";

/** Up/down buttons that change the display order of zones. */
export function MoveButtons({ id, name, first, last }: { id: string; name: string; first: boolean; last: boolean }) {
  const [pending, start] = useTransition();
  const move = (direction: "up" | "down") =>
    start(async () => {
      const res = await moveZoneAction(id, direction);
      if (!res.ok) toast.crit(res.message ?? "Could not move the zone.");
    });
  return (
    <span className="inline-flex" role="group" aria-label={`Order of ${name}`}>
      <Button size="sm" variant="ghost" disabled={first || pending} onClick={() => move("up")} aria-label={`Move ${name} up`}>
        ↑
      </Button>
      <Button size="sm" variant="ghost" disabled={last || pending} onClick={() => move("down")} aria-label={`Move ${name} down`}>
        ↓
      </Button>
    </span>
  );
}
