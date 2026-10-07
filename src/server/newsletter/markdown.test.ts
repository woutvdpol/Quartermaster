import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders the supported subset", () => {
    const html = renderMarkdown("# Title\n\nHello **world**, *new* _items_ and `code`.\nNext line\n\n- one\n- two\n\n1. a\n2. b\n\n> quote\n\n---");
    expect(html).toContain(">Title</h1>");
    expect(html).toContain("Hello <strong>world</strong>, <em>new</em> <em>items</em> and <code");
    expect(html).toContain("<br />Next line");
    expect(html).toMatch(/<ul[^>]*><li>one<\/li><li>two<\/li><\/ul>/);
    expect(html).toMatch(/<ol[^>]*><li>a<\/li><li>b<\/li><\/ol>/);
    expect(html).toContain("<blockquote");
    expect(html).toContain("<hr");
  });

  it("renders safe links and images", () => {
    const html = renderMarkdown("[Shop](https://example.com/a_b_c?x=1&y=2) ![Helmet](https://example.com/h.jpg) [Mail](mailto:a@b.nl)");
    expect(html).toContain('<a href="https://example.com/a_b_c?x=1&amp;y=2"');
    expect(html).not.toContain("<em>"); // underscores inside URLs stay untouched
    expect(html).toContain('<img src="https://example.com/h.jpg" alt="Helmet"');
    expect(html).toContain('href="mailto:a@b.nl"');
  });

  it("escapes raw HTML and refuses dangerous URLs", () => {
    const evil = [
      "<script>alert(1)</script>",
      '<img src=x onerror="alert(1)">',
      "[click](javascript:alert(1))",
      "![x](data:image/svg+xml;base64,PHN2Zz4=)",
      '[x](https://a.com" onmouseover="alert(1))',
      "[x](JaVaScRiPt:alert(1))",
    ].join("\n\n");
    const html = renderMarkdown(evil);
    expect(html).not.toMatch(/<script|<img src=x|onerror="|href="javascript|src="data:|onmouseover="/i);
    expect(html).toContain("&lt;script&gt;");
  });

  it("is robust against placeholder injection", () => {
    expect(() => renderMarkdown("\u00000\u0000 `a` \u00001\u0000")).not.toThrow();
    expect(renderMarkdown("\u00000\u0000")).not.toContain("undefined");
  });
});
