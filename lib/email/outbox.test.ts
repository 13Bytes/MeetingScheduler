import { describe, expect, it } from "vitest";
import { getNotificationRetryAt, normalizeDeliveryError } from "./outbox";

describe("notification outbox helpers", () => {
  it("backs off retry scheduling and stops after max attempts", () => {
    expect(getNotificationRetryAt({ attempts: 1, now: 1000 })).toBe(61000);
    expect(getNotificationRetryAt({ attempts: 2, now: 1000 })).toBe(121000);
    expect(getNotificationRetryAt({ attempts: 5, now: 1000 })).toBeUndefined();
  });

  it("normalizes delivery errors for status storage", () => {
    expect(normalizeDeliveryError(new Error("provider down"))).toBe("provider down");
    expect(normalizeDeliveryError("nope")).toBe("Email delivery failed");
  });
});
