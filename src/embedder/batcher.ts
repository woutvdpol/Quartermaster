/*
 * Micro-batching with back-pressure for the embedder service (pure, unit-tested).
 *
 * Requests add their items to a queue; one batch per model runs at a time (onnxruntime already uses
 * every core for one batch — parallel batches would only fight over them). A batch starts when the
 * previous one finished, after at most `maxWaitMs`, with up to `maxBatch` items, so concurrent search
 * queries share one inference call. When more than `maxQueue` items wait, new requests are refused
 * (the client falls back to lexical search instead of piling up latency).
 */

export class OverloadedError extends Error {
  constructor() {
    super("embedder overloaded");
    this.name = "OverloadedError";
  }
}

type Pending<I, O> = { items: I[]; resolve: (out: O[]) => void; reject: (err: unknown) => void };

export type BatcherOptions = { maxBatch: number; maxWaitMs: number; maxQueue: number };

export class Batcher<I, O> {
  private readonly run: (items: I[]) => Promise<O[]>;
  private readonly opts: BatcherOptions;
  private queue: Pending<I, O>[] = [];
  private queued = 0;
  private busy = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(run: (items: I[]) => Promise<O[]>, opts: BatcherOptions) {
    this.run = run;
    this.opts = opts;
  }

  /** Items waiting (not yet running). */
  get depth(): number {
    return this.queued;
  }

  push(items: I[]): Promise<O[]> {
    if (!items.length) return Promise.resolve([]);
    if (this.queued + items.length > this.opts.maxQueue) return Promise.reject(new OverloadedError());
    return new Promise<O[]>((resolve, reject) => {
      this.queue.push({ items, resolve, reject });
      this.queued += items.length;
      this.schedule();
    });
  }

  private schedule() {
    if (this.busy || this.timer || !this.queue.length) return;
    if (this.queued >= this.opts.maxBatch) {
      void this.flush();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.opts.maxWaitMs);
  }

  private async flush() {
    if (this.busy || !this.queue.length) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Take whole requests until the batch is full (a request larger than maxBatch runs alone).
    const batch: Pending<I, O>[] = [];
    let n = 0;
    while (this.queue.length && (n === 0 || n + this.queue[0].items.length <= this.opts.maxBatch)) {
      const p = this.queue.shift()!;
      batch.push(p);
      n += p.items.length;
    }
    this.queued -= n;
    this.busy = true;
    try {
      const out = await this.run(batch.flatMap((p) => p.items));
      let offset = 0;
      for (const p of batch) {
        p.resolve(out.slice(offset, offset + p.items.length));
        offset += p.items.length;
      }
    } catch (err) {
      for (const p of batch) p.reject(err);
    } finally {
      this.busy = false;
      // Whatever queued meanwhile has waited long enough: run it right away.
      if (this.queue.length) void this.flush();
    }
  }
}
