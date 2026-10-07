import "server-only";
import type { z } from "zod";
import { ServiceError } from "@/server/context";

/** Parses service input with Zod; failures become ServiceError("INVALID") with the issues as details. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    const first = issues[0];
    throw new ServiceError("INVALID", first ? `${first.path ? `${first.path}: ` : ""}${first.message}` : "Invalid input", issues);
  }
  return result.data;
}

/** True when `err` is a Prisma unique-constraint violation (P2002), optionally on a field/constraint name. */
export function isUniqueViolation(err: unknown, field?: string): boolean {
  if (!err || typeof err !== "object" || (err as { code?: unknown }).code !== "P2002") return false;
  if (!field) return true;
  // With driver adapters the target is reported in different places; search them all.
  const haystack = JSON.stringify((err as { meta?: unknown }).meta ?? {}) + String((err as Error).message ?? "");
  return haystack.includes(field);
}

export const notFound = (what: string) => new ServiceError("NOT_FOUND", `${what} not found`);
