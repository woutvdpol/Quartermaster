import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end smoke suite (e2e/). Runs against any running instance:
 *
 *   npm run e2e                                            # http://concept.localhost:3000 (npm run dev + seed)
 *   E2E_BASE_URL=https://concept.staging.example npm run e2e   # staging, after a rollout
 *
 * E2E_BASE_URL must be a *tenant* shop host (the storefront is resolved from the Host header).
 * E2E_WEB_SERVER=1 starts `npm run start` on the URL's port first (CI: after `npm run build` and
 * `npm run db:seed && npm run db:seed:demo`; CI uses http://localhost:3001, a seeded concept domain).
 * Never completes a payment: the checkout test stops at the rendered form.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://concept.localhost:3000";
const startServer = process.env.E2E_WEB_SERVER === "1";
const port = new URL(baseURL).port || "3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // Cart tests reserve real (unique) items; keep runs sequential and small.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Staging may sit behind a self-signed / LE-staging certificate.
    ignoreHTTPSErrors: process.env.E2E_IGNORE_HTTPS_ERRORS === "1",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: startServer
    ? {
        command: `npm run start -- -p ${port}`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: "pipe",
      }
    : undefined,
});
