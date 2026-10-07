import { describe, expect, it } from "vitest";
import { CARRIERS, findCarrier, trackingUrlFor } from "./carriers";

describe("carrier presets", () => {
  it("covers the agreed carriers", () => {
    expect(CARRIERS.map((c) => c.name)).toEqual(["PostNL", "DHL", "DPD", "UPS", "bpost"]);
  });

  it("finds carriers by id or display name", () => {
    expect(findCarrier("postnl")?.name).toBe("PostNL");
    expect(findCarrier(" BPOST ")?.id).toBe("bpost");
    expect(findCarrier("GLS")).toBeUndefined();
  });

  it("builds PostNL links with country and postcode", () => {
    expect(trackingUrlFor("PostNL", "3S ABC 123", { postalCode: "1234 ab", countryCode: "nl" })).toBe(
      "https://jouw.postnl.nl/track-and-trace/3SABC123-NL-1234AB",
    );
    expect(trackingUrlFor("PostNL", "3SABC123", { countryCode: "NL" })).toBeNull();
  });

  it("encodes the code and returns null without a code or for unknown carriers", () => {
    expect(trackingUrlFor("UPS", "1Z&x")).toBe("https://www.ups.com/track?loc=en_NL&tracknum=1Z%26x");
    expect(trackingUrlFor("DHL", "  ")).toBeNull();
    expect(trackingUrlFor("Other", "123")).toBeNull();
  });
});
