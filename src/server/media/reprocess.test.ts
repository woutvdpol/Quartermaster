import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { completeContentImage, completeImage, listContentOriginals, missingVariants } from "./reprocess";
import { LocalDriver } from "./storage";
import { readContentManifest, variantKey, type VariantManifest } from "./store";

let root: string;
let storage: LocalDriver;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "qm-reprocess-"));
  storage = new LocalDriver(root);
});
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const photo = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 140, g: 110, b: 60 } } }).jpeg().toBuffer();

/** A pre-round-3 image: original + thumb/card/large/blur WebP, manifest without AVIF. */
async function legacyImage(key: string, w: number, h: number): Promise<VariantManifest> {
  const src = await photo(w, h);
  await storage.put(key, src, "image/jpeg");
  const manifest: VariantManifest = {};
  for (const [name, width] of [["thumb", 320], ["card", 800], ["large", 2000], ["blur", 24]] as const) {
    const { data, info } = await sharp(src).resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
    const vk = variantKey(key, name);
    await storage.put(vk, data, "image/webp");
    manifest[name] = { key: vk, width: info.width, height: info.height, bytes: data.length };
  }
  return manifest;
}

describe("media reprocess", () => {
  it("lists only what is missing for the source width", () => {
    const want = missingVariants({ thumb: { key: "k/thumb.webp", width: 320, height: 1, bytes: 1 } }, 700);
    expect(Object.keys(want)).toEqual(["thumb", "w480", "w640", "card", "large", "blur"]);
    expect(want.thumb).toEqual({ webp: false, avif: true });
    expect(want.blur).toEqual({ webp: true, avif: false });
  });

  it("adds missing widths and AVIF without rewriting existing files, and is idempotent", async () => {
    const key = "t1/products/p1/i1.jpg";
    const manifest = await legacyImage(key, 1200, 900);
    const thumbBefore = await fs.stat(path.join(root, variantKey(key, "thumb")));

    const first = await completeImage(storage, key, manifest, 1200);
    expect(first.status).toBe("updated");
    expect(Object.keys(first.manifest).sort()).toEqual(["blur", "card", "large", "thumb", "w1080", "w480", "w640"]);
    for (const name of ["thumb", "w480", "w640", "card", "w1080", "large"] as const) {
      expect(first.manifest[name]?.avif?.key).toBe(variantKey(key, name, "avif"));
      expect(await storage.exists(variantKey(key, name, "avif"))).toBe(true);
    }
    expect(first.manifest.w480).toMatchObject({ width: 480, height: 360 });
    const thumbAfter = await fs.stat(path.join(root, variantKey(key, "thumb")));
    expect(thumbAfter.mtimeMs).toBe(thumbBefore.mtimeMs); // immutable URL: bytes untouched

    const second = await completeImage(storage, key, first.manifest, 1200);
    expect(second).toMatchObject({ status: "complete", files: 0 });
  });

  it("dry run reports without writing", async () => {
    const key = "t1/products/p1/i2.jpg";
    const manifest = await legacyImage(key, 900, 600);
    const r = await completeImage(storage, key, manifest, 900, { dryRun: true });
    expect(r.status).toBe("updated");
    expect(r.files).toBeGreaterThan(0);
    expect(await storage.exists(variantKey(key, "w480"))).toBe(false);
  });

  it("completes content images and writes their manifest", async () => {
    const key = "t1/content/home/hero-0123456789ab.jpg";
    await legacyImage(key, 1600, 800);
    expect(await listContentOriginals(storage, "t1")).toEqual([key]);
    expect(await listContentOriginals(storage, "t2")).toEqual([]);

    const r = await completeContentImage(storage, key);
    expect(r.status).toBe("updated");
    const manifest = await readContentManifest(storage, key);
    expect(manifest).toMatchObject({ width: 1600, height: 800 });
    expect(manifest?.variants.w1440?.avif?.key).toBe(variantKey(key, "w1440", "avif"));
    expect(manifest?.variants.blur?.dataUrl).toMatch(/^data:image\/webp;base64,/);
    expect((await completeContentImage(storage, key)).status).toBe("complete");
  });
});
