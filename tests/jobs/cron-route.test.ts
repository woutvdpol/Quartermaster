import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
const runCronTask = vi.fn(async (name: string) => ({ ran: name }));
vi.mock("@/server/jobs/cron", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/jobs/cron")>()),
  runCronTask: (name: string) => runCronTask(name),
}));

const { POST, GET } = await import("@/app/api/cron/[job]/route");
const SECRET = "cron-secret-for-tests-0123456789";

function call(job: string, auth?: string, method: "POST" | "GET" = "POST") {
  const req = new Request(`http://localhost/api/cron/${job}`, { method, headers: auth ? { authorization: auth } : {} });
  const ctx = { params: Promise.resolve({ job }) } as RouteContext<"/api/cron/[job]">;
  return (method === "POST" ? POST : GET)(req, ctx);
}

describe("/api/cron/[job]", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    runCronTask.mockClear();
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("runs a known task with the right bearer token", async () => {
    const res = await call("reservations.expire", `Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, job: "reservations.expire", ran: "reservations.expire" });
    expect(runCronTask).toHaveBeenCalledWith("reservations.expire");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects missing/wrong tokens before looking at the job", async () => {
    expect((await call("reservations.expire")).status).toBe(401);
    expect((await call("reservations.expire", "Bearer nope")).status).toBe(401);
    expect((await call("unknown", "Bearer nope")).status).toBe(401);
    expect(runCronTask).not.toHaveBeenCalled();
  });

  it("is disabled when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("reservations.expire", "Bearer ")).status).toBe(401);
  });

  it("404s unknown jobs and reports failures as 500", async () => {
    expect((await call("nope", `Bearer ${SECRET}`)).status).toBe(404);
    runCronTask.mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    const res = await call("rate-limit.prune", `Bearer ${SECRET}`, "GET");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, job: "rate-limit.prune", error: "failed" });
  });
});
