/*
 * Upload transport limit (client + route handler). Matches the media service's 25 MB limit;
 * next.config.ts raises `experimental.proxyClientMaxBodySize` to 26 MB because src/proxy.ts runs
 * on /admin/** and would otherwise truncate bodies above 10 MB.
 */
export const UPLOAD_TRANSPORT_MAX_BYTES = 25 * 1024 * 1024;

/** JSON body of POST /admin/inventory/[id]/images. */
export type UploadResponse =
  | { ok: true; images: { id: string; url: string; name: string; alt: string | null }[] }
  | { ok: false; message: string };
