"use server";

import { redirect } from "next/navigation";
import { getRequestTenant } from "@/server/tenant";
import { performUnsubscribe, readUnsubscribeTarget } from "../_links";

export async function unsubscribeAlertAction(formData: FormData): Promise<void> {
  let ok = false;
  try {
    const tenant = await getRequestTenant();
    ok = await performUnsubscribe(readUnsubscribeTarget(Object.fromEntries(formData)), tenant?.id ?? null);
  } catch (error) {
    console.error("unsubscribeAlertAction failed", error);
  }
  redirect(`/alerts?status=${ok ? "unsubscribed" : "invalid"}`);
}
