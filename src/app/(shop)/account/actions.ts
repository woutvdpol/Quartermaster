"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  changeCustomerEmail,
  changeCustomerPassword,
  createAddress,
  deleteAddress,
  deleteCustomerAccount,
  getShopCustomer,
  setDefaultAddress,
  setNewsletterPreference,
  updateAddress,
  updateCustomerProfile,
  type AddressFieldErrors,
  type AddressInput,
} from "@/server/customer-auth";
import { accountCopy } from "@/components/shop/account/_copy";

/*
 * Account mutations. Every action re-resolves the signed-in customer of THIS host from the session;
 * nothing about identity is taken from the form.
 */

export type FormState = { ok?: boolean; message?: string; error?: string; fieldErrors?: Record<string, string> } | undefined;

function str(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

async function customerOrLogin(returnTo: string) {
  const c = await getShopCustomer();
  if (!c) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  return c;
}

// ─── Profile ────────────────────────────────────────────────────────────────

export async function updateProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const c = await customerOrLogin("/account/profile");
  const res = await updateCustomerProfile(c.user, { name: str(formData, "name"), phone: str(formData, "phone") });
  if (!res.ok) return { error: accountCopy.register.errors.invalid, fieldErrors: res.fieldErrors };
  revalidatePath("/account", "layout");
  return { ok: true, message: accountCopy.profile.detailsSaved };
}

export async function changeEmailAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const c = await customerOrLogin("/account/profile");
  const res = await changeCustomerEmail(c.user, str(formData, "email"), str(formData, "password"));
  if (!res.ok) return { error: accountCopy.profile.emailErrors[res.error] };
  revalidatePath("/account", "layout");
  return { ok: true, message: accountCopy.profile.emailChanged };
}

export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = accountCopy.profile.passwordErrors;
  const c = await customerOrLogin("/account/profile");
  const next = str(formData, "newPassword");
  if (next !== str(formData, "confirm")) return { error: t.mismatch };
  const res = await changeCustomerPassword(c.user, str(formData, "current"), next, c.sessionId);
  if (!res.ok) return { error: res.error === "invalid_password" && res.message ? res.message : t[res.error] };
  return { ok: true, message: accountCopy.profile.passwordChanged };
}

// ─── Addresses ──────────────────────────────────────────────────────────────

export type AddressFormState = { error?: string; fieldErrors?: AddressFieldErrors } | undefined;

function addressFromForm(formData: FormData): AddressInput {
  return {
    type: str(formData, "type") === "BILLING" ? "BILLING" : "SHIPPING",
    isDefault: formData.get("isDefault") === "on",
    firstName: str(formData, "firstName"),
    lastName: str(formData, "lastName"),
    company: str(formData, "company"),
    street: str(formData, "street"),
    houseNumber: str(formData, "houseNumber"),
    line2: str(formData, "line2"),
    postalCode: str(formData, "postalCode"),
    city: str(formData, "city"),
    region: str(formData, "region"),
    countryCode: str(formData, "countryCode"),
    phone: str(formData, "phone"),
  };
}

export async function saveAddressAction(_prev: AddressFormState, formData: FormData): Promise<AddressFormState> {
  const c = await customerOrLogin("/account/addresses");
  const owner = { tenantId: c.tenant.id, customerId: c.customer.id };
  const id = str(formData, "id");
  const input = addressFromForm(formData);
  const res = id ? await updateAddress(owner, id, input) : await createAddress(owner, input);
  if (!res.ok) {
    const t = accountCopy.addresses;
    if (res.error === "limit") return { error: t.limit };
    if (res.error === "not_found") return { error: t.notFound };
    return { error: accountCopy.register.errors.invalid, fieldErrors: res.fieldErrors };
  }
  revalidatePath("/account", "layout");
  redirect("/account/addresses");
}

export async function deleteAddressAction(formData: FormData): Promise<void> {
  const c = await customerOrLogin("/account/addresses");
  await deleteAddress({ tenantId: c.tenant.id, customerId: c.customer.id }, str(formData, "id"));
  revalidatePath("/account", "layout");
}

export async function setDefaultAddressAction(formData: FormData): Promise<void> {
  const c = await customerOrLogin("/account/addresses");
  await setDefaultAddress({ tenantId: c.tenant.id, customerId: c.customer.id }, str(formData, "id"));
  revalidatePath("/account", "layout");
}

// ─── Newsletter & privacy ───────────────────────────────────────────────────

export async function newsletterPreferenceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = accountCopy.privacy;
  const c = await customerOrLogin("/account/privacy");
  const subscribed = str(formData, "subscribe") === "1";
  const res = await setNewsletterPreference(
    { tenantId: c.tenant.id, customerId: c.customer.id, email: c.user.email, userId: c.user.id },
    subscribed,
  );
  if (!res.ok) return { error: res.error === "rate_limited" ? accountCopy.common.rateLimited : t.newsletterUnavailable };
  revalidatePath("/account/privacy");
  return { ok: true, message: subscribed ? (res.status === "active" ? t.status.active : t.subscribedPending) : t.unsubscribed };
}

export async function deleteAccountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const c = await customerOrLogin("/account/privacy");
  const res = await deleteCustomerAccount(c.user, str(formData, "password"));
  if (!res.ok) return { error: accountCopy.privacy.deleteErrors[res.error] };
  redirect("/login?deleted=1");
}
