import type { z } from "zod";
import type { Queue } from "pg-boss";

/**
 * Typed job registry. A job = queue name + Zod payload schema + handler.
 *
 * Job definition modules must stay light (zod + lazy `await import()` of heavy code inside the
 * handler), because `enqueue()` loads every definition to validate payloads, also inside Next.js.
 */

export type JobRunContext = {
  jobId: string;
  /** 0 on the first attempt. */
  retryCount: number;
  retryLimit: number;
  /** True when a failure now is final (no retries left) — use for failure bookkeeping. */
  isFinalAttempt: boolean;
  signal: AbortSignal;
};

/** Queue options applied when the worker creates/updates the queue. */
export type JobQueueOptions = Omit<Queue, "name">;

export type JobDefinition<N extends string = string, S extends z.ZodType = z.ZodType> = {
  name: N;
  schema: S;
  handler: (payload: z.output<S>, ctx: JobRunContext) => Promise<unknown>;
  queue: JobQueueOptions;
  /** Parallel handlers per worker process. */
  concurrency: number;
};

const DEFAULT_QUEUE: JobQueueOptions = {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  retryDelayMax: 60 * 60,
  expireInSeconds: 15 * 60,
};

const registry = new Map<string, JobDefinition>();

export function defineJob<const N extends string, S extends z.ZodType>(
  name: N,
  schema: S,
  handler: (payload: z.output<S>, ctx: JobRunContext) => Promise<unknown>,
  options: { queue?: JobQueueOptions; concurrency?: number } = {},
): JobDefinition<N, S> {
  if (!/^[\w.\-]+$/.test(name)) throw new Error(`Invalid job name: ${name}`);
  const def: JobDefinition<N, S> = {
    name,
    schema,
    handler,
    queue: { ...DEFAULT_QUEUE, ...options.queue },
    concurrency: options.concurrency ?? 1,
  };
  const existing = registry.get(name);
  if (existing && existing.handler !== handler) {
    // Dev hot reload re-evaluates modules; keep the newest definition.
    console.warn(`[jobs] redefining job "${name}"`);
  }
  registry.set(name, def as unknown as JobDefinition);
  return def;
}

export function getJobDefinition(name: string): JobDefinition | undefined {
  return registry.get(name);
}

export function listJobDefinitions(): JobDefinition[] {
  return [...registry.values()];
}

export function retryLimitOf(def: JobDefinition): number {
  return def.queue.retryLimit ?? DEFAULT_QUEUE.retryLimit!;
}
