import { IMAGE_MODEL, LIMITS, TEXT_MODEL, type EmbedImageResponse, type EmbedTextResponse, type ReadyResponse, type TextKind } from "@/embedder/contract";
import type { EmbedCallOptions, Embedder, EmbedderPart, PartStatus, RgbImage } from "./embedder";
import { searchMetrics } from "./metrics";

/*
 * HTTP client for the embedder service (src/embedder/server.ts).
 *
 * Request paths must never wait long for it: query embeddings time out after 150 ms, photo
 * embeddings after 2 s (EMBEDDER_TIMEOUT_QUERY_MS / EMBEDDER_TIMEOUT_IMAGE_MS). A failure or timeout
 * opens a short circuit (15 s): `status()` reports "cold", search skips the semantic retrievers and
 * answers lexically. The transition is logged once and counted (./metrics.ts). Indexing (worker)
 * passes long timeouts per call and relies on job retries.
 */

const CIRCUIT_MS = 15_000;

export type HttpEmbedderOptions = {
  url: string;
  token: string;
  queryTimeoutMs?: number;
  imageTimeoutMs?: number;
  passageTimeoutMs?: number;
  fetch?: typeof fetch;
};

export class EmbedderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbedderUnavailableError";
  }
}

function envMs(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export class HttpEmbedder implements Embedder {
  readonly textModel = TEXT_MODEL.key;
  readonly textDim = TEXT_MODEL.dim;
  readonly imageModel = IMAGE_MODEL.key;
  readonly imageDim = IMAGE_MODEL.dim;

  private readonly base: string;
  private readonly token: string;
  private readonly queryTimeoutMs: number;
  private readonly imageTimeoutMs: number;
  private readonly passageTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private downUntil = 0;
  private down = false;
  private probing: Promise<void> | null = null;

  constructor(opts: HttpEmbedderOptions) {
    this.base = opts.url.replace(/\/+$/, "");
    this.token = opts.token;
    this.queryTimeoutMs = opts.queryTimeoutMs ?? envMs("EMBEDDER_TIMEOUT_QUERY_MS", 150);
    this.imageTimeoutMs = opts.imageTimeoutMs ?? envMs("EMBEDDER_TIMEOUT_IMAGE_MS", 2000);
    this.passageTimeoutMs = opts.passageTimeoutMs ?? envMs("EMBEDDER_TIMEOUT_PASSAGE_MS", 60_000);
    this.fetchImpl = opts.fetch ?? fetch;
  }

  status(part: EmbedderPart): PartStatus {
    void part;
    return Date.now() < this.downUntil ? "cold" : "ready";
  }

  warm(part: EmbedderPart): void {
    void part;
    if (Date.now() >= this.downUntil || this.probing) return;
    // Probe /ready in the background; success closes the circuit early.
    this.probing = this.ready(1000)
      .then((r) => {
        if (r.ready) this.markUp();
      })
      .catch(() => {})
      .finally(() => (this.probing = null));
  }

  async load(part: EmbedderPart, opts: { timeoutMs?: number } = {}): Promise<void> {
    const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
    let last = "";
    for (;;) {
      try {
        const r = await this.ready(5000);
        const key = part === "text" ? "text" : part === "imageText" ? "imageText" : "image";
        if (r.parts[key] === "ready") {
          this.markUp();
          return;
        }
        last = `${part} is ${r.parts[key]}`;
      } catch (err) {
        last = err instanceof Error ? err.message : String(err);
      }
      if (Date.now() > deadline) throw new EmbedderUnavailableError(`embedder not ready: ${last}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  async embedQuery(text: string, opts: EmbedCallOptions = {}): Promise<number[]> {
    return (await this.text("query", [text], opts.timeoutMs ?? this.queryTimeoutMs))[0];
  }

  async embedPassages(texts: string[], opts: EmbedCallOptions = {}): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += LIMITS.maxTexts) out.push(...(await this.text("passage", texts.slice(i, i + LIMITS.maxTexts), opts.timeoutMs ?? this.passageTimeoutMs)));
    return out;
  }

  async embedImageQuery(text: string, opts: EmbedCallOptions = {}): Promise<number[]> {
    return (await this.text("image-query", [text], opts.timeoutMs ?? this.queryTimeoutMs))[0];
  }

  async embedImage(image: RgbImage, opts: EmbedCallOptions = {}): Promise<number[]> {
    const res = await this.call(
      "/embed/image",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-rgb", "X-Image-Width": String(image.width), "X-Image-Height": String(image.height) },
        body: image.data as unknown as BodyInit,
      },
      opts.timeoutMs ?? this.imageTimeoutMs,
    );
    const json = (await res.json()) as EmbedImageResponse;
    if (json.dim !== this.imageDim) throw new EmbedderUnavailableError(`embedder returned ${json.dim}-d image vectors, expected ${this.imageDim}`);
    return json.vector;
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private async text(kind: TextKind, texts: string[], timeoutMs: number): Promise<number[][]> {
    const res = await this.call("/embed/text", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, texts }) }, timeoutMs);
    const json = (await res.json()) as EmbedTextResponse;
    const dim = kind === "image-query" ? this.imageDim : this.textDim;
    if (json.dim !== dim || json.vectors.length !== texts.length) throw new EmbedderUnavailableError(`embedder returned unexpected vectors (${json.model}, ${json.dim}-d)`);
    return json.vectors;
  }

  private async call(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const started = performance.now();
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
    } catch (err) {
      const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      this.markDown(timeout ? `timeout after ${timeoutMs} ms on ${path}` : `unreachable (${err instanceof Error ? err.message : String(err)})`, timeout ? "timeouts" : "errors");
      throw new EmbedderUnavailableError(timeout ? "embedder timeout" : "embedder unreachable");
    }
    searchMetrics.embedCalls += 1;
    searchMetrics.embedMsTotal += performance.now() - started;
    if (!res.ok) {
      // 4xx other than 401 are caller errors (bad image…); 401/5xx mean the service is not usable.
      if (res.status === 401 || res.status >= 500) this.markDown(`HTTP ${res.status} on ${path}`, "errors");
      else searchMetrics.badRequests += 1;
      const body = await res.text().catch(() => "");
      throw new EmbedderUnavailableError(`embedder HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    if (this.down) this.markUp();
    return res;
  }

  private async ready(timeoutMs: number): Promise<ReadyResponse> {
    const res = await this.fetchImpl(`${this.base}/ready`, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    return (await res.json()) as ReadyResponse;
  }

  private markDown(reason: string, counter: "timeouts" | "errors") {
    searchMetrics[counter] += 1;
    this.downUntil = Date.now() + CIRCUIT_MS;
    if (!this.down) {
      this.down = true;
      console.warn(`[search] embedder unavailable (${reason}): semantic/photo search off for ${CIRCUIT_MS / 1000} s, lexical fallback`);
    }
  }

  private markUp() {
    this.downUntil = 0;
    if (this.down) {
      this.down = false;
      console.info("[search] embedder available again");
    }
  }
}
