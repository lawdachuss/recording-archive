import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyStripeSignature, daysFromMeta } from "../premium.js";

describe("verifyStripeSignature", () => {
  const secret = "whsec_testsecret";
  const payload = JSON.stringify({ id: "evt_123", type: "checkout.session.completed" });
  const t = Math.floor(Date.now() / 1000).toString();

  function signature(v1: string) {
    return `t=${t},v1=${v1}`;
  }

  function hmac(body: string) {
    return createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  }

  it("accepts a valid signature", () => {
    expect(verifyStripeSignature(payload, signature(hmac(payload)), secret)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    expect(verifyStripeSignature(payload + "x", signature(hmac(payload)), secret)).toBe(false);
  });

  it("rejects a signature forged with the wrong secret", () => {
    const forged = createHmac("sha256", "whsec_wrong").update(`${t}.${payload}`).digest("hex");
    expect(verifyStripeSignature(payload, signature(forged), secret)).toBe(false);
  });

  it("rejects output without t= or v1= entries", () => {
    expect(verifyStripeSignature(payload, `v1=${hmac(payload)}`, secret)).toBe(false);
    expect(verifyStripeSignature(payload, `t=${t}`, secret)).toBe(false);
    expect(verifyStripeSignature(payload, "garbage", secret)).toBe(false);
  });

  it("rejects a malformed hex v1 value", () => {
    expect(verifyStripeSignature(payload, `t=${t},v1=not-hex`, secret)).toBe(false);
  });
});

describe("daysFromMeta", () => {
  it("uses the default when days is absent", () => {
    expect(daysFromMeta(undefined)).toBe(30);
    expect(daysFromMeta(null, 14)).toBe(14);
  });

  it("parses string day counts", () => {
    expect(daysFromMeta("7")).toBe(7);
    expect(daysFromMeta("90")).toBe(90);
  });

  it("clamps to the supported range", () => {
    expect(daysFromMeta("0")).toBe(1);
    expect(daysFromMeta("-5")).toBe(1);
    expect(daysFromMeta("400")).toBe(90);
  });

  it("falls back on garbage input", () => {
    expect(daysFromMeta("abc")).toBe(30);
    expect(daysFromMeta("abc", 14)).toBe(14);
  });
});