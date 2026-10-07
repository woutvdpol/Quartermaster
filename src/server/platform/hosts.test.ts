import { describe, expect, it } from "vitest";
import { normalizeDomainHost } from "./hosts";

describe("normalizeDomainHost", () => {
  it.each([
    ["Shop.Example.COM", "shop.example.com"],
    ["https://shop.example.com/", "shop.example.com"],
    ["http://concept.localhost:3000", "concept.localhost:3000"],
    ["shop.example.com.", "shop.example.com"],
    ["  www.shop.nl ", "www.shop.nl"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeDomainHost(input)).toBe(expected);
  });

  it.each([["shop.example.com/path"], ["user@shop.example.com"], ["-bad.example"], ["shop..example"], ["shop.example:99999"], [""], ["shop example"], ["ftp://x.nl"]])(
    "rejects %s",
    (input) => {
      expect(normalizeDomainHost(input)).toBeNull();
    },
  );
});
