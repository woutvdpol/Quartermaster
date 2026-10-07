import { describe, expect, it } from "vitest";
import { mailJobSchema } from "./contracts";

describe("mail.send payload", () => {
  it("accepts valid template props", () => {
    expect(mailJobSchema.safeParse({ tenantId: "t1", template: "order-confirmation-customer", props: { orderId: "o1" } }).success).toBe(true);
    expect(
      mailJobSchema.safeParse({ tenantId: null, template: "password-reset", props: { tokenEnc: "v1.x", audience: "admin" }, to: "a@b.nl" }).success,
    ).toBe(true);
  });

  it("validates props per template", () => {
    const res = mailJobSchema.safeParse({ tenantId: "t1", template: "newsletter-campaign", props: { campaignId: "c1" } });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0].path).toEqual(["props", "subscriberId"]);
    expect(mailJobSchema.safeParse({ tenantId: "t1", template: "nope", props: {} }).success).toBe(false);
    expect(mailJobSchema.safeParse({ tenantId: "t1", template: "password-reset", props: { tokenEnc: "x", audience: "admin" }, to: "bad" }).success).toBe(false);
  });
});
