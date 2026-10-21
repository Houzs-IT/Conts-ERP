import { describe, expect, it } from "vitest";
import { canUseLedger, LEDGER_KEY } from "./ledger";

describe("canUseLedger (Conts Ledger area)", () => {
  it("never counts the * wildcard", () => {
    expect(canUseLedger(["*"])).toBe(false);
  });
  it("needs the ledger key itself", () => {
    expect(canUseLedger(["*", LEDGER_KEY])).toBe(true);
    expect(canUseLedger([LEDGER_KEY])).toBe(true);
  });
  it("is closed with no permissions", () => {
    expect(canUseLedger(undefined)).toBe(false);
    expect(canUseLedger([])).toBe(false);
  });
});
