import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { DocumentFileError, prepareDocumentFile, sniffDocumentType } from "./files";

const enc = (s: string) => new TextEncoder().encode(s);

describe("document files", () => {
  it("sniffs types from magic bytes", () => {
    expect(sniffDocumentType(enc("%PDF-1.7\n…"))).toBe("pdf");
    expect(sniffDocumentType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniffDocumentType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(sniffDocumentType(enc("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
    expect(sniffDocumentType(enc("<html>%PDF-"))).toBeNull();
    expect(sniffDocumentType(enc("GIF89a"))).toBeNull();
  });

  it("keeps PDFs byte-for-byte and rejects other files", async () => {
    const pdf = enc("%PDF-1.4\n%%EOF");
    const out = await prepareDocumentFile(pdf);
    expect(out).toMatchObject({ type: "pdf", ext: "pdf", mimeType: "application/pdf" });
    expect(Buffer.compare(out.data, Buffer.from(pdf))).toBe(0);
    await expect(prepareDocumentFile(enc("PK\x03\x04 docx"))).rejects.toBeInstanceOf(DocumentFileError);
    await expect(prepareDocumentFile(new Uint8Array())).rejects.toMatchObject({ reason: "EMPTY" });
  });

  it("re-encodes images and strips metadata", async () => {
    const jpeg = await sharp({ create: { width: 60, height: 40, channels: 3, background: "#884422" } })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: "secret-gps" } } })
      .toBuffer();
    expect(jpeg.includes("secret-gps")).toBe(true);
    const out = await prepareDocumentFile(new Uint8Array(jpeg));
    expect(out).toMatchObject({ type: "jpeg", ext: "jpg", mimeType: "image/jpeg" });
    expect(out.data.includes("secret-gps")).toBe(false);
    expect((await sharp(out.data).metadata()).width).toBe(60);
  });

  it("rejects a corrupt image", async () => {
    await expect(prepareDocumentFile(new Uint8Array([0xff, 0xd8, 0xff, 0x00, 1, 2, 3]))).rejects.toMatchObject({ reason: "CORRUPT" });
  });
});
