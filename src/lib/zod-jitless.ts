/**
 * Sets zod's `jitless` option without importing zod (see src/components/ZodJitless.tsx).
 *
 * zod v4 keeps its global config on `globalThis.__zod_globalConfig` and reuses an existing object
 * (zod/v4/core/core.js: `globalThis.__zod_globalConfig ?? (… = {})`), so this works whether it runs
 * before or after zod is first loaded. Guarded by src/lib/zod-jitless.test.ts: if a zod upgrade moves
 * the config, that test fails instead of the CSP reports silently coming back.
 */
export function enableZodJitless(): void {
  const g = globalThis as { __zod_globalConfig?: { jitless?: boolean } };
  (g.__zod_globalConfig ??= {}).jitless = true;
}
