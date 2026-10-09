import path from "node:path";
import { IMAGE_MODEL, TEXT_MODEL, l2normalize } from "./contract.ts";

/*
 * The models inside the embedder service: transformers.js (`@huggingface/transformers`,
 * onnxruntime-node on the CPU). Never imported by the web app or the worker.
 *
 * - Model files live in MODEL_CACHE_DIR (default `.local/models`; a volume in Docker/k8s). Missing files
 *   are downloaded from Hugging Face unless SEARCH_MODEL_DOWNLOAD=0 (air-gapped: pre-fill the volume
 *   with `npm run models:fetch`).
 * - Measured on an M-series Mac (docs/search.md § Geheugen): load from disk e5 ≈ 0.7 s, SigLIP text ≈ 1 s,
 *   vision ≈ 0.1 s; RSS ≈ 0.8 GB with e5 (its 250k-token tokenizer), ≈ 1.25 GB with all three parts.
 * - SEARCH_MODEL_THREADS caps onnxruntime intra-op threads per session (default: runtime choice).
 */

type T = typeof import("@huggingface/transformers");

export type Part = "text" | "imageText" | "image";
export type PartStatus = "cold" | "loading" | "ready" | "failed";

export function modelCacheDir(): string {
  const dir = process.env.MODEL_CACHE_DIR?.trim();
  return dir ? path.resolve(dir) : path.join(process.cwd(), ".local", "models");
}

export function downloadAllowed(): boolean {
  return process.env.SEARCH_MODEL_DOWNLOAD !== "0" && process.env.SEARCH_MODEL_DOWNLOAD !== "false";
}

let libPromise: Promise<T> | null = null;
export function lib(): Promise<T> {
  libPromise ??= import("@huggingface/transformers").then((t) => {
    // Download cache and "local models" folder are the same directory (<dir>/<model id>/…), so files
    // fetched once are found again without network access.
    t.env.cacheDir = modelCacheDir();
    t.env.localModelPath = modelCacheDir();
    t.env.useFSCache = true;
    t.env.allowLocalModels = true;
    t.env.allowRemoteModels = downloadAllowed();
    return t;
  });
  return libPromise;
}

export function sessionOptions() {
  const threads = Number(process.env.SEARCH_MODEL_THREADS);
  return Number.isInteger(threads) && threads > 0 ? { intraOpNumThreads: threads, interOpNumThreads: 1 } : undefined;
}

type Pooled = { tolist(): unknown };
type TextParts = { extract: (texts: string[], opts: { pooling: "mean"; normalize: boolean }) => Promise<Pooled> };
type ModelOut = { pooler_output: { data: ArrayLike<number>; dims: number[] } };
type ImageTextParts = { tokenizer: (texts: string[], opts: Record<string, unknown>) => unknown; model: (inputs: unknown) => Promise<ModelOut> };
type ImageParts = { processor: (images: unknown) => Promise<unknown>; model: (inputs: unknown) => Promise<ModelOut>; RawImage: T["RawImage"] };

export type Rgb = { data: Uint8Array; width: number; height: number };

/** Splits a [n, dim] pooled output into n L2-normalised vectors. */
function rows(out: ModelOut): number[][] {
  const [n, dim] = out.pooler_output.dims;
  const data = out.pooler_output.data;
  const result: number[][] = [];
  for (let i = 0; i < n; i++) result.push(l2normalize(Array.prototype.slice.call(data, i * dim, (i + 1) * dim) as number[]));
  return result;
}

export class Models {
  private parts: Record<Part, { status: PartStatus; value: unknown; promise: Promise<unknown> | null; error: string | null }> = {
    text: { status: "cold", value: null, promise: null, error: null },
    imageText: { status: "cold", value: null, promise: null, error: null },
    image: { status: "cold", value: null, promise: null, error: null },
  };

  status(part: Part): PartStatus {
    return this.parts[part].status;
  }

  error(part: Part): string | null {
    return this.parts[part].error;
  }

  /** Loads a part (idempotent; a failed part is retried on the next call). */
  load(part: Part): Promise<unknown> {
    const p = this.parts[part];
    if (p.value) return Promise.resolve(p.value);
    if (p.promise) return p.promise;
    const started = Date.now();
    p.status = "loading";
    p.promise = this.loadPart(part).then(
      (value) => {
        p.value = value;
        p.status = "ready";
        p.promise = null;
        p.error = null;
        console.info(`[embedder] ${part} ready in ${Date.now() - started} ms (rss ${Math.round(process.memoryUsage().rss / 1e6)} MB)`);
        return value;
      },
      (err: unknown) => {
        p.status = "failed";
        p.promise = null;
        p.error = err instanceof Error ? err.message : String(err);
        console.error(`[embedder] ${part} failed to load (cache ${modelCacheDir()}, download ${downloadAllowed() ? "on" : "off"}): ${p.error}`);
        throw err;
      },
    );
    return p.promise;
  }

  async embedQueries(texts: string[]): Promise<number[][]> {
    const p = (await this.load("text")) as TextParts;
    return (await p.extract(texts.map((t) => `query: ${t}`), { pooling: "mean", normalize: true })).tolist() as number[][];
  }

  async embedPassages(texts: string[]): Promise<number[][]> {
    const p = (await this.load("text")) as TextParts;
    return (await p.extract(texts.map((t) => `passage: ${t}`), { pooling: "mean", normalize: true })).tolist() as number[][];
  }

  /** SigLIP text tower (text → photo space). Trained with max_length padding (64 tokens). */
  async embedImageQueries(texts: string[]): Promise<number[][]> {
    const p = (await this.load("imageText")) as ImageTextParts;
    const inputs = p.tokenizer(texts, { padding: "max_length", max_length: 64, truncation: true });
    return rows(await p.model(inputs));
  }

  /** SigLIP vision tower; batch of decoded RGB images. */
  async embedImages(images: Rgb[]): Promise<number[][]> {
    const p = (await this.load("image")) as ImageParts;
    const raws = images.map((img) => new p.RawImage(new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength), img.width, img.height, 3));
    const inputs = await p.processor(raws);
    return rows(await p.model(inputs));
  }

  private async loadPart(part: Part): Promise<unknown> {
    const t = await lib();
    const session_options = sessionOptions();
    if (part === "text") {
      const extract = await t.pipeline("feature-extraction", TEXT_MODEL.id, { dtype: TEXT_MODEL.dtype, session_options });
      // Warm-up: the first inference allocates the ORT arenas.
      await (extract as unknown as TextParts["extract"])(["query: warm-up"], { pooling: "mean", normalize: true });
      return { extract } as unknown as TextParts;
    }
    if (part === "imageText") {
      const [tokenizer, model] = await Promise.all([
        t.AutoTokenizer.from_pretrained(IMAGE_MODEL.id),
        t.SiglipTextModel.from_pretrained(IMAGE_MODEL.id, { dtype: IMAGE_MODEL.dtype, session_options }),
      ]);
      const parts = { tokenizer, model } as unknown as ImageTextParts;
      await parts.model(parts.tokenizer(["warm-up"], { padding: "max_length", max_length: 64, truncation: true }));
      return parts;
    }
    const [processor, model] = await Promise.all([
      t.AutoProcessor.from_pretrained(IMAGE_MODEL.id),
      t.SiglipVisionModel.from_pretrained(IMAGE_MODEL.id, { dtype: IMAGE_MODEL.dtype, session_options }),
    ]);
    const parts = { processor, model, RawImage: t.RawImage } as unknown as ImageParts;
    const blank = new Uint8ClampedArray(224 * 224 * 3).fill(128);
    await parts.model(await parts.processor([new parts.RawImage(blank, 224, 224, 3)]));
    return parts;
  }
}
