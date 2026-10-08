import "server-only";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError, type ServiceContext } from "@/server/context";
import { getSettings, updateSettings } from "@/server/settings";
import { getStorage } from "@/server/media/storage";
import type { Prisma } from "@/generated/prisma/client";
import {
  THEME_DRAFT_GROUP,
  contrastWarnings,
  pickTheme,
  themeChanges,
  themeSchema,
  type ContrastWarning,
  type Theme,
} from "./presets";

export * from "./presets";

/*
 * Theme builder service (Website → Theme). The draft lives in its own Setting row
 * (group "appearanceDraft", validated by the same appearance schema), so the live shop is untouched
 * until publish. Publishing copies the draft into `appearance` via updateSettings, which audits
 * "settings.update" and thereby invalidates the tenant's shop cache.
 */

export type ThemeState = {
  live: Theme;
  /** Null when there is no unpublished draft. */
  draft: Theme | null;
  /** Keys that differ between draft and live ([] without a draft). */
  changes: string[];
  warnings: ContrastWarning[];
  draftUpdatedAt: string | null;
};

async function readDraftRow(tenantId: string) {
  const row = await db.setting.findUnique({ where: { tenantId_group: { tenantId, group: THEME_DRAFT_GROUP } } });
  if (!row) return null;
  const parsed = themeSchema.safeParse(row.data);
  // A draft that no longer validates (schema change) is treated as absent; the next save overwrites it.
  return parsed.success ? { theme: parsed.data, updatedAt: row.updatedAt } : null;
}

/** The unpublished draft of a tenant, or null. No access check (used by the shop preview, which checks itself). */
export async function getThemeDraft(tenantId: string): Promise<Theme | null> {
  return (await readDraftRow(tenantId))?.theme ?? null;
}

export async function getThemeState(ctx: ServiceContext): Promise<ThemeState> {
  const [appearance, draftRow] = await Promise.all([getSettings(ctx.tenantId, "appearance"), readDraftRow(ctx.tenantId)]);
  const live = pickTheme(appearance);
  const draft = draftRow?.theme ?? null;
  return {
    live,
    draft,
    changes: draft ? themeChanges(draft, live) : [],
    warnings: contrastWarnings(draft ?? live),
    draftUpdatedAt: draftRow?.updatedAt.toISOString() ?? null,
  };
}

function invalid(error: { issues: { path: PropertyKey[]; message: string }[] }): ServiceError {
  return new ServiceError(
    "INVALID",
    "The theme has invalid values.",
    error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
  );
}

/**
 * Saves the whole draft (the builder always sends the complete theme). Not audited: drafts are
 * invisible to customers and saved on every (debounced) change; publish and discard are audited.
 * Saving a draft equal to the live theme removes the draft.
 */
export async function saveThemeDraft(ctx: ServiceContext, input: unknown): Promise<ThemeState> {
  const parsed = themeSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error);
  const draft = parsed.data;
  const live = pickTheme(await getSettings(ctx.tenantId, "appearance"));
  // The logo is either the live one or a file uploaded through storeThemeLogo for this tenant.
  if (draft.logoPath && draft.logoPath !== live.logoPath && !isOwnBrandingPath(ctx.tenantId, draft.logoPath)) {
    throw new ServiceError("INVALID", "Upload the logo here; other paths are not accepted.", [{ path: "logoPath", message: "Upload the logo here." }]);
  }
  if (themeChanges(draft, live).length === 0) {
    await db.setting.deleteMany({ where: { tenantId: ctx.tenantId, group: THEME_DRAFT_GROUP } });
  } else {
    const data = draft as unknown as Prisma.InputJsonValue;
    await db.setting.upsert({
      where: { tenantId_group: { tenantId: ctx.tenantId, group: THEME_DRAFT_GROUP } },
      create: { tenantId: ctx.tenantId, group: THEME_DRAFT_GROUP, data },
      update: { data },
    });
  }
  return getThemeState(ctx);
}

/** Copies the draft to the live appearance settings. No draft → nothing to publish (CONFLICT). */
export async function publishThemeDraft(ctx: ServiceContext): Promise<ThemeState> {
  const row = await db.setting.findUnique({ where: { tenantId_group: { tenantId: ctx.tenantId, group: THEME_DRAFT_GROUP } } });
  const parsed = row ? themeSchema.safeParse(row.data) : null;
  if (!row || !parsed?.success) throw new ServiceError("CONFLICT", "There are no unpublished theme changes.");
  const before = pickTheme(await getSettings(ctx.tenantId, "appearance"));
  // updateSettings validates, writes and audits "settings.update" (→ tenant shop cache invalidated).
  await updateSettings(ctx.tenantId, "appearance", parsed.data, ctx.actor);
  // Only remove the draft we published: a concurrent save (newer updatedAt) survives as a new draft.
  await db.setting.deleteMany({ where: { tenantId: ctx.tenantId, group: THEME_DRAFT_GROUP, updatedAt: row.updatedAt } });
  await audit({
    action: "theme.publish",
    tenantId: ctx.tenantId,
    actorId: ctx.actor.id,
    entity: "Setting",
    entityId: "appearance",
    data: { theme: parsed.data.theme, changed: themeChanges(parsed.data, before) },
  });
  return getThemeState(ctx);
}

export async function discardThemeDraft(ctx: ServiceContext): Promise<ThemeState> {
  const { count } = await db.setting.deleteMany({ where: { tenantId: ctx.tenantId, group: THEME_DRAFT_GROUP } });
  if (count) {
    await audit({ action: "theme.discard_draft", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Setting", entityId: THEME_DRAFT_GROUP });
  }
  return getThemeState(ctx);
}

// ─── Logo upload ────────────────────────────────────────────────────────────

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_MAX_WIDTH = 800;
const LOGO_MAX_HEIGHT = 300;

function isOwnBrandingPath(tenantId: string, p: string): boolean {
  return p.startsWith(`/uploads/${tenantId}/branding/`) && !p.split("/").includes("..");
}

/**
 * Stores an uploaded logo (PNG/JPEG/WebP — sniffed from the bytes; SVG is not served by
 * /uploads for safety) as WebP under `{tenantId}/branding/logo-{random}.webp`, resized to fit
 * 800×300 with transparency kept. Returns the public path; the caller puts it in the draft.
 * A new name per upload keeps the live logo (and caches) intact until publish.
 */
export async function storeThemeLogo(ctx: ServiceContext, bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength === 0) throw new ServiceError("INVALID", "The file is empty.");
  if (bytes.byteLength > LOGO_MAX_BYTES) throw new ServiceError("INVALID", "The logo must be 2 MB or smaller.");
  const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format: string | undefined;
  try {
    format = (await sharp(input, { limitInputPixels: 25_000_000 }).metadata()).format;
  } catch {
    format = undefined;
  }
  if (format !== "png" && format !== "jpeg" && format !== "webp") {
    throw new ServiceError("INVALID", "Upload a PNG, JPEG or WebP image.");
  }
  let data: Buffer;
  try {
    data = await sharp(input, { limitInputPixels: 25_000_000, failOn: "error" })
      .autoOrient()
      .resize({ width: LOGO_MAX_WIDTH, height: LOGO_MAX_HEIGHT, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 90, alphaQuality: 100 })
      .toBuffer();
  } catch {
    throw new ServiceError("INVALID", "The image could not be read.");
  }
  const key = `${ctx.tenantId}/branding/logo-${randomBytes(6).toString("hex")}.webp`;
  await getStorage().put(key, data, "image/webp");
  await audit({ action: "theme.logo_upload", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Setting", entityId: key });
  return `/uploads/${key}`;
}
