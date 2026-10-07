"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionFail, actionOk, formString, zodFieldErrors, type ActionResult, type ActionState } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import {
  COMPLIANCE_ACTIONS,
  COMPLIANCE_MATCHES,
  createComplianceRule,
  deleteComplianceRule,
  testCompliance,
  updateComplianceRule,
  type ComplianceVerdict,
} from "@/server/compliance";
import { isCountryCode } from "@/server/shipping/countries";
import { errorResult } from "../inventory/_data";
import { copy } from "./_copy";

const r = copy.result;
const PATH = "/admin/compliance";

const ruleSchema = z
  .object({
    id: z.string().min(1).max(64).optional(),
    name: z.string().trim().min(1, "Enter a name.").max(120, "Keep the name under 120 characters."),
    match: z.enum(COMPLIANCE_MATCHES, "Choose what the rule applies to."),
    categoryId: z.string().max(64).nullable(),
    countries: z.array(z.string().refine(isCountryCode, "Unknown country.")).min(1, "Choose at least one country."),
    action: z.enum(COMPLIANCE_ACTIONS, "Choose an action."),
    note: z.string().trim().max(500, "Keep the note under 500 characters."),
    isActive: z.boolean(),
  })
  .refine((d) => d.match !== "CATEGORY" || Boolean(d.categoryId), { path: ["categoryId"], message: "Choose a category." });

export async function saveRuleAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const parsed = ruleSchema.safeParse({
    id: formString(formData, "id") || undefined,
    name: formString(formData, "name"),
    match: formString(formData, "match"),
    categoryId: formString(formData, "categoryId") || null,
    countries: formData.getAll("countries").map(String),
    action: formString(formData, "action"),
    note: formString(formData, "note"),
    isActive: formData.get("isActive") === "on",
  });
  if (!parsed.success) return actionFail(r.check, zodFieldErrors(parsed.error));
  const { id, ...data } = parsed.data;
  try {
    const ctx = await requireStaffContext();
    const input = { ...data, note: data.note || null, categoryId: data.match === "CATEGORY" ? data.categoryId : null };
    if (id) await updateComplianceRule(ctx, id, input);
    else await createComplianceRule(ctx, input);
    revalidatePath(PATH);
    return actionOk(id ? r.saved : r.created(data.name));
  } catch (err) {
    return errorResult(err, r.failed);
  }
}

export async function deleteRuleAction(formData: FormData): Promise<ActionResult> {
  const id = formString(formData, "id");
  if (!id) return actionFail(r.failed);
  try {
    await deleteComplianceRule(await requireStaffContext(), id);
    revalidatePath(PATH);
    return actionOk(r.deleted);
  } catch (err) {
    return errorResult(err, r.failed);
  }
}

export type ComplianceTestResult = {
  product: { stockCode: number; title: string; status: string };
  country: string | null;
  verdict: ComplianceVerdict;
};

const testSchema = z.object({
  countryCode: z.string().refine(isCountryCode, "Choose a country."),
  stockCode: z.coerce.number("Enter a stock code.").int("Enter a stock code.").min(1, "Enter a stock code.").max(999_999_999),
});

export async function testRuleAction(_prev: ActionState, formData: FormData): Promise<ActionResult<string, ComplianceTestResult>> {
  const parsed = testSchema.safeParse({ countryCode: formString(formData, "countryCode"), stockCode: formString(formData, "stockCode").replace(/^#/, "") });
  if (!parsed.success) return actionFail(r.check, zodFieldErrors(parsed.error)) as ActionResult<string, ComplianceTestResult>;
  try {
    const res = await testCompliance(await requireStaffContext(), parsed.data);
    return actionOk(undefined, { product: { stockCode: res.product.stockCode, title: res.product.title, status: res.product.status }, country: res.country, verdict: res.verdict });
  } catch (err) {
    const res = errorResult(err, r.failed);
    return actionFail(res.message ?? r.failed) as ActionResult<string, ComplianceTestResult>;
  }
}
