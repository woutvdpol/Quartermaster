import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ImageProcessingError, MAX_UPLOAD_BYTES, processImage } from "./images";

function solid(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: { r: 120, g: 90, b: 40 } } });
}

describe("processImage", () => {
  it("produces the original plus webp variants without upscaling", async () => {
    const input = await solid(3000, 1500).jpeg().toBuffer();
    const out = await processImage(input);

    expect(out.format).toBe("jpeg");
    expect(out.ext).toBe("jpg");
    expect(out.mimeType).toBe("image/jpeg");
    expect([out.original.width, out.original.height]).toEqual([3000, 1500]);
    expect((await sharp(out.original.data).metadata()).format).toBe("jpeg");

    expect(out.variants.thumb).toMatchObject({ width: 320, height: 160, mimeType: "image/webp" });
    expect(out.variants.card).toMatchObject({ width: 800, height: 400 });
    expect(out.variants.large).toMatchObject({ width: 2000, height: 1000 });
    expect(out.variants.blur.width).toBe(24);
    for (const v of Object.values(out.variants)) {
      expect((await sharp(v.data).metadata()).format).toBe("webp");
      expect(v.bytes).toBe(v.data.length);
    }
    expect(out.blurDataUrl).toMatch(/^data:image\/webp;base64,/);
  });

  it("does not enlarge small images", async () => {
    const out = await processImage(await solid(500, 400).png().toBuffer());
    expect(out.format).toBe("png");
    expect(out.variants.thumb.width).toBe(320);
    expect(out.variants.card.width).toBe(500);
    expect(out.variants.large.width).toBe(500);
  });

  it("applies EXIF orientation and strips metadata", async () => {
    // 600x300 stored, orientation 6 = rotate 90° → displayed 300x600.
    const input = await solid(600, 300)
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExif({ IFD0: { Copyright: "secret", Artist: "gps-person" } })
      .toBuffer();
    expect((await sharp(input).metadata()).orientation).toBe(6);

    const out = await processImage(input);
    expect([out.original.width, out.original.height]).toEqual([300, 600]);
    const meta = await sharp(out.original.data).metadata();
    expect(meta.orientation).toBeUndefined();
    expect(meta.exif).toBeUndefined();
    expect([out.variants.thumb.width, out.variants.thumb.height]).toEqual([300, 600]); // narrower than 320: not enlarged
  });

  it("accepts webp input", async () => {
    const out = await processImage(await solid(100, 100).webp().toBuffer());
    expect(out.ext).toBe("webp");
  });

  it("rejects non-images regardless of claimed type", async () => {
    await expect(processImage(new TextEncoder().encode("<svg onload=alert(1)>"))).rejects.toMatchObject({
      reason: "UNSUPPORTED_FORMAT",
    });
  });

  it("rejects SVG and GIF", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    await expect(processImage(svg)).rejects.toBeInstanceOf(ImageProcessingError);
    await expect(processImage(await solid(10, 10).gif().toBuffer())).rejects.toMatchObject({ reason: "UNSUPPORTED_FORMAT" });
  });

  it("rejects empty, oversized and too-many-pixel images", async () => {
    await expect(processImage(new Uint8Array())).rejects.toMatchObject({ reason: "EMPTY" });
    await expect(processImage(new Uint8Array(MAX_UPLOAD_BYTES + 1))).rejects.toMatchObject({ reason: "TOO_LARGE" });
    // 8000x6000 = 48 MP, compresses to a tiny PNG.
    const huge = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#000" } }).png().toBuffer();
    expect(huge.length).toBeLessThan(MAX_UPLOAD_BYTES);
    await expect(processImage(huge)).rejects.toMatchObject({ reason: "TOO_MANY_PIXELS" });
  });

  it("rejects truncated images", async () => {
    const jpeg = await solid(400, 400).jpeg().toBuffer();
    await expect(processImage(jpeg.subarray(0, 200))).rejects.toBeInstanceOf(ImageProcessingError);
  });
});
