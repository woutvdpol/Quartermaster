import { LEAD_PHOTO_FILE } from "./validation";

/*
 * Lead photo keys (pure). Files: `{tenantId}/leads/{leadId}/p{rand}_{w}x{h}.jpg` plus a 320px
 * thumbnail `…/p{rand}_{w}x{h}_t.webp`. Served by the generic /uploads/[...path] route.
 */

export type LeadPhoto = { key: string; width: number; height: number; bytes: number };

export function leadFolder(tenantId: string, leadId: string): string {
  return `${tenantId}/leads/${leadId}/`;
}

export function thumbKeyFor(key: string): string {
  return key.replace(/\.jpg$/, "_t.webp");
}

export function photoUrl(key: string): string {
  return `/uploads/${key}`;
}

/** Full storage key for a photo file name sent back by the client, or null when it isn't one. */
export function leadPhotoKey(tenantId: string, leadId: string, file: string): string | null {
  return LEAD_PHOTO_FILE.test(file) ? `${leadFolder(tenantId, leadId)}${file}` : null;
}

export function photoDimensions(file: string): { width: number; height: number } {
  const m = /_(\d+)x(\d+)\.jpg$/.exec(file);
  return { width: m ? Number(m[1]) : 0, height: m ? Number(m[2]) : 0 };
}

/** Reads `Lead.photos` JSON defensively. */
export function parseLeadPhotos(json: unknown): LeadPhoto[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((p) => {
    if (!p || typeof p !== "object") return [];
    const { key, width, height, bytes } = p as Record<string, unknown>;
    return typeof key === "string" ? [{ key, width: Number(width) || 0, height: Number(height) || 0, bytes: Number(bytes) || 0 }] : [];
  });
}
