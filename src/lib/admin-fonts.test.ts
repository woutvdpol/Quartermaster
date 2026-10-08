import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_FONT_FACES } from "./admin-font-faces.generated";
import { ADMIN_FONT_CSS, ADMIN_FONT_PRELOAD, adminFontVariables } from "./admin-fonts";

describe("admin fonts", () => {
  it("has self-hosted latin faces (files present) for every family", () => {
    for (const [name, entry] of Object.entries(ADMIN_FONT_FACES)) {
      expect(entry.faces.some((f) => f.subset === "latin"), name).toBe(true);
      for (const f of entry.faces) {
        expect(f.src).toMatch(/^\/fonts\/admin\/[a-z0-9-]+\.[0-9a-f]{10}\.woff2$/);
        expect(existsSync(join(process.cwd(), "public", f.src)), f.src).toBe(true);
      }
    }
  });

  it("defines every font variable globals.css uses", () => {
    const globals = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const used = new Set([...globals.matchAll(/var\((--font-[a-z0-9-]+)\)/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(0);
    const block = ADMIN_FONT_CSS.slice(ADMIN_FONT_CSS.indexOf(`.${adminFontVariables}{`));
    for (const v of used) expect(block, v).toContain(`${v}:"QM Admin `);
    expect(ADMIN_FONT_CSS).toContain('--font-ibm-plex-sans:"QM Admin IBM Plex Sans","QM Admin IBM Plex Sans Fallback"');
    expect(ADMIN_FONT_CSS).toContain('--font-big-shoulders-stencil:"QM Admin Big Shoulders Stencil";');
    expect(ADMIN_FONT_CSS).toContain("font-display:swap");
  });

  it("preloads only the latin IBM Plex Sans file", () => {
    expect(ADMIN_FONT_PRELOAD).toMatch(/^\/fonts\/admin\/ibm-plex-sans-latin-normal-/);
  });
});
