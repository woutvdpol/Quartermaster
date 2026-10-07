import "dotenv/config";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/**
 * Every integration run gets its own throw-away database (derived from DATABASE_URL_TEST),
 * so parallel runs — CI jobs, several developers or agents — never truncate each other's data.
 */
export default async function setup(project: TestProject) {
  const base = process.env.DATABASE_URL_TEST;
  if (!base) throw new Error("DATABASE_URL_TEST is not set (see .env.example)");
  if (base === process.env.DATABASE_URL) throw new Error("DATABASE_URL_TEST must differ from DATABASE_URL");

  const baseUrl = new URL(base);
  const dbName = `${baseUrl.pathname.slice(1)}_${process.pid}_${randomBytes(3).toString("hex")}`;
  const adminUrl = new URL(base);
  adminUrl.pathname = "/postgres";
  const runUrl = new URL(base);
  runUrl.pathname = `/${dbName}`;

  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: runUrl.toString() } });
  project.provide("databaseUrl", runUrl.toString());

  return async () => {
    const client = new Client({ connectionString: adminUrl.toString() });
    await client.connect();
    await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await client.end();
  };
}
