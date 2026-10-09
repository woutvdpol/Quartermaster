import { LIMITS, type TranslateResponse, type TranslateTarget } from "@/embedder/contract";

/*
 * Client for the embedder's /translate endpoint (src/embedder/server.ts, Opus-MT). Same service,
 * URL and token as smart search (EMBEDDER_URL, EMBEDDER_TOKEN). Without EMBEDDER_URL there is no
 * translator: rows stay QUEUED until one is configured (saving a product never depends on it).
 *
 * Calls run from the worker (job `translations.translate`) and from the admin's "Translate again";
 * the first call per language loads the model in the embedder (a few seconds), hence the long timeout
 * (EMBEDDER_TIMEOUT_TRANSLATE_MS, default 120 s).
 */

export interface Translator {
  /** Translates English sentences (already prepared by ./text.ts) into `locale`, same order. */
  translate(locale: TranslateTarget, texts: string[], opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<string[]>;
}

export class TranslatorUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslatorUnavailableError";
  }
}

export class HttpTranslator implements Translator {
  private readonly base: string;
  constructor(
    url: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = Number(process.env.EMBEDDER_TIMEOUT_TRANSLATE_MS) || 120_000,
  ) {
    this.base = url.replace(/\/+$/, "");
  }

  async translate(locale: TranslateTarget, texts: string[], opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < texts.length; i += LIMITS.maxTranslateTexts) {
      out.push(...(await this.call(locale, texts.slice(i, i + LIMITS.maxTranslateTexts), opts)));
    }
    return out;
  }

  private async call(target: TranslateTarget, texts: string[], opts: { timeoutMs?: number; signal?: AbortSignal }): Promise<string[]> {
    const signals = [AbortSignal.timeout(opts.timeoutMs ?? this.timeoutMs), ...(opts.signal ? [opts.signal] : [])];
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ target, texts: texts.map((t) => t.slice(0, LIMITS.maxTranslateChars)) }),
        signal: AbortSignal.any(signals),
      });
    } catch (err) {
      throw new TranslatorUnavailableError(`translator unreachable: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.status === 503 || res.status >= 500) throw new TranslatorUnavailableError(`translator answered ${res.status}`);
    if (!res.ok) throw new Error(`translator rejected the request (${res.status}): ${await res.text().catch(() => "")}`);
    const body = (await res.json()) as TranslateResponse;
    if (!Array.isArray(body.translations) || body.translations.length !== texts.length) throw new Error("translator returned a malformed response");
    return body.translations;
  }
}

const g = globalThis as unknown as { qmTranslator?: Translator | null; qmTranslatorOverride?: Translator | null };

/** The process-wide translator, or null when no embedder is configured (and under Vitest by default). */
export function getTranslator(): Translator | null {
  if (g.qmTranslatorOverride !== undefined) return g.qmTranslatorOverride;
  if (process.env.VITEST || !process.env.EMBEDDER_URL) return null;
  g.qmTranslator ??= new HttpTranslator(process.env.EMBEDDER_URL, process.env.EMBEDDER_TOKEN ?? "");
  return g.qmTranslator;
}

/** Tests: install a fake translator (null = none); `undefined` restores the default. */
export function setTranslatorForTests(translator: Translator | null | undefined): void {
  g.qmTranslatorOverride = translator;
}
