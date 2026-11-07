import { describe, expect, it } from "vitest";
import { creditNoteToConfirm } from "./renovationModel";

describe("an over-billed instalment on the project page", () => {
  it("reads the amount the server wants confirmed", () => {
    expect(creditNoteToConfirm({ rawBody: JSON.stringify({ error: "credit_note_needs_confirm", amountSen: -5000 }) })).toBe(-5000);
  });
  it("any other refusal is not a credit note", () => {
    expect(creditNoteToConfirm({ rawBody: JSON.stringify({ error: "stale_amount", amountSen: 5 }) })).toBeNull();
    expect(creditNoteToConfirm(new Error("network"))).toBeNull();
  });
});
