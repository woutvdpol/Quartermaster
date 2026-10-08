/*
 * Contract between the embedder service (src/embedder/server.ts, its own container) and its clients
 * (web + worker: src/server/search/http-embedder.ts). Pure, no imports — loaded by Node directly
 * (type stripping) inside the embedder image and through the `@/embedder/contract` alias by the app.
 *
 *   GET  /health          liveness (process up)
 *   GET  /ready           200 only when every model is loaded and warm
 *   POST /embed/text      {"kind": "query"|"passage"|"image-query", "texts": string[]}
 *                         → {"model", "dim", "vectors": number[][]}
 *   POST /embed/image     body = photo bytes (image/jpeg|png|webp) or raw RGB
 *                         (application/x-rgb + X-Image-Width/X-Image-Height) → {"model", "dim", "vector"}
 *   Auth: `Authorization: Bearer <EMBEDDER_TOKEN>` on every /embed call.
 *
 * Models (docs/search.md § Modellen):
 *   text   Xenova/multilingual-e5-small (int8, 384-d, MIT) — "query: " / "passage: " prefixes
 *   image  onnx-community/siglip2-base-patch16-224-ONNX (int8, 768-d, Apache-2.0) — multilingual
 *          SigLIP 2: one space for product photos, uploaded photos and text → photo queries
 */

export const TEXT_MODEL = { id: "Xenova/multilingual-e5-small", dtype: "q8", dim: 384, key: "multilingual-e5-small@q8" } as const;
export const IMAGE_MODEL = { id: "onnx-community/siglip2-base-patch16-224-ONNX", dtype: "q8", dim: 768, key: "siglip2-base-patch16-224@q8" } as const;

export type TextKind = "query" | "passage" | "image-query";
export const TEXT_KINDS: readonly TextKind[] = ["query", "passage", "image-query"];

export type EmbedTextRequest = { kind: TextKind; texts: string[] };
export type EmbedTextResponse = { model: string; dim: number; vectors: number[][] };
export type EmbedImageResponse = { model: string; dim: number; vector: number[] };
export type ReadyResponse = { ready: boolean; parts: Record<"text" | "imageText" | "image", "cold" | "loading" | "ready" | "failed">; rssMb: number };

/** Request limits (enforced by the server; clients stay below them). */
export const LIMITS = {
  maxTexts: 64,
  maxTextChars: 2000,
  maxTextBodyBytes: 512 * 1024,
  maxImageBytes: 10 * 1024 * 1024,
  maxImagePixels: 40_000_000,
} as const;

/** SigLIP input size (the server resizes; clients may pre-shrink to save bandwidth). */
export const IMAGE_INPUT_SIZE = 224;

export function l2normalize(v: ArrayLike<number>): number[] {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s) || 1;
  return Array.from(v, (x) => x / n);
}
