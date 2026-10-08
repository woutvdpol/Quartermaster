import { beforeAll, describe, expect, it } from "vitest";
import { signApplicationToken, verifyApplicationToken } from "./verify-token";

beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
});

const ID = "cmabc123def456ghi789";

describe("application verification token", () => {
  it("round-trips", () => {
    const token = signApplicationToken(ID);
    expect(verifyApplicationToken(token)).toBe(ID);
  });

  it("rejects tampering and other ids", () => {
    const token = signApplicationToken(ID);
    const [id, exp, sig] = token.split(".");
    expect(verifyApplicationToken(`cmother123def456ghi789.${exp}.${sig}`)).toBeNull();
    expect(verifyApplicationToken(`${id}.${(parseInt(exp, 36) + 1000).toString(36)}.${sig}`)).toBeNull();
    expect(verifyApplicationToken(`${id}.${exp}.${sig.slice(0, -2)}AA`)).toBeNull();
    expect(verifyApplicationToken("garbage")).toBeNull();
    expect(verifyApplicationToken(42)).toBeNull();
  });

  it("expires", () => {
    const now = Date.now();
    const token = signApplicationToken(ID, now, 1);
    expect(verifyApplicationToken(token, now + 59 * 60 * 1000)).toBe(ID);
    expect(verifyApplicationToken(token, now + 61 * 60 * 1000)).toBeNull();
  });
});
