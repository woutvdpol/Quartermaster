import { defineConfig } from "vitest/config";
import base from "./vitest.config";

// Integration tests run against DATABASE_URL_TEST (a real Postgres), one file at a time.
export default defineConfig({
  resolve: base.resolve,
  test: {
    environment: "node",
    include: ["src/**/*.int.test.ts", "tests/**/*.int.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
