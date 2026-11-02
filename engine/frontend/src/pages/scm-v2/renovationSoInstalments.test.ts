import { describe, expect, it } from "vitest";
import { instalmentRows, nextInstalmentSen } from "./renovationSoInstalments";

const view = (receivedSen = 0) => ({
  receivedSen, revisedContractSen: 100_000,
  instalments: [
    { id: "a", seq: 1, label: "1ST PAYMENT", pctBp: 3000, amountSen: 30_000, bill: null },
    { id: "b", seq: 2, label: "2ND PAYMENT", pctBp: 3000, amountSen: 30_000, bill: null },
    { id: "c", seq: 3, label: "3RD PAYMENT", pctBp: 3500, amountSen: 35_000, bill: null },
    { id: "d", seq: 4, label: "4TH PAYMENT", pctBp: 500, amountSen: 5_000, bill: null },
  ],
});

describe("renovation SO instalments", () => {
  it("fills the instalments in order with the money recorded on the order", () => {
    const rows = instalmentRows(view(), 45_000);
    expect(rows.map((r) => r.paidSen)).toEqual([30_000, 15_000, 0, 0]);
  });
  it("counts money paid on a bill once", () => {
    const v = view(30_000);
    v.instalments[0].bill = { kind: "INVOICE", amountSen: 30_000, paidSen: 30_000 } as never;
    expect(instalmentRows(v, 30_000).map((r) => r.paidSen)).toEqual([30_000, 0, 0, 0]);
  });
  it("offers the next instalment's remainder, not the whole balance", () => {
    const rows = instalmentRows(view(), 0);
    expect(nextInstalmentSen(rows, 0)).toBe(30_000);
    expect(nextInstalmentSen(rows, 45_000)).toBe(15_000);
    expect(nextInstalmentSen(rows, 100_000)).toBe(0);
  });
  it("is empty for an order with no schedule", () => {
    expect(instalmentRows(undefined, 10)).toEqual([]);
  });
});

describe("an order with no instalment schedule", () => {
  it("shows four payments filled oldest first", async () => {
    const { paymentSlots } = await import("./renovationSoInstalments");
    const rows = paymentSlots([{ amount_sen: 10_000, paid_at: "2026-10-24" }, { amount_sen: 5_000, paid_at: "2026-10-20" }]);
    expect(rows.map((r) => r.amountSen)).toEqual([5_000, 10_000, 0, 0]);
    expect(rows.map((r) => r.label)).toEqual(["1st payment", "2nd payment", "3rd payment", "4th payment"]);
    expect(rows.every((r) => r.slot)).toBe(true);
  });
});
