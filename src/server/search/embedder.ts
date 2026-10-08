import { IMAGE_MODEL, TEXT_MODEL, l2normalize } from "@/embedder/contract";

/*
 * The embedding models behind smart search, as a client interface. The models themselves run in the
 * separate embedder service (src/embedder/server.ts — own container, docs/deploy.md § Embedder);
 * web and worker talk to it over HTTP (./http-embedder.ts). Tests and CI use a deterministic fake
 * (./fake-embedder.ts) and never download a model.
 *
 * Without EMBEDDER_URL there is no embedder: search is lexical + facets only (e.g. `npm run dev`
 * without `npm run embedder`).
 */

export { TEXT_MODEL, IMAGE_MODEL, l2normalize };

/** Decoded RGB pixels (3 channels, row-major), e.g. from sharp `.removeAlpha().raw()`. */
export type RgbImage = { data: Uint8Array; width: number; height: number };

/** Model parts: e5 text, SigLIP text tower (text → photo space), SigLIP vision tower. */
export type EmbedderPart = "text" | "imageText" | "image";

/**
 * "ready": usable now. "cold": not available right now (service down, slow or still loading) —
 * request paths skip it and fall back. "disabled": no embedder configured.
 */
export type PartStatus = "cold" | "loading" | "ready" | "failed" | "disabled";

export type EmbedCallOptions = {
  /** Overrides the client's default timeout for this call (ms). */
  timeoutMs?: number;
};

export interface Embedder {
  readonly textModel: string;
  readonly textDim: number;
  readonly imageModel: string;
  readonly imageDim: number;
  /** Whether a part can be used on a request path right now (no I/O). */
  status(part: EmbedderPart): PartStatus;
  /** Triggers a background availability check (no-op when not needed). */
  warm(part: EmbedderPart): void;
  /** Waits until a part is available (worker, scripts). Throws when it does not become available. */
  load(part: EmbedderPart, opts?: { timeoutMs?: number }): Promise<void>;
  /** e5 query embedding (L2-normalised). */
  embedQuery(text: string, opts?: EmbedCallOptions): Promise<number[]>;
  /** e5 passage embeddings (L2-normalised), one per text. */
  embedPassages(texts: string[], opts?: EmbedCallOptions): Promise<number[][]>;
  /** SigLIP text tower: a text query in the photo space. */
  embedImageQuery(text: string, opts?: EmbedCallOptions): Promise<number[]>;
  /** SigLIP vision tower. */
  embedImage(image: RgbImage, opts?: EmbedCallOptions): Promise<number[]>;
}

const globalForEmbedder = globalThis as unknown as { qmEmbedder?: Embedder | null; qmEmbedderOverride?: Embedder | null };

/** Semantic search switched off for this process (env SEARCH_SEMANTIC=off) → lexical only. */
export function semanticDisabled(): boolean {
  return process.env.SEARCH_SEMANTIC === "off" || process.env.SEARCH_SEMANTIC === "0";
}

/**
 * The process-wide embedder client: HTTP to EMBEDDER_URL, or null (no embedder configured, semantic
 * search off, or under Vitest unless a test installs one with `setEmbedderForTests`).
 */
export async function getEmbedder(): Promise<Embedder | null> {
  if (globalForEmbedder.qmEmbedderOverride !== undefined) return globalForEmbedder.qmEmbedderOverride;
  if (semanticDisabled() || process.env.VITEST || !process.env.EMBEDDER_URL) return null;
  if (globalForEmbedder.qmEmbedder === undefined) {
    const { HttpEmbedder } = await import("./http-embedder");
    globalForEmbedder.qmEmbedder = new HttpEmbedder({ url: process.env.EMBEDDER_URL, token: process.env.EMBEDDER_TOKEN ?? "" });
  }
  return globalForEmbedder.qmEmbedder;
}

/** Tests: install a fake embedder (or null for "no embedder"); `undefined` restores the default. */
export function setEmbedderForTests(embedder: Embedder | null | undefined): void {
  globalForEmbedder.qmEmbedderOverride = embedder;
}

/** pgvector literal for a vector parameter: '[0.1,0.2,…]' (cast with ::vector(n) in SQL). */
export function toVectorLiteral(v: readonly number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? Number(x.toFixed(7)) : 0)).join(",")}]`;
}
