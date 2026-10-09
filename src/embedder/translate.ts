import { TRANSLATE_MODELS, type TranslateTarget } from "./contract.ts";
import { lib, modelCacheDir, downloadAllowed, sessionOptions } from "./models.ts";

/*
 * Machine translation EN → NL/DE inside the embedder (Opus-MT, MarianMT ONNX int8 via transformers.js).
 *
 * - Lazy: a language model loads on its first /translate call (≈ 1–4 s from disk, +≈ 0.4–0.5 GB RSS
 *   with its inference arenas) and is disposed after TRANSLATE_IDLE_MINUTES without use (default 15;
 *   0 = never unload), so a shop that does not translate pays nothing.
 * - At most TRANSLATE_MAX_MODELS (default 1) stay loaded: loading NL unloads an idle DE model. The
 *   worker translates one language after the other, so a bulk run swaps once; keeps the container
 *   within its memory limit (deploy/k8s/base/embedder.yaml). Set 2 when memory allows.
 * - Input: sentences prepared by the app (src/server/translations/text.ts) — Markdown structure, codes,
 *   URLs and glossary terms are already replaced by placeholders, so this side only translates.
 * - Greedy decoding (transformers.js); measured ≈ 60–80 ms per sentence in a batch of 4 on an M-series
 *   Mac (docs/i18n.md § Prestaties).
 */

type Pipe = ((texts: string[], opts: Record<string, unknown>) => Promise<{ translation_text: string }[]>) & { dispose?: () => Promise<void> };
type Status = "cold" | "loading" | "ready" | "failed";

type Slot = { status: Status; pipe: Pipe | null; promise: Promise<Pipe> | null; inflight: number; lastUsed: number; error: string | null };

function maxModels(): number {
  const n = Number(process.env.TRANSLATE_MAX_MODELS);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

function idleMs(): number {
  const raw = process.env.TRANSLATE_IDLE_MINUTES;
  const min = raw === undefined || raw === "" ? 15 : Number(raw);
  return Number.isFinite(min) && min > 0 ? min * 60_000 : 0;
}

export class Translators {
  private slots: Record<TranslateTarget, Slot> = {
    nl: { status: "cold", pipe: null, promise: null, inflight: 0, lastUsed: 0, error: null },
    de: { status: "cold", pipe: null, promise: null, inflight: 0, lastUsed: 0, error: null },
  };
  private sweeper: ReturnType<typeof setInterval> | null = null;

  status(target: TranslateTarget): Status {
    return this.slots[target].status;
  }

  statuses(): Record<TranslateTarget, Status> {
    return { nl: this.slots.nl.status, de: this.slots.de.status };
  }

  /** Loads (idempotent; a failed load is retried on the next call). */
  load(target: TranslateTarget): Promise<Pipe> {
    const s = this.slots[target];
    if (s.pipe) return Promise.resolve(s.pipe);
    if (s.promise) return s.promise;
    const started = Date.now();
    s.status = "loading";
    s.promise = (async () => {
      await this.makeRoom(target);
      const t = await lib();
      const model = TRANSLATE_MODELS[target];
      const pipe = (await t.pipeline("translation", model.id, { dtype: model.dtype, session_options: sessionOptions() })) as unknown as Pipe;
      await pipe(["Warm-up."], { max_new_tokens: 8 });
      return pipe;
    })().then(
      (pipe) => {
        s.pipe = pipe;
        s.status = "ready";
        s.promise = null;
        s.error = null;
        s.lastUsed = Date.now();
        console.info(`[embedder] translate-${target} ready in ${Date.now() - started} ms (rss ${Math.round(process.memoryUsage().rss / 1e6)} MB)`);
        this.startSweeper();
        return pipe;
      },
      (err: unknown) => {
        s.status = "failed";
        s.promise = null;
        s.error = err instanceof Error ? err.message : String(err);
        console.error(`[embedder] translate-${target} failed to load (cache ${modelCacheDir()}, download ${downloadAllowed() ? "on" : "off"}): ${s.error}`);
        throw err;
      },
    );
    return s.promise;
  }

  async translate(target: TranslateTarget, texts: string[]): Promise<string[]> {
    const s = this.slots[target];
    s.inflight += 1;
    try {
      const pipe = await this.load(target);
      // One call per unit, each with its own token budget: a shared budget sized for the longest
      // sentence let short ones run on ("Kleidung............"). The repetition guards stop loops;
      // ~0.1 s per sentence on CPU, so batching isn't worth the degenerate output.
      const results: string[] = [];
      for (const text of texts) {
        const out = await pipe([text], {
          max_new_tokens: Math.min(512, Math.ceil(text.length / 2.5) + 8),
          repetition_penalty: 1.15,
          no_repeat_ngram_size: 4,
        });
        results.push(out[0]?.translation_text ?? "");
      }
      return results;
    } finally {
      s.inflight -= 1;
      s.lastUsed = Date.now();
    }
  }

  /** --fetch-only: download/verify the files, then free the memory again. */
  async fetch(target: TranslateTarget): Promise<void> {
    await this.load(target);
    await this.unload(target);
  }

  /** Unloads idle other models until a new one fits under TRANSLATE_MAX_MODELS. */
  private async makeRoom(target: TranslateTarget) {
    const others = (Object.keys(this.slots) as TranslateTarget[]).filter((t) => t !== target && this.slots[t].pipe);
    let loaded = others.length;
    for (const other of others.sort((a, b) => this.slots[a].lastUsed - this.slots[b].lastUsed)) {
      if (loaded < maxModels()) break;
      if (this.slots[other].inflight > 0) continue;
      await this.unload(other);
      loaded -= 1;
      console.info(`[embedder] translate-${other} unloaded to make room for ${target}`);
    }
  }

  private async unload(target: TranslateTarget) {
    const s = this.slots[target];
    const pipe = s.pipe;
    if (!pipe) return;
    s.pipe = null;
    s.status = "cold";
    try {
      await pipe.dispose?.();
    } catch {
      // ignore: the sessions are released with the object anyway
    }
  }

  private startSweeper() {
    const ms = idleMs();
    if (!ms || this.sweeper) return;
    this.sweeper = setInterval(() => {
      for (const target of Object.keys(this.slots) as TranslateTarget[]) {
        const s = this.slots[target];
        if (s.pipe && s.inflight === 0 && Date.now() - s.lastUsed > ms) {
          void this.unload(target).then(() => console.info(`[embedder] translate-${target} unloaded after idle (rss ${Math.round(process.memoryUsage().rss / 1e6)} MB)`));
        }
      }
    }, Math.min(ms, 60_000));
    this.sweeper.unref();
  }
}
