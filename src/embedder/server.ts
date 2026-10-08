// Embedder service: the local AI models of smart search in their own process/container
// (docs/search.md § Architectuur, docs/deploy.md § Embedder).
//
//   node src/embedder/server.ts               serve (npm run embedder; Docker target `embedder`)
//   node src/embedder/server.ts --fetch-only  download/verify the model files and exit (npm run models:fetch,
//                                             k8s initContainer)
//
// Plain Node (built-in type stripping, no build step, no app imports). Internal only: every /embed call
// needs `Authorization: Bearer $EMBEDDER_TOKEN`; never expose it through an ingress.
//
// Env: EMBEDDER_PORT (3100), EMBEDDER_HOST (127.0.0.1; 0.0.0.0 in containers), EMBEDDER_TOKEN (required
// unless EMBEDDER_ALLOW_NO_TOKEN=1 — local development only), MODEL_CACHE_DIR, SEARCH_MODEL_DOWNLOAD,
// SEARCH_MODEL_THREADS, EMBEDDER_MAX_INFLIGHT (64 requests).
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import sharp from "sharp";
import { Batcher, OverloadedError } from "./batcher.ts";
import { IMAGE_INPUT_SIZE, IMAGE_MODEL, LIMITS, TEXT_KINDS, TEXT_MODEL, type EmbedTextRequest, type ReadyResponse } from "./contract.ts";
import { Models, modelCacheDir, type Part, type Rgb } from "./models.ts";

const PARTS: Part[] = ["text", "imageText", "image"];
const models = new Models();

const batchOpts = { maxBatch: 32, maxWaitMs: 3, maxQueue: 512 };
const batchers = {
  query: new Batcher<string, number[]>((t) => models.embedQueries(t), batchOpts),
  passage: new Batcher<string, number[]>((t) => models.embedPassages(t), { ...batchOpts, maxBatch: 16, maxQueue: 1024 }),
  "image-query": new Batcher<string, number[]>((t) => models.embedImageQueries(t), batchOpts),
  image: new Batcher<Rgb, number[]>((imgs) => models.embedImages(imgs), { maxBatch: 8, maxWaitMs: 3, maxQueue: 64 }),
};

// ─── helpers ────────────────────────────────────────────────────────────────

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(json), "Cache-Control": "no-store" });
  res.end(json);
}

function tokenOk(req: IncomingMessage): boolean {
  const expected = process.env.EMBEDDER_TOKEN ?? "";
  if (!expected) return process.env.EMBEDDER_ALLOW_NO_TOKEN === "1";
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
  if (!m) return false;
  const a = createHash("sha256").update(m[1].trim()).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

async function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > max) throw new HttpError(413, "body too large");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw new HttpError(413, "body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function readyState(): ReadyResponse {
  const parts = Object.fromEntries(PARTS.map((p) => [p, models.status(p)])) as ReadyResponse["parts"];
  return { ready: PARTS.every((p) => parts[p] === "ready"), parts, rssMb: Math.round(process.memoryUsage().rss / 1e6) };
}

async function decodeImage(req: IncomingMessage, body: Buffer): Promise<Rgb> {
  const type = (req.headers["content-type"] ?? "").split(";")[0].trim();
  if (type === "application/x-rgb") {
    const width = Number(req.headers["x-image-width"]);
    const height = Number(req.headers["x-image-height"]);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height * 3 !== body.length || width * height > 4096 * 4096) {
      throw new HttpError(400, "bad raw image dimensions");
    }
    if (width === IMAGE_INPUT_SIZE && height === IMAGE_INPUT_SIZE) return { data: new Uint8Array(body.buffer, body.byteOffset, body.byteLength), width, height };
    body = await sharp(body, { raw: { width, height, channels: 3 } }).png().toBuffer();
  } else if (!/^image\/(jpeg|png|webp|avif)$/.test(type)) {
    throw new HttpError(415, "expected image/jpeg, image/png, image/webp, image/avif or application/x-rgb");
  }
  try {
    // Squash to the model input like the SigLIP processor does (no crop).
    const { data, info } = await sharp(body, { limitInputPixels: LIMITS.maxImagePixels, failOn: "error" })
      .rotate()
      .resize(IMAGE_INPUT_SIZE, IMAGE_INPUT_SIZE, { fit: "fill" })
      .removeAlpha()
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
  } catch {
    throw new HttpError(422, "undecodable image");
  }
}

// ─── server ─────────────────────────────────────────────────────────────────

let inflight = 0;
const maxInflight = Number(process.env.EMBEDDER_MAX_INFLIGHT) || 64;

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://embedder");
  if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { status: "ok", uptime: Math.round(process.uptime()) });
  if (req.method === "GET" && url.pathname === "/ready") {
    const state = readyState();
    return send(res, state.ready ? 200 : 503, state);
  }
  if (req.method !== "POST" || (url.pathname !== "/embed/text" && url.pathname !== "/embed/image")) return send(res, 404, { error: "not found" });
  if (!tokenOk(req)) return send(res, 401, { error: "unauthorized" });
  if (inflight >= maxInflight) return send(res, 503, { error: "overloaded" });
  inflight += 1;
  try {
    if (url.pathname === "/embed/text") {
      const body = await readBody(req, LIMITS.maxTextBodyBytes);
      let parsed: EmbedTextRequest;
      try {
        parsed = JSON.parse(body.toString("utf8")) as EmbedTextRequest;
      } catch {
        throw new HttpError(400, "invalid JSON");
      }
      const { kind, texts } = parsed ?? ({} as EmbedTextRequest);
      if (!TEXT_KINDS.includes(kind)) throw new HttpError(400, "kind must be query, passage or image-query");
      if (!Array.isArray(texts) || texts.length === 0 || texts.length > LIMITS.maxTexts || texts.some((t) => typeof t !== "string")) {
        throw new HttpError(400, `texts must be 1–${LIMITS.maxTexts} strings`);
      }
      const clean = texts.map((t) => t.slice(0, LIMITS.maxTextChars));
      const vectors = await batchers[kind].push(clean);
      const model = kind === "image-query" ? IMAGE_MODEL : TEXT_MODEL;
      return send(res, 200, { model: model.key, dim: model.dim, vectors });
    }
    const body = await readBody(req, LIMITS.maxImageBytes);
    const rgb = await decodeImage(req, body);
    const [vector] = await batchers.image.push([rgb]);
    return send(res, 200, { model: IMAGE_MODEL.key, dim: IMAGE_MODEL.dim, vector });
  } finally {
    inflight -= 1;
  }
}

async function main() {
  const fetchOnly = process.argv.includes("--fetch-only");
  if (!fetchOnly && !process.env.EMBEDDER_TOKEN && process.env.EMBEDDER_ALLOW_NO_TOKEN !== "1") {
    console.error("[embedder] EMBEDDER_TOKEN is not set (set EMBEDDER_ALLOW_NO_TOKEN=1 for local development only)");
    process.exit(1);
  }
  if (fetchOnly) {
    for (const part of PARTS) await models.load(part);
    console.info(`[embedder] models present in ${modelCacheDir()}`);
    return;
  }

  const port = Number(process.env.EMBEDDER_PORT) || 3100;
  const host = process.env.EMBEDDER_HOST || "127.0.0.1";
  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (res.headersSent) return res.destroy();
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      if (err instanceof OverloadedError) return send(res, 503, { error: "overloaded" });
      console.error("[embedder] request failed:", err instanceof Error ? err.message : err);
      send(res, 500, { error: "embedding failed" });
    });
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 65_000;
  server.listen(port, host, () => console.info(`[embedder] listening on ${host}:${port}, model cache ${modelCacheDir()}`));

  // Load and warm every model at start; /ready turns 200 when all are done. Failed parts are retried.
  const loadAll = async () => {
    for (const part of PARTS) await models.load(part).catch(() => {});
    if (!readyState().ready) setTimeout(() => void loadAll(), 30_000).unref();
  };
  void loadAll();

  const shutdown = (signal: string) => {
    console.info(`[embedder] ${signal}: draining`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

void main();
