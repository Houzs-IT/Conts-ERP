import { describe, expect, it } from "vitest";
import { siIsCancelled, siOwesNothing } from "./si-outstanding";
import { soPdfPaidSen } from "./sales-order-pdf";

/* Click sweep F27 (21 Nov 2026): the invoice list's Outstanding card counted two cancelled invoices. */
describe("which invoices count toward the money cards", () => {
  it("a cancelled or draft invoice owes nothing; only a cancelled one is worth nothing", () => {
    expect(siOwesNothing("CANCELLED")).toBe(true);
    expect(siOwesNothing("DRAFT")).toBe(true);
    expect(siOwesNothing("SENT")).toBe(false);
    expect(siOwesNothing("PAID")).toBe(false);
    expect(siIsCancelled("cancelled")).toBe(true);
    expect(siIsCancelled("DRAFT")).toBe(false);
  });
});

/* Click sweep F31: money taken on the order's invoices is part of Paid to date on the SO print. */
describe("soPdfPaidSen with money taken on invoices", () => {
  it("adds the invoice receipts to the order's own payments", () => {
    expect(soPdfPaidSen({ paid_sen_total: 34_000, paid_outside_ledger_sen: 0, paid_on_invoices_sen: 10_000 }, [{ amount_sen: 24_000 }])).toBe(34_000);
  });
});
