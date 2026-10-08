import { createHash } from "node:crypto";
import { lexemes } from "./normalize";
import { IMAGE_MODEL, TEXT_MODEL, l2normalize, type Embedder, type EmbedderPart, type PartStatus, type RgbImage } from "./embedder";

/*
 * Deterministic stand-in for the real models (tests, CI, local runs without model files).
 * Text: a bag-of-words hashing vector — texts that share words are close, which is enough to test
 * indexing, fusion and filters. Image: pixels are averaged per channel and spread over the vector,
 * so similar colours are close. Same dimensions/model keys as the real models so the SQL (casts to
 * vector(384)/vector(768), HNSW indexes) runs unchanged.
 */

function bucket(word: string, dim: number): { i: number; sign: number } {
  const h = createHash("sha1").update(word).digest();
  return { i: h.readUInt32BE(0) % dim, sign: h[4] & 1 ? 1 : -1 };
}

export function hashTextVector(text: string, dim: number): number[] {
  const v: number[] = new Array<number>(dim).fill(0);
  for (const w of lexemes(text.replace(/^(query|passage): /, ""))) {
    const { i, sign } = bucket(w, dim);
    v[i] += sign;
  }
  if (!v.some((x) => x !== 0)) v[0] = 1;
  return l2normalize(v);
}

export function colorVector(image: RgbImage, dim: number): number[] {
  const sums = [0, 0, 0];
  const px = image.width * image.height;
  for (let i = 0; i < px; i++) for (let c = 0; c < 3; c++) sums[c] += image.data[i * 3 + c];
  const mean = sums.map((s) => s / Math.max(1, px) / 255);
  return l2normalize(Array.from({ length: dim }, (_, i) => mean[i % 3] + 0.01));
}

export type FakeEmbedderOptions = {
  /** Parts reported as not ready (to test the lexical fallback). */
  cold?: EmbedderPart[];
  /** Override vectors for specific texts (exact match, without prefix). */
  imageQueryVectors?: Record<string, number[]>;
  /** Called for every embed call (assert what was embedded). */
  onEmbed?: (kind: "query" | "passage" | "imageQuery" | "image", input: string | RgbImage) => void;
};

export function createFakeEmbedder(opts: FakeEmbedderOptions = {}): Embedder {
  const cold = new Set(opts.cold ?? []);
  return {
    textModel: TEXT_MODEL.key,
    textDim: TEXT_MODEL.dim,
    imageModel: IMAGE_MODEL.key,
    imageDim: IMAGE_MODEL.dim,
    status: (part): PartStatus => (cold.has(part) ? "cold" : "ready"),
    warm: () => {},
    load: async (part) => {
      if (cold.has(part)) throw new Error(`fake embedder: ${part} is cold`);
    },
    embedQuery: async (text) => {
      opts.onEmbed?.("query", text);
      return hashTextVector(text, TEXT_MODEL.dim);
    },
    embedPassages: async (texts) => {
      for (const t of texts) opts.onEmbed?.("passage", t);
      return texts.map((t) => hashTextVector(t, TEXT_MODEL.dim));
    },
    embedImageQuery: async (text) => {
      opts.onEmbed?.("imageQuery", text);
      return opts.imageQueryVectors?.[text] ?? hashTextVector(text, IMAGE_MODEL.dim);
    },
    embedImage: async (image) => {
      opts.onEmbed?.("image", image);
      return colorVector(image, IMAGE_MODEL.dim);
    },
  };
}
