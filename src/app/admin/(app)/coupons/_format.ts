import type { StatusTone } from "@/components/admin/ui";
import { couponsCopy as t } from "./_copy";

type CouponLike = { type: "PERCENT" | "FIXED" | "FREE_SHIPPING"; value: number; minSubtotal: number; isActive: boolean; startsAt: Date | null; endsAt: Date | null };
export type CouponState = "active" | "scheduled" | "ended" | "inactive";

export const STATE_TONE: Record<CouponState, StatusTone> = { active: "ok", scheduled: "info", ended: "mute", inactive: "mute" };

export function couponState(c: CouponLike, now: Date): CouponState {
  if (!c.isActive) return "inactive";
  if (c.endsAt && c.endsAt.getTime() <= now.getTime()) return "ended";
  if (c.startsAt && c.startsAt.getTime() > now.getTime()) return "scheduled";
  return "active";
}

export function describeDiscount(c: CouponLike, money: (n: number) => string): string {
  const base = c.type === "PERCENT" ? `${c.value / 100}% off` : c.type === "FIXED" ? `${money(c.value)} off` : t.type.FREE_SHIPPING;
  return c.minSubtotal > 0 ? `${base} · from ${money(c.minSubtotal)}` : base;
}
