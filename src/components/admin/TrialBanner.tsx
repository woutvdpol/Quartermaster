import Link from "next/link";
import { DateTime, InlineAlert } from "@/components/admin/ui";
import { trialState } from "@/server/onboarding/trial-rules";

/**
 * Free-trial notice above every admin page of a trial shop (docs/signup-modes.md). Owners have no
 * billing page yet, so the next step is a reply to the trial mail; a superadmin gets the platform link.
 */
export function TrialBanner({
  tenant,
  timeZone,
  superadmin,
}: {
  tenant: { id: string; trialEndsAt: Date | null };
  timeZone: string;
  superadmin: boolean;
}) {
  const state = trialState(tenant);
  if (state.kind === "none") return null;
  const manage = superadmin ? (
    <Link href={`/admin/platform/${tenant.id}`} className="text-[13px] font-medium text-accent underline-offset-2 hover:underline">
      Manage trial
    </Link>
  ) : null;
  if (state.kind === "ended") {
    return (
      <InlineAlert tone="crit" title="Your free trial has ended" action={manage} className="mx-4 mt-3 md:mx-[22px]">
        Since <DateTime value={state.endsAt} format="date" timeZone={timeZone} /> visitors see “Temporarily closed”. Your admin, products and orders are
        kept. Reply to our trial email to choose a package and reopen your shop.
      </InlineAlert>
    );
  }
  return (
    <InlineAlert
      tone={state.daysLeft <= 7 ? "warn" : "info"}
      title={`Free trial · ${state.daysLeft} ${state.daysLeft === 1 ? "day" : "days"} left`}
      action={manage}
      className="mx-4 mt-3 md:mx-[22px]"
    >
      Your trial ends on <DateTime value={state.endsAt} format="date" timeZone={timeZone} />. After that the shop closes for visitors until you choose a
      package; your admin and data stay.
    </InlineAlert>
  );
}
