"use server";

import { revalidatePath } from "next/cache";
import { actionFail, actionOk, type ActionResult, type ActionState } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { isSettingsGroup, updateSettings, type SettingsGroup } from "@/server/settings";
import { failFrom } from "../_system/errors";
import { groupFields, SETTINGS_FORMS, type SettingField } from "./_fields";

type Patch = Record<string, unknown>;

function setPath(target: Patch, path: string, value: unknown) {
  const keys = path.split(".");
  let o = target;
  for (const k of keys.slice(0, -1)) o = (o[k] ??= {}) as Patch;
  o[keys[keys.length - 1]] = value;
}

/** FormData → deep-partial patch for one group. Collects local errors for unparseable numbers. */
function readField(f: SettingField, formData: FormData, errors: Record<string, string[]>): { set: boolean; value?: unknown } {
  const raw = formData.get(f.path);
  const str = typeof raw === "string" ? raw.trim() : "";
  switch (f.kind) {
    case "storedPath":
      return { set: false };
    case "switch":
      return { set: true, value: formData.has(f.path) };
    case "multicheck":
    case "tags":
      return { set: true, value: formData.getAll(f.path).filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean) };
    case "select":
    case "segmented":
    case "radio":
      if (raw === null) return { set: false };
      return { set: true, value: f.numeric ? Number(str) : str };
    case "money": {
      if (str === "") return { set: true, value: 0 };
      const n = Number(str);
      if (!Number.isInteger(n)) {
        errors[f.path] = ["Enter an amount."];
        return { set: false };
      }
      return { set: true, value: n };
    }
    case "number": {
      if (str === "") {
        if (f.nullable) return { set: true, value: null };
        errors[f.path] = ["Enter a number."];
        return { set: false };
      }
      const n = Number(str.replace(",", "."));
      if (!Number.isFinite(n) || (f.integer && !Number.isInteger(n))) {
        errors[f.path] = [f.integer ? "Enter a whole number." : "Enter a number."];
        return { set: false };
      }
      return { set: true, value: n };
    }
    case "text":
    case "email":
    case "url":
      if (raw === null) return { set: false };
      return { set: true, value: str === "" && f.nullable ? null : str };
    default:
      if (raw === null) return { set: false };
      return { set: true, value: typeof raw === "string" ? raw : "" };
  }
}

/** Maps Zod paths like "defaultSpecs.3" back to the nearest field name. */
function toFieldKeys(fieldErrors: Record<string, string[]> | undefined, known: Set<string>) {
  if (!fieldErrors) return fieldErrors;
  const out: Record<string, string[]> = {};
  for (const [key, msgs] of Object.entries(fieldErrors)) {
    let k = key;
    while (k && !known.has(k) && k.includes(".")) k = k.slice(0, k.lastIndexOf("."));
    const target = known.has(k) ? k : "_form";
    (out[target] ??= []).push(...msgs);
  }
  return out;
}

export async function saveSettingsAction(group: SettingsGroup, _prev: ActionState, formData: FormData): Promise<ActionResult> {
  if (!isSettingsGroup(group)) return actionFail("Unknown settings group.");
  const fields = groupFields(group);
  const known = new Set(fields.map((f) => f.path));
  const localErrors: Record<string, string[]> = {};
  const patch: Patch = {};
  for (const f of fields) {
    const r = readField(f, formData, localErrors);
    if (r.set) setPath(patch, f.path, r.value);
  }
  if (Object.keys(localErrors).length) return actionFail("Check the highlighted fields.", localErrors);

  try {
    const ctx = await requireStaffContext();
    await updateSettings(ctx.tenantId, group, patch as never, ctx.actor);
  } catch (err) {
    const failure = failFrom(err);
    const fe = toFieldKeys(failure.fieldErrors as Record<string, string[]> | undefined, known);
    const formLevel = fe?._form?.join(" ");
    return actionFail(formLevel ? `${failure.message} ${formLevel}` : failure.message, fe);
  }
  revalidatePath("/admin/settings", "layout");
  return actionOk(`${SETTINGS_FORMS[group].label} settings saved.`);
}
