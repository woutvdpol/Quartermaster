import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

// The Mollie client resolves node-fetch from its own node_modules; package.json `overrides` points
// that at vendor/node-fetch, which must hand requests to the built-in fetch without the https agent.
const requireFromMollie = createRequire(require.resolve("@mollie/api-client"));

describe("node-fetch stand-in (vendor/node-fetch)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is the vendored stand-in, not node-fetch v2", () => {
    const pkg = requireFromMollie("node-fetch/package.json") as { version: string };
    expect(pkg.version).toMatch(/-native\./);
  });

  it("delegates to globalThis.fetch and drops the agent option", async () => {
    const native = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", native);
    const fetch = requireFromMollie("node-fetch") as (input: unknown, init?: Record<string, unknown>) => Promise<Response>;
    const url = new URL("https://api.mollie.com/v2/methods");
    await fetch(url, { agent: {}, method: "GET", headers: { Authorization: "Bearer x" } });
    expect(native).toHaveBeenCalledWith(url, { method: "GET", headers: { Authorization: "Bearer x" } });
  });
});
