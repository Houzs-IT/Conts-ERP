import { describe, expect, it } from "vitest";
import { parseJournalGrid, parsePayablesGrid, parseReceivablesGrid, toDay, toSen } from "./opening";

// Reading AutoCount's three opening lists (finance phase 1, spec 3.8).
describe("opening balance sheets", () => {
  it("parses the opening journal sheet into sen", () => {
    const sheet = parseJournalGrid([
      ["Trial balance as at 30/11/2026"],
      ["Account", "Debit", "Credit"],
      ["310-0001", "1,234.56", ""],
      ["150-0000", "", 1234.56],
      ["500-0000", "", ""],
    ]);
    expect(sheet.error).toBeNull();
    expect(sheet.rows).toEqual([
      { line: 3, value: { accountCode: "310-0001", debitSen: 123456, creditSen: 0 }, error: null },
      { line: 4, value: { accountCode: "150-0000", debitSen: 0, creditSen: 123456 }, error: null },
    ]);
  });

  it("flags a row with both debit and credit", () => {
    const sheet = parseJournalGrid([["Account", "Debit", "Credit"], ["310-0001", "10.00", "5.00"]]);
    expect(sheet.rows[0].error).toMatch(/Both a debit and a credit/);
  });

  it("refuses a sheet without the template's columns", () => {
    expect(parseJournalGrid([["Code", "Dr", "Cr"]]).error).toMatch(/Account, Debit, Credit/);
  });

  it("reads money and dates the way AutoCount prints them", () => {
    expect(toSen("(10.00)")).toBeNull();
    expect(toSen("-5")).toBeNull();
    expect(toSen("12.345")).toBeNull();
    expect(toDay("05/10/2026")).toBe("2026-10-05");
    expect(toDay("2026-02-30")).toBeNull();
    expect(toDay(new Date(2026, 9, 5))).toBe("2026-10-05");
  });

  it("reads the receivables and payables lists, a row without an amount marked", () => {
    const ar = parseReceivablesGrid([
      ["Invoice no", "Customer code", "Customer", "Invoice date", "Due date", "Outstanding"],
      ["IV-1", "300-A001", "Ah Meng", "05/10/2026", "04/11/2026", "500.00"],
      ["IV-2", "300-A002", "Ah Seng", "05/10/2026", "04/11/2026", ""],
    ]);
    expect(ar.rows[0]).toEqual({ line: 2, value: { docNo: "IV-1", debtorCode: "300-A001", debtorName: "Ah Meng", invoiceDate: "2026-10-05", dueDate: "2026-11-04", outstandingSen: 50000 }, error: null });
    expect(ar.rows[1].error).toMatch(/outstanding/);
    const ap = parsePayablesGrid([["Bill no", "Supplier code", "Bill date", "Due date", "Outstanding"], ["PI-1", "400-T001", "2026-10-01", "2026-10-31", 300]]);
    expect(ap.rows[0]).toMatchObject({ value: { supplierCode: "400-T001", outstandingSen: 30000 }, error: null });
  });
});
