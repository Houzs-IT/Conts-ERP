import { describe, expect, it } from "vitest";
import { instalmentRows, nextInstalmentSen, toCollectSen } from "./renovationSoInstalments";

const view = (orderPaidSen = 0, orderWaitingSen = 0, invoicePaidSen = 0) => ({
  receivedSen: orderPaidSen + invoicePaidSen, orderPaidSen, orderWaitingSen, waitingSen: orderWaitingSen, revisedContractSen: 100_000,
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
  it("fills the instalments in order with the confirmed money recorded on the order", () => {
    const rows = instalmentRows(view(45_000));
    expect(rows.map((r) => r.paidSen)).toEqual([30_000, 15_000, 0, 0]);
  });
  it("counts money paid on a bill once", () => {
    const v = view(0, 0, 30_000);
    v.instalments[0].bill = { kind: "INVOICE", amountSen: 30_000, paidSen: 30_000 } as never;
    expect(instalmentRows(v).map((r) => r.paidSen)).toEqual([30_000, 0, 0, 0]);
  });
  it("money finance has not confirmed is never paid: it shows as waiting for finance (chew, 21 Nov 2026)", () => {
    const rows = instalmentRows(view(10_000, 35_000));
    expect(rows.map((r) => r.paidSen)).toEqual([10_000, 0, 0, 0]);
    expect(rows.map((r) => r.waitingSen ?? 0)).toEqual([20_000, 15_000, 0, 0]);
  });
  it("an invoice's own unconfirmed money waits on that instalment", () => {
    const base = view();
    const v: NonNullable<Parameters<typeof instalmentRows>[0]> = {
      ...base, instalments: [{ ...base.instalments[0], bill: { kind: "INVOICE", amountSen: 30_000, paidSen: 0, waitingSen: 30_000 } }, ...base.instalments.slice(1)],
    };
    const rows = instalmentRows(v);
    expect(rows[0]).toMatchObject({ paidSen: 0, waitingSen: 30_000 });
  });
  it("offers the next instalment's remainder, not the whole balance", () => {
    const rows = instalmentRows(view());
    expect(nextInstalmentSen(rows, 0)).toBe(30_000);
    expect(nextInstalmentSen(rows, 45_000)).toBe(15_000);
    expect(nextInstalmentSen(rows, 100_000)).toBe(0);
  });
  it("is empty for an order with no schedule", () => {
    expect(instalmentRows(undefined)).toEqual([]);
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

/* Paid before go-live (chew, 23 Nov 2026): TC-SO-2603-004 read "Not paid" on all four instalments though AutoCount was
   paid in full; the instalments AutoCount invoiced carry their share and what was paid on them there. */
describe("an instalment AutoCount invoiced before go-live", () => {
  const before = (paid: [number, number]) => ({
    receivedSen: paid[0] + paid[1], orderPaidSen: 0, orderPoolSen: 0, paidBeforeGoLiveSen: paid[0] + paid[1], revisedContractSen: 100_000,
    instalments: [
      { id: "a", seq: 1, label: "1ST", pctBp: 3000, amountSen: 0, bill: null, billedBeforeGoLive: true, beforeGoLiveSen: 30_000, paidBeforeGoLiveSen: paid[0] },
      { id: "b", seq: 2, label: "2ND", pctBp: 2000, amountSen: 0, bill: null, billedBeforeGoLive: true, beforeGoLiveSen: 20_000, paidBeforeGoLiveSen: paid[1] },
      { id: "c", seq: 3, label: "3RD", pctBp: 5000, amountSen: 50_000, bill: null, isNext: true },
    ],
  });
  it("reads paid before go-live, at its share, and is never billable", () => {
    const rows = instalmentRows(before([30_000, 20_000]));
    expect(rows.map((r) => [r.amountSen, r.paidSen, r.paidBeforeGoLive ?? false, r.billable])).toEqual([
      [30_000, 30_000, true, false], [20_000, 20_000, true, false], [50_000, 0, false, true],
    ]);
    expect(nextInstalmentSen(rows, 50_000)).toBe(50_000);
  });
  it("part paid there: what is left of it is to collect, before the next instalment", () => {
    const rows = instalmentRows(before([30_000, 5_000]));
    expect(rows.map((r) => [r.paidSen, r.paidBeforeGoLive ?? false])).toEqual([[30_000, true], [5_000, false], [0, false]]);
    expect(toCollectSen(rows[1]!)).toBe(15_000);
  });
});
