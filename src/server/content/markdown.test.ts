import { describe, expect, it } from "vitest";
import { markdownToPlainText, parseMarkdown, renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders paragraphs with line breaks", () => {
    expect(renderMarkdown("Hello\nworld\n\nSecond")).toBe("<p>Hello<br>world</p>\n<p>Second</p>");
  });

  it("renders headings as h2–h4", () => {
    expect(renderMarkdown("# Title")).toBe("<h2>Title</h2>");
    expect(renderMarkdown("### Sub")).toBe("<h3>Sub</h3>");
    expect(renderMarkdown("###### Deep")).toBe("<h4>Deep</h4>");
  });

  it("renders emphasis and links", () => {
    expect(renderMarkdown("**bold** and *it* and _it2_")).toBe("<p><strong>bold</strong> and <em>it</em> and <em>it2</em></p>");
    expect(renderMarkdown("[Shop](/shop)")).toBe('<p><a href="/shop">Shop</a></p>');
    expect(renderMarkdown("[Ext](https://example.com)")).toBe('<p><a href="https://example.com" rel="noopener noreferrer">Ext</a></p>');
  });

  it("renders lists, quotes and rules", () => {
    expect(renderMarkdown("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
    expect(renderMarkdown("1. a\n2. b")).toBe("<ol><li>a</li><li>b</li></ol>");
    expect(renderMarkdown("> quoted")).toBe("<blockquote><p>quoted</p></blockquote>");
    expect(renderMarkdown("---")).toBe("<hr>");
  });

  it("keeps snake_case and lone markers literal", () => {
    expect(renderMarkdown("snake_case_word 2 * 3")).toBe("<p>snake_case_word 2 * 3</p>");
    expect(renderMarkdown("\\*not italic\\*")).toBe("<p>*not italic*</p>");
  });

  describe("XSS", () => {
    it("escapes raw HTML", () => {
      const html = renderMarkdown('<script>alert("x")</script><img src=x onerror=alert(1)>');
      expect(html).not.toMatch(/<script|<img/);
      expect(html).toBe("<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;</p>");
    });

    it("drops javascript: and other unsafe link targets but keeps the text", () => {
      for (const url of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x", "//evil.com", "vbscript:x"]) {
        const html = renderMarkdown(`[click](${url})`);
        expect(html).toBe("<p>click</p>");
      }
    });

    it("escapes quotes in hrefs so attributes cannot be broken out of", () => {
      const html = renderMarkdown('[x](/a"onmouseover="alert(1))');
      expect(html).toBe('<p><a href="/a&quot;onmouseover=&quot;alert(1)">x</a></p>');
    });

    it("escapes HTML inside link text, headings and list items", () => {
      expect(renderMarkdown("[<b>x</b>](/a)")).toBe('<p><a href="/a">&lt;b&gt;x&lt;/b&gt;</a></p>');
      expect(renderMarkdown("## <i>h</i>")).toBe("<h2>&lt;i&gt;h&lt;/i&gt;</h2>");
      expect(renderMarkdown("- <u>li</u>")).toBe("<ul><li>&lt;u&gt;li&lt;/u&gt;</li></ul>");
    });

    it("does not nest links", () => {
      const ast = parseMarkdown("[a [b](/b)](/a)");
      expect(JSON.stringify(ast)).not.toMatch(/"link".*"link"/);
    });
  });

  it("handles pathological input quickly", () => {
    const start = Date.now();
    renderMarkdown("[".repeat(20000));
    renderMarkdown("*a".repeat(10000));
    renderMarkdown("[a](".repeat(5000));
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("produces plain text", () => {
    expect(markdownToPlainText("## Hi\n\n**bold** [link](/x)\n- a\n- b")).toBe("Hi bold link a b");
  });
});
