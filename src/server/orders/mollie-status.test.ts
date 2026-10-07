import { describe, expect, it } from "vitest";
import { isMollieStatus, mollieToAttemptStatus, mollieToOrderStatus, releasesReservations } from "./mollie-status";

describe("mollie status mapping", () => {
  it("keeps open/pending/authorized as PENDING (legacy marked them failed)", () => {
    expect(mollieToOrderStatus("open")).toBe("PENDING");
    expect(mollieToOrderStatus("pending")).toBe("PENDING");
    expect(mollieToOrderStatus("authorized")).toBe("PENDING");
    expect(releasesReservations("open")).toBe(false);
    expect(releasesReservations("pending")).toBe(false);
  });

  it("maps terminal statuses", () => {
    expect(mollieToOrderStatus("paid")).toBe("PAID");
    expect(mollieToOrderStatus("failed")).toBe("FAILED");
    expect(mollieToOrderStatus("canceled")).toBe("CANCELED");
    expect(mollieToOrderStatus("expired")).toBe("EXPIRED");
    expect(mollieToAttemptStatus("open")).toBe("OPEN");
    expect(releasesReservations("failed") && releasesReservations("canceled") && releasesReservations("expired")).toBe(true);
    expect(releasesReservations("paid")).toBe(false);
  });

  it("rejects unknown statuses", () => {
    expect(isMollieStatus("paid")).toBe(true);
    expect(isMollieStatus("refunded")).toBe(false);
  });
});
