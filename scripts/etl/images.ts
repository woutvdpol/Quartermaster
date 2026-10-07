/**
 * Product photo download (Cloudflare Images → local storage) behind an interface, so the ETL can run
 * without network access and tests can use a fake. Owner decision (phase 4): do NOT download from
 * Cloudflare yet — runs record placeholder ProductImage rows (`legacyCloudflareId`, `processedAt`
 * null) and a later run with LEGACY_CF_ACCOUNT_HASH (and without --skip-images) fills them in.
 */

export type DownloadedImage = { bytes: Uint8Array; contentType: string | null };

export interface ImageDownloader {
  readonly name: string;
  download(cloudflareId: string): Promise<DownloadedImage>;
}

/**
 * Downloads the original from Cloudflare Images' delivery URL
 * `https://imagedelivery.net/{accountHash}/{imageId}/{variant}` (variant "public" by default; the
 * account must allow it for the ETL host). Not used until the real migration.
 */
export class CloudflareImageDownloader implements ImageDownloader {
  readonly name = "cloudflare";

  constructor(
    private readonly accountHash: string,
    private readonly variant = "public",
    private readonly timeoutMs = 30_000,
  ) {
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(accountHash)) throw new Error("LEGACY_CF_ACCOUNT_HASH looks invalid");
  }

  async download(cloudflareId: string): Promise<DownloadedImage> {
    const url = `https://imagedelivery.net/${this.accountHash}/${encodeURIComponent(cloudflareId)}/${encodeURIComponent(this.variant)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs), redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { bytes, contentType: res.headers.get("content-type") };
  }
}
