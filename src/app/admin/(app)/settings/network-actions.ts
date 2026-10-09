"use server";

import { revalidatePath } from "next/cache";
import { actionOk, type ActionResult } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { setNetworkOptIn, type NetworkMembership } from "@/server/network/admin";
import { failFrom } from "../_system/errors";

/** Settings → General → "Quartermaster network": show / hide this shop's stock in the network. */
export async function setNetworkOptInAction(optIn: boolean): Promise<ActionResult<string, NetworkMembership>> {
  try {
    const ctx = await requireStaffContext();
    const membership = await setNetworkOptIn(ctx, optIn === true);
    revalidatePath("/admin/settings/general");
    return actionOk<NetworkMembership>(membership.optIn ? "Your stock is now in the Quartermaster network." : "Your stock was removed from the Quartermaster network.", membership);
  } catch (err) {
    return { ok: false, message: failFrom(err).message };
  }
}
