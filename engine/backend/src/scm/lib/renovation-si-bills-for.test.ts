import { describe, expect, test } from "vitest";
import { billsForLabel, stampBillsFor } from "./renovation-si-bills-for";
import { SI_STATUS_BUCKETS } from "./si-status-buckets";

const fakeSb = (tables: Record<string, unknown[]>, fail?: string) => ({
  from: (t: string) => ({
    select: () => ({
      in: () => ({
        range: async () => (t === fail ? { data: null, error: { message: "down" } } : { data: tables[t] ?? [], error: null }),
      }),
    }),
  }),
});

describe("billsForLabel", () => {
  test("reads like the owner's board", () => {
    expect(billsForLabel(2, 4, 3000)).toBe("Instalment 2 of 4 · 30%");
    expect(billsForLabel(1, 3, 3333)).toBe("Instalment 1 of 3 · 33.33%");
    expect(billsForLabel(1, 3, null)).toBe("Instalment 1 of 3");
  });
});

describe("stampBillsFor", () => {
  const tables = {
    reno_instalment_bills: [{ sales_invoice_id: "a", so_doc_no: "SO1", instalment_id: "i2", seq: 2 }],
    reno_doc_instalments: [
      { id: "i1", so_doc_no: "SO1", pct_bp: 5000 }, { id: "i2", so_doc_no: "SO1", pct_bp: 3000 }, { id: "i3", so_doc_no: "SO1", pct_bp: 2000 },
    ],
  };

  test("stamps the instalment, and null on an invoice not billed by instalment", async () => {
    const rows: Array<Record<string, unknown>> = [{ id: "a" }, { id: "b" }];
    await stampBillsFor(fakeSb(tables), rows);
    expect(rows[0].bills_for).toBe("Instalment 2 of 3 · 30%");
    expect(rows[1].bills_for).toBeNull();
  });

  test("a failed read leaves the column empty and the list alive", async () => {
    const rows: Array<Record<string, unknown>> = [{ id: "a" }];
    await expect(stampBillsFor(fakeSb(tables, "reno_instalment_bills"), rows)).resolves.toBeUndefined();
    expect(rows[0].bills_for).toBeUndefined();
  });
});

describe("SI_STATUS_BUCKETS", () => {
  test("Draft has its own tab, split from Submitted", () => {
    expect(SI_STATUS_BUCKETS.draft).toEqual(["DRAFT"]);
    expect(SI_STATUS_BUCKETS.sent).toEqual(["SENT", "OVERDUE"]);
  });
});
