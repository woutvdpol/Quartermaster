import "server-only";
import { fromPrisma } from "pg-boss";
import type { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getBoss } from "./boss";
import { JOBS, type JobName } from "./definitions";
import { retryLimitOf, type JobRunContext } from "./registry";

export type { JobName } from "./definitions";
export type JobPayload<N extends JobName> = z.input<(typeof JOBS)[N]["schema"]>;

export type EnqueueOptions = {
  /** Create the job inside this Prisma transaction: it only exists if the transaction commits. */
  tx?: Prisma.TransactionClient;
  startAfter?: number | string | Date;
  singletonKey?: string;
  priority?: number;
};

export type EnqueuedJob = { name: JobName; data: unknown; options: Omit<EnqueueOptions, "tx"> & { inTransaction: boolean } };
type TestTransport = (job: EnqueuedJob) => void | Promise<void>;

let testTransport: TestTransport | null = null;
const ensuredQueues = new Set<string>();

/**
 * Route enqueued jobs to a function instead of pg-boss (tests). Pass null to restore.
 * Combine with `runJobNow()` to execute captured jobs without a worker.
 */
export function setJobTransportForTests(transport: TestTransport | null) {
  testTransport = transport;
}

async function ensureQueue(name: JobName) {
  if (ensuredQueues.has(name)) return;
  const boss = await getBoss();
  await boss.createQueue(name, JOBS[name].queue); // idempotent (ON CONFLICT DO NOTHING)
  ensuredQueues.add(name);
}

function parsePayload<N extends JobName>(name: N, payload: unknown) {
  const def = JOBS[name];
  if (!def) throw new Error(`Unknown job: ${name}`);
  return def.schema.parse(payload) as object;
}

/** Validates the payload against the job's schema and queues it. Returns the job id (null when deduplicated). */
export async function enqueue<N extends JobName>(name: N, payload: JobPayload<N>, opts: EnqueueOptions = {}): Promise<string | null> {
  const data = parsePayload(name, payload);
  const { tx, ...options } = opts;
  if (testTransport) {
    await testTransport({ name, data, options: { ...options, inTransaction: !!tx } });
    return `test-${name}-${Math.random().toString(36).slice(2)}`;
  }
  await ensureQueue(name);
  const boss = await getBoss();
  return boss.send(name, data, { ...options, ...(tx ? { db: fromPrisma(tx) } : {}) });
}

/** Queues many jobs of one kind in a single insert (fan-out). */
export async function enqueueMany<N extends JobName>(
  name: N,
  payloads: JobPayload<N>[],
  opts: Pick<EnqueueOptions, "tx" | "startAfter"> = {},
): Promise<void> {
  if (payloads.length === 0) return;
  const rows = payloads.map((p) => parsePayload(name, p));
  const { tx, ...options } = opts;
  if (testTransport) {
    for (const data of rows) await testTransport({ name, data, options: { ...options, inTransaction: !!tx } });
    return;
  }
  await ensureQueue(name);
  const boss = await getBoss();
  await boss.insert(
    name,
    rows.map((data) => ({ data, startAfter: options.startAfter })),
    tx ? { db: fromPrisma(tx) } : {},
  );
}

/** Runs a job's handler in-process (tests, the cron route, one-off scripts). Validates the payload. */
export async function runJobNow<N extends JobName>(
  name: N,
  payload: JobPayload<N> | unknown,
  ctx: Partial<JobRunContext> = {},
): Promise<unknown> {
  const def = JOBS[name];
  const data = def.schema.parse(payload);
  const retryLimit = ctx.retryLimit ?? retryLimitOf(def);
  const retryCount = ctx.retryCount ?? 0;
  const handler = def.handler as (p: unknown, c: JobRunContext) => Promise<unknown>;
  return handler(data, {
    jobId: ctx.jobId ?? "inline",
    retryCount,
    retryLimit,
    isFinalAttempt: ctx.isFinalAttempt ?? retryCount >= retryLimit,
    signal: ctx.signal ?? new AbortController().signal,
  });
}
