import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError, type ServiceContext } from "@/server/context";
import { notFound, parseInput } from "@/server/catalog/errors";
import { normalizeCountryCode } from "@/server/shipping/countries";
import type { Prisma } from "@/generated/prisma/client";
import { COMPLIANCE_ACTIONS, COMPLIANCE_MATCHES, type ComplianceActionName, type ComplianceMatchName } from "./presets";

/*
 * Compliance rules admin (per tenant). A rule = match (category incl. descendants, or a product flag)
 * × countries × action. Audit actions start with "compliance." (invalidates the shop catalog cache,
 * which also holds the compiled rules — see ./resolve.ts).
 */

type Tx = Prisma.TransactionClient;

export type ComplianceRuleRow = {
  id: string;
  name: string;
  match: ComplianceMatchName;
  categoryId: string | null;
  category: { id: string; title: string } | null;
  countries: string[];
  action: ComplianceActionName;
  isActive: boolean;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const countriesSchema = z
  .array(z.string())
  .min(1, "Choose at least one country")
  .max(300)
  .transform((list, ctx) => {
    const out = new Set<string>();
    for (const raw of list) {
      const code = normalizeCountryCode(raw);
      if (!code) {
        ctx.addIssue({ code: "custom", message: `Unknown country code "${raw}"` });
        return z.NEVER;
      }
      out.add(code);
    }
    return [...out].sort();
  });

const baseSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120),
  match: z.enum(COMPLIANCE_MATCHES),
  categoryId: z.string().min(1).max(64).nullish(),
  countries: countriesSchema,
  action: z.enum(COMPLIANCE_ACTIONS),
  isActive: z.boolean().default(true),
  note: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => (v ? v : null)),
});

export type ComplianceRuleInput = z.input<typeof baseSchema>;

const select = {
  id: true,
  name: true,
  match: true,
  categoryId: true,
  category: { select: { id: true, title: true } },
  countries: true,
  action: true,
  isActive: true,
  note: true,
  createdAt: true,
  updatedAt: true,
} as const;

async function normaliseCategory(tx: Tx, tenantId: string, match: ComplianceMatchName, categoryId: string | null | undefined): Promise<string | null> {
  if (match !== "CATEGORY") return null;
  if (!categoryId) throw new ServiceError("INVALID", "categoryId: Choose a category", [{ path: "categoryId", message: "Choose a category" }]);
  const cat = await tx.category.findFirst({ where: { id: categoryId, tenantId }, select: { id: true } });
  if (!cat) throw notFound("Category");
  return cat.id;
}

/** All rules (active first, then name). */
export async function listComplianceRules(ctx: ServiceContext): Promise<ComplianceRuleRow[]> {
  return db.complianceRule.findMany({ where: { tenantId: ctx.tenantId }, select, orderBy: [{ isActive: "desc" }, { name: "asc" }, { createdAt: "asc" }] });
}

export async function getComplianceRule(ctx: ServiceContext, ruleId: string): Promise<ComplianceRuleRow> {
  const rule = await db.complianceRule.findFirst({ where: { id: ruleId, tenantId: ctx.tenantId }, select });
  if (!rule) throw notFound("Compliance rule");
  return rule;
}

export async function createComplianceRule(ctx: ServiceContext, input: ComplianceRuleInput): Promise<ComplianceRuleRow> {
  const data = parseInput(baseSchema, input);
  const rule = await db.$transaction(async (tx) =>
    tx.complianceRule.create({
      data: {
        tenantId: ctx.tenantId,
        name: data.name,
        match: data.match,
        categoryId: await normaliseCategory(tx, ctx.tenantId, data.match, data.categoryId),
        countries: data.countries,
        action: data.action,
        isActive: data.isActive,
        note: data.note,
      },
      select,
    }),
  );
  await audit({ action: "compliance.create", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "ComplianceRule", entityId: rule.id, data: { name: rule.name, action: rule.action } });
  return rule;
}

/** Replaces all fields of a rule (the editor always sends the full rule). */
export async function updateComplianceRule(ctx: ServiceContext, ruleId: string, input: ComplianceRuleInput): Promise<ComplianceRuleRow> {
  const data = parseInput(baseSchema, input);
  const rule = await db.$transaction(async (tx) => {
    const current = await tx.complianceRule.findFirst({ where: { id: ruleId, tenantId: ctx.tenantId }, select: { id: true } });
    if (!current) throw notFound("Compliance rule");
    return tx.complianceRule.update({
      where: { id: ruleId },
      data: {
        name: data.name,
        match: data.match,
        categoryId: await normaliseCategory(tx, ctx.tenantId, data.match, data.categoryId),
        countries: data.countries,
        action: data.action,
        isActive: data.isActive,
        note: data.note,
      },
      select,
    });
  });
  await audit({ action: "compliance.update", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "ComplianceRule", entityId: ruleId, data: { name: rule.name } });
  return rule;
}

export async function setComplianceRuleActive(ctx: ServiceContext, ruleId: string, isActive: boolean) {
  const res = await db.complianceRule.updateMany({ where: { id: ruleId, tenantId: ctx.tenantId }, data: { isActive } });
  if (res.count === 0) throw notFound("Compliance rule");
  await audit({ action: "compliance.update", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "ComplianceRule", entityId: ruleId, data: { isActive } });
}

export async function deleteComplianceRule(ctx: ServiceContext, ruleId: string) {
  const res = await db.complianceRule.deleteMany({ where: { id: ruleId, tenantId: ctx.tenantId } });
  if (res.count === 0) throw notFound("Compliance rule");
  await audit({ action: "compliance.delete", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "ComplianceRule", entityId: ruleId });
}
