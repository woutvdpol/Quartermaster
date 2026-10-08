import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkOutboundUrl, safeFetch, SafeFetchError, type SafeFetchOptions } from "@/server/security/safe-fetch";

// Local HTTP server only — these tests never touch the internet.
let server: http.Server;
let port: number;
const seenHosts: string[] = [];
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seenHosts.push(String(req.headers.host));
    const url = req.url ?? "/";
    const redirect = (to: string) => {
      res.writeHead(302, { Location: to });
      res.end();
    };
    if (url === "/ok.jpg") {
      res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": JPEG.length });
      return res.end(JPEG);
    }
    if (url === "/redirect-ok") return redirect("/ok.jpg");
    if (url === "/redirect-metadata") return redirect("http://169.254.169.254/latest/meta-data/");
    if (url === "/redirect-private") return redirect("http://10.0.0.5/photo.jpg");
    if (url === "/redirect-loopback") return redirect(`http://127.0.0.1:${port}/ok.jpg`);
    if (url === "/redirect-file") return redirect("file:///etc/passwd");
    if (url.startsWith("/loop")) return redirect(`/loop${Number(url.slice(5) || 0) + 1}`);
    if (url === "/html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end("<html></html>");
    }
    if (url === "/svg") {
      res.writeHead(200, { "Content-Type": "image/svg+xml" });
      return res.end("<svg/>");
    }
    if (url === "/big") {
      res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": 2 * 1024 * 1024 });
      return res.end(Buffer.alloc(2 * 1024 * 1024));
    }
    if (url === "/big-chunked") {
      res.writeHead(200, { "Content-Type": "image/jpeg" });
      for (let i = 0; i < 20; i++) res.write(Buffer.alloc(128 * 1024));
      return res.end();
    }
    if (url === "/slow") return; // never answers
    if (url === "/404") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("nope");
    }
    res.writeHead(500);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

/** Pretends `public.test` is a public host that resolves to our local server. */
const asPublic = (extra: SafeFetchOptions = {}): SafeFetchOptions => ({
  ports: null,
  resolve: async (host) => (host === "public.test" ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "10.9.9.9", family: 4 }]),
  isAllowedAddress: (ip) => ip === "127.0.0.1",
  ...extra,
});

async function code(p: Promise<unknown>) {
  try {
    await p;
    return "OK";
  } catch (err) {
    if (err instanceof SafeFetchError) return err.code;
    throw err;
  }
}

describe("safeFetch — SSRF guard (default policy)", () => {
  it("refuses loopback, private and metadata addresses", async () => {
    expect(await code(safeFetch(`http://127.0.0.1:${port}/ok.jpg`, { ports: null }))).toBe("BLOCKED_ADDRESS");
    expect(await code(safeFetch(`http://localhost:${port}/ok.jpg`, { ports: null }))).toBe("BLOCKED_ADDRESS");
    expect(await code(safeFetch(`http://[::1]:${port}/ok.jpg`, { ports: null }))).toBe("BLOCKED_ADDRESS");
    expect(await code(safeFetch("http://10.0.0.1/a.jpg"))).toBe("BLOCKED_ADDRESS");
    expect(await code(safeFetch("http://169.254.169.254/latest/meta-data/"))).toBe("BLOCKED_ADDRESS");
    expect(await code(safeFetch("http://2130706433/a.jpg"))).toBe("BLOCKED_ADDRESS"); // decimal 127.0.0.1
    expect(await code(safeFetch("http://0x7f.1/a.jpg"))).toBe("BLOCKED_ADDRESS");
    expect(seenHosts).toEqual([]); // nothing reached the server
  });

  it("refuses hostnames that resolve to private addresses (mock DNS), also when mixed with public ones", async () => {
    const resolve = async (h: string) =>
      h === "metadata.test"
        ? [{ address: "169.254.169.254", family: 4 as const }]
        : [
            { address: "93.184.216.34", family: 4 as const },
            { address: "192.168.1.1", family: 4 as const },
          ];
    expect(await code(safeFetch("http://metadata.test/x.jpg", { resolve }))).toBe("BLOCKED_ADDRESS");
    expect(await code(safeFetch("http://mixed.test/x.jpg", { resolve }))).toBe("BLOCKED_ADDRESS");
  });

  it("validates scheme, credentials and port", () => {
    expect(() => checkOutboundUrl("ftp://example.com/a.jpg")).toThrow(SafeFetchError);
    expect(() => checkOutboundUrl("file:///etc/passwd")).toThrow(SafeFetchError);
    expect(() => checkOutboundUrl("http://user:pw@example.com/a.jpg")).toThrow(SafeFetchError);
    expect(() => checkOutboundUrl("http://example.com:6379/")).toThrow(/Port 6379/);
    expect(checkOutboundUrl("https://example.com/a.jpg").hostname).toBe("example.com");
  });
});

describe("safeFetch — with a test host allowed", () => {
  it("downloads an image and pins the connection to the checked address", async () => {
    const res = await safeFetch(`http://public.test:${port}/ok.jpg`, asPublic());
    expect(Buffer.from(res.bytes)).toEqual(JPEG);
    expect(res.contentType).toBe("image/jpeg");
    expect(seenHosts.at(-1)).toBe(`public.test:${port}`);
  });

  it("follows a same-host redirect", async () => {
    expect((await safeFetch(`http://public.test:${port}/redirect-ok`, asPublic())).finalUrl).toMatch(/\/ok\.jpg$/);
  });

  it("re-checks every redirect hop", async () => {
    expect(await code(safeFetch(`http://public.test:${port}/redirect-metadata`, asPublic()))).toBe("BLOCKED_ADDRESS");
    expect(await code(safeFetch(`http://public.test:${port}/redirect-private`, asPublic()))).toBe("BLOCKED_ADDRESS");
    // 127.0.0.1 as a literal is refused by the default policy even after an allowed first hop.
    expect(await code(safeFetch(`http://public.test:${port}/redirect-loopback`, { ...asPublic(), isAllowedAddress: undefined }))).toBe("BLOCKED_ADDRESS");
    expect(await code(safeFetch(`http://public.test:${port}/redirect-file`, asPublic()))).toBe("INVALID_URL");
  });

  it("stops after 3 redirects", async () => {
    expect(await code(safeFetch(`http://public.test:${port}/loop0`, asPublic()))).toBe("TOO_MANY_REDIRECTS");
  });

  it("checks content type, size, status and time", async () => {
    expect(await code(safeFetch(`http://public.test:${port}/html`, asPublic()))).toBe("CONTENT_TYPE");
    expect(await code(safeFetch(`http://public.test:${port}/svg`, asPublic()))).toBe("CONTENT_TYPE");
    expect(await code(safeFetch(`http://public.test:${port}/big`, asPublic({ maxBytes: 1024 * 1024 })))).toBe("TOO_LARGE");
    expect(await code(safeFetch(`http://public.test:${port}/big-chunked`, asPublic({ maxBytes: 1024 * 1024 })))).toBe("TOO_LARGE");
    expect(await code(safeFetch(`http://public.test:${port}/404`, asPublic()))).toBe("HTTP_STATUS");
    expect(await code(safeFetch(`http://public.test:${port}/slow`, asPublic({ timeoutMs: 200 })))).toBe("TIMEOUT");
  });
});
