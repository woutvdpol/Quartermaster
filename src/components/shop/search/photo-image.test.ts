import { describe, expect, it } from "vitest";
import { fitWithin, isImageFile } from "./photo-image";

describe("photo preparation", () => {
  it("fits the longest side within 768 px and never upscales", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 768, height: 576 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 576, height: 768 });
    expect(fitWithin(500, 300)).toEqual({ width: 500, height: 300 });
    expect(fitWithin(10000, 10)).toEqual({ width: 768, height: 1 });
    expect(fitWithin(0, 10)).toEqual({ width: 0, height: 0 });
  });

  it("recognises image files, also without a MIME type", () => {
    expect(isImageFile(new File([""], "a.jpg", { type: "image/jpeg" }))).toBe(true);
    expect(isImageFile(new File([""], "IMG_1.HEIC"))).toBe(true);
    expect(isImageFile(new File([""], "notes.pdf", { type: "application/pdf" }))).toBe(false);
  });
});
