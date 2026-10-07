import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { emphasis, stripEmphasis } from "./Emphasis";

const html = (s: string) => renderToStaticMarkup(createElement("h1", null, emphasis(s)));

describe("emphasis", () => {
  it("wraps *starred* text in <em>", () => {
    expect(html("Original militaria, *honestly* described.")).toBe("<h1>Original militaria, <em>honestly</em> described.</h1>");
  });
  it("handles several spans and leaves plain text alone", () => {
    expect(html("*One* and *two*")).toBe("<h1><em>One</em> and <em>two</em></h1>");
    expect(emphasis("No stars")).toBe("No stars");
  });
  it("keeps unpaired or empty markers literally", () => {
    expect(html("5 * 3 = 15")).toBe("<h1>5 * 3 = 15</h1>");
    expect(html("** empty")).toBe("<h1>** empty</h1>");
  });
  it("never injects HTML", () => {
    expect(html("*<img src=x onerror=alert(1)>*")).toBe("<h1><em>&lt;img src=x onerror=alert(1)&gt;</em></h1>");
  });
  it("strips markers", () => {
    expect(stripEmphasis("A *b* c")).toBe("A b c");
  });
});
