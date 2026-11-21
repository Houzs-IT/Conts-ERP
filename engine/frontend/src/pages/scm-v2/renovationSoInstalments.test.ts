import { describe, expect, it } from "vitest";
import { instalmentRows, nextInstalmentSen, toCollectSen } from "./renovationSoInstalments";

const view = (receivedSen = 0) => ({
  receivedSen, revisedContractSen: 100_000,
  instalments: [
    { id: "a", seq: 1, label: "1ST PAYMENT", pctBp: 3000, amountSen: 30_000, bill: null },
    { id: "b", seq: 2, label: "2ND PAYMENT", pctBp: 3000, amountSen: 30_000, bill: null },
    { id: "c", seq: 3, label: "3RD PAYMENT", pctBp: 3500, amountSen: 35_000, bill: null },
    { id: "d", seq: 4, label: "4TH PAYMENT", pctBp: 500, amountSen: 5_000, bill: null },
  ],
});

describe("toCollectSen", () => {
  it("takes what earlier overpayment already covered off the instalment", () => {
    expect(toCollectSen({ amountSen: 248400, paidSen: 1600 })).toBe(246800);
    expect(toCollectSen({ amountSen: 248400, paidSen: 300000 })).toBe(0);
  });
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

/* Click sweep F6 (21 Nov 2026): every instalment of TC-SO-2611-915 read "Not paid" while instalment 1's invoice was
   PAID by the deposit; the server now sends what settles each bill and what of the order's money is left over. */
describe("instalments from a server that splits the order's money", () => {
  it("shows instalment 1 paid by the deposit and fills the rest with what the order still holds", () => {
    const v: Parameters<typeof instalmentRows>[0] = {
      receivedSen: 835_000, orderPaidSen: 835_000, unappliedSen: 584_200, creditedSen: 1_000, revisedContractSen: 1_722_000,
      instalments: [
        { id: "a", seq: 1, label: "1ST", pctBp: 3000, amountSen: 250_800, bill: { kind: "INVOICE", amountSen: 250_800, paidSen: 250_800 } },
        { id: "b", seq: 2, label: "2ND", pctBp: 3000, amountSen: 783_400, bill: null },
        { id: "c", seq: 3, label: "3RD", pctBp: 3500, amountSen: 602_700, bill: null },
        { id: "d", seq: 4, label: "4TH", pctBp: 500, amountSen: 86_100, bill: null },
      ],
    };
    const rows = instalmentRows(v, 835_000);
    expect(rows[0]!.paidSen).toBe(250_800);
    expect(rows[1]!.paidSen).toBe(584_200 + 1_000);
    const toCollect = rows.reduce((s, r) => s + toCollectSen(r), 0);
    expect(toCollect).toBe(1_722_000 - 835_000);
  });
  it("offers the first instalment still owed, less what is being typed", async () => {
    const { nextToCollectSen } = await import("./renovationSoInstalments");
    const rows = [
      { seq: 1, label: "1", pctBp: 3000, amountSen: 24_000, paidSen: 24_000 },
      { seq: 2, label: "2", pctBp: 3000, amountSen: 24_000, paidSen: 10_000 },
      { seq: 3, label: "3", pctBp: 3500, amountSen: 28_000, paidSen: 0 },
    ];
    expect(nextToCollectSen(rows, 0)).toBe(14_000);
    expect(nextToCollectSen(rows, 14_000)).toBe(28_000);
  });
});
