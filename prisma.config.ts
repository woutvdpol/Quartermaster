import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // The shim lets the seed reuse server modules that import "server-only".
    seed: "tsx --import ./scripts/server-only-shim.mjs prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
