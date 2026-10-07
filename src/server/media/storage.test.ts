import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalDriver, StorageKeyError, assertValidKey, assertValidPrefix, contentTypeForKey, isValidKey } from "./storage";

describe("storage key validation", () => {
  it.each([
    "t1/products/p1/i1.jpg",
    "t1/products/p1/i1/thumb.webp",
    "a",
    "A-b_c.d/e",
  ])("accepts %s", (key) => expect(isValidKey(key)).toBe(true));

  it.each([
    "",
    "/etc/passwd",
    "../secret",
    "a/../b",
    "a/./b",
    "a//b",
    "a/",
    ".hidden",
    "a/.tmp-123",
    "a\\b",
    "a/b c",
    "a/%2e%2e/b",
    "C:/windows",
    "a/b\0c",
    "ü/x",
    "x".repeat(600),
  ])("rejects %j", (key) => {
    expect(isValidKey(key)).toBe(false);
    expect(() => assertValidKey(key)).toThrow(StorageKeyError);
  });

  it("validates prefixes", () => {
    expect(() => assertValidPrefix("t1/products/p1/")).not.toThrow();
    expect(() => assertValidPrefix("")).toThrow();
    expect(() => assertValidPrefix("/")).toThrow();
    expect(() => assertValidPrefix("t1/products")).toThrow();
    expect(() => assertValidPrefix("../")).toThrow();
  });

  it("derives content types from the extension", () => {
    expect(contentTypeForKey("a/b.webp")).toBe("image/webp");
    expect(contentTypeForKey("a/b.JPG")).toBe("image/jpeg");
    expect(contentTypeForKey("a/b.svg")).toBe("application/octet-stream");
  });
});

describe("LocalDriver", () => {
  let root: string;
  let driver: LocalDriver;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "qm-storage-"));
    driver = new LocalDriver(root);
  });
  afterEach(() => fs.rm(root, { recursive: true, force: true }));

  const text = (s: string) => new TextEncoder().encode(s);
  const readAll = async (stream: ReadableStream<Uint8Array>) => Buffer.from(await new Response(stream).arrayBuffer()).toString();

  it("puts, reads, stats and deletes", async () => {
    await driver.put("t/products/p/i.webp", text("hello"), "image/webp");
    expect(await fs.readFile(path.join(root, "t/products/p/i.webp"), "utf8")).toBe("hello");
    expect(await driver.exists("t/products/p/i.webp")).toBe(true);

    const obj = await driver.get("t/products/p/i.webp");
    expect(obj).not.toBeNull();
    expect(obj!.size).toBe(5);
    expect(obj!.contentType).toBe("image/webp");
    expect(obj!.etag).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
    expect(await readAll(obj!.body)).toBe("hello");

    await driver.delete("t/products/p/i.webp");
    expect(await driver.exists("t/products/p/i.webp")).toBe(false);
    await expect(driver.delete("t/products/p/i.webp")).resolves.toBeUndefined();
  });

  it("returns null for missing keys, also when a parent is a file", async () => {
    expect(await driver.get("nope/x.webp")).toBeNull();
    await driver.put("t/file.webp", text("x"), "image/webp");
    expect(await driver.head("t/file.webp/child.webp")).toBeNull();
    expect(await driver.head("t")).toBeNull(); // directories are not objects
  });

  it("overwrites atomically and leaves no temp files", async () => {
    await driver.put("t/a.webp", text("one"), "image/webp");
    await driver.put("t/a.webp", text("two"), "image/webp");
    expect(await fs.readFile(path.join(root, "t/a.webp"), "utf8")).toBe("two");
    expect(await fs.readdir(path.join(root, "t"))).toEqual(["a.webp"]);
  });

  it("deletes by prefix without touching siblings", async () => {
    await driver.put("t/products/p1/i1.jpg", text("o"), "image/jpeg");
    await driver.put("t/products/p1/i1/thumb.webp", text("v"), "image/webp");
    await driver.put("t/products/p2/i2.jpg", text("o"), "image/jpeg");
    await driver.deletePrefix("t/products/p1/i1/");
    expect(await driver.exists("t/products/p1/i1.jpg")).toBe(true);
    expect(await driver.exists("t/products/p1/i1/thumb.webp")).toBe(false);
    await driver.deletePrefix("t/products/p1/");
    expect(await driver.exists("t/products/p1/i1.jpg")).toBe(false);
    expect(await driver.exists("t/products/p2/i2.jpg")).toBe(true);
    await expect(driver.deletePrefix("missing/")).resolves.toBeUndefined();
  });

  it("refuses unsafe keys on every operation", async () => {
    await expect(driver.put("../escape.webp", text("x"), "image/webp")).rejects.toThrow(StorageKeyError);
    await expect(driver.get("/etc/passwd")).rejects.toThrow(StorageKeyError);
    await expect(driver.delete("a/../../b")).rejects.toThrow(StorageKeyError);
    await expect(driver.deletePrefix("")).rejects.toThrow(StorageKeyError);
    await expect(fs.access(path.join(root, "..", "escape.webp"))).rejects.toThrow();
  });
});
