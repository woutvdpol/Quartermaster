import "dotenv/config";
import { vi } from "vitest";

// Point the app's db client at the test database before any module imports it.
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

// Services may read request headers/cookies (audit IP, tenant cookie); outside Next there is no request.
const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "127.0.0.1", "user-agent": "vitest" }),
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => void cookieJar.set(name, value),
    delete: (name: string) => void cookieJar.delete(name),
  }),
}));
