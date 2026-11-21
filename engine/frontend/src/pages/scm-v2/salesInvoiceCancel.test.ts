import { describe, expect, it } from "vitest";
import { siCancelBody, siHeroLabel } from "./salesInvoiceCancel";

const rm = (sen: number) => `RM ${(sen / 100).toFixed(2)}`;

describe("a cancelled sales invoice (click sweep 2, G6)", () => {
  it("does not read Paid in full though its receipts stay on the row", () => {
    expect(siHeroLabel("CANCELLED", 0)).toBe("Cancelled");
    expect(siHeroLabel("SENT", 0)).toBe("Paid in full");
    expect(siHeroLabel("SENT", 100)).toBe("Outstanding");
  });
  it("the Cancel question names the money that becomes customer credit", () => {
    expect(siCancelBody(45000, rm, "SWEEP2 Test Customer")).toMatch(/^RM 450\.00 already received on this invoice becomes customer credit for SWEEP2 Test Customer/);
    expect(siCancelBody(0, rm, "X")).not.toMatch(/credit/);
  });
});
