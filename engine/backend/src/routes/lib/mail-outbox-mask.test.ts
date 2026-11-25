import { describe, it, expect } from "vitest";
import { HIDDEN_LINK, maskLoginLinks } from "./mail-outbox-mask";

describe("auto-sent log hides one-time sign-in links from non-admins", () => {
  it("masks invite and reset links, absolute or relative, in text and HTML", () => {
    const html = `<a href="https://erp.houzscentury.com/reset/AbCdEf123456789xyz">Reset</a> or /invite/ZZZZ9999aaaa`;
    const out = maskLoginLinks(html);
    expect(out).not.toMatch(/AbCdEf123456789xyz|ZZZZ9999aaaa/);
    expect(out.split(HIDDEN_LINK).length - 1).toBe(2);
  });

  it("masks the ?token= forms too (reset-password / accept-invite)", () => {
    const t = "Choose a new password: https://erp.example.com/reset-password?token=abcDEF1234567890 then /accept-invite?token=QQQQ88887777";
    const out = maskLoginLinks(t);
    expect(out).not.toMatch(/abcDEF1234567890|QQQQ88887777/);
  });

  it("leaves ordinary links and text alone", () => {
    const t = "Your delivery order DO-2611-001: https://erp.houzscentury.com/scm/delivery-orders/123 — survey /survey/abc";
    expect(maskLoginLinks(t)).toBe(t);
  });

  it("handles empty bodies", () => {
    expect(maskLoginLinks(null)).toBe("");
    expect(maskLoginLinks("")).toBe("");
  });
});
