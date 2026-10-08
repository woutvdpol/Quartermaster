import { describe, expect, it } from "vitest";
import { checkDeleteTenantGuards, databaseHost, parseDeleteTenantArgs } from "../../scripts/dev/delete-tenant-guard";

const LOCAL = "postgresql://u:p@127.0.0.1:54329/quartermaster";
const run = (argv: string[], opts: { nodeEnv?: string; databaseUrl?: string } = {}) =>
  checkDeleteTenantGuards({
    nodeEnv: "nodeEnv" in opts ? opts.nodeEnv : "development",
    databaseUrl: "databaseUrl" in opts ? opts.databaseUrl : LOCAL,
    args: parseDeleteTenantArgs(argv),
  });

describe("parseDeleteTenantArgs", () => {
  it("parses slug and flags", () => {
    expect(parseDeleteTenantArgs(["shop", "--confirm", "shop", "--dry-run", "--allow-demo", "--force-remote", "--keep-uploads"])).toEqual({
      slug: "shop",
      confirm: "shop",
      dryRun: true,
      forceRemote: true,
      allowDemo: true,
      keepUploads: true,
    });
    expect(parseDeleteTenantArgs(["--confirm=shop", "shop"]).confirm).toBe("shop");
  });
  it("rejects unknown flags and extra positionals", () => {
    expect(() => parseDeleteTenantArgs(["shop", "--yes"])).toThrow(/Unknown flag/);
    expect(() => parseDeleteTenantArgs(["a", "b"])).toThrow(/Unexpected argument/);
  });
});

describe("databaseHost", () => {
  it("extracts the hostname", () => {
    expect(databaseHost(LOCAL)).toBe("127.0.0.1");
    expect(databaseHost("postgres://u@LocalHost/db")).toBe("localhost");
    expect(databaseHost("postgres://u@[::1]:5432/db")).toBe("[::1]");
    expect(databaseHost("not a url")).toBeNull();
    expect(databaseHost(undefined)).toBeNull();
  });
});

describe("checkDeleteTenantGuards", () => {
  it("allows a local test tenant with a matching confirmation", () => {
    expect(run(["demo-onboarding", "--confirm", "demo-onboarding"])).toEqual({ ok: true, slug: "demo-onboarding" });
    expect(run(["x", "--confirm", "x"], { databaseUrl: "postgres://u@localhost/db" }).ok).toBe(true);
    expect(run(["x", "--confirm", "x"], { databaseUrl: "postgres://u@[::1]/db" }).ok).toBe(true);
  });
  it("requires a slug and an exact confirmation", () => {
    expect(run([]).ok).toBe(false);
    expect(run(["shop"]).ok).toBe(false);
    expect(run(["shop", "--confirm", "other"]).ok).toBe(false);
  });
  it("always refuses NODE_ENV=production, even with every override", () => {
    const r = run(["shop", "--confirm", "shop", "--force-remote", "--allow-demo"], { nodeEnv: "production" });
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/production/) });
  });
  it("refuses a remote or missing DATABASE_URL unless --force-remote", () => {
    const remote = "postgres://u:p@db.example.com:5432/qm";
    expect(run(["shop", "--confirm", "shop"], { databaseUrl: remote })).toEqual({ ok: false, reason: expect.stringMatching(/not local/) });
    expect(run(["shop", "--confirm", "shop", "--force-remote"], { databaseUrl: remote }).ok).toBe(true);
    expect(run(["shop", "--confirm", "shop", "--force-remote"], { databaseUrl: undefined }).ok).toBe(false);
  });
  it("protects the seeded demo tenants unless --allow-demo", () => {
    for (const slug of ["concept-militaria", "veldpost-antiek"]) {
      expect(run([slug, "--confirm", slug])).toEqual({ ok: false, reason: expect.stringMatching(/demo/) });
      expect(run([slug, "--confirm", slug, "--allow-demo"]).ok).toBe(true);
    }
  });
});
