import { describe, expect, test } from "vitest";
import { matchOpeningBills, openingBillKey, piView, refKey } from "./autocount-pi-lines";

describe("AutoCount PI lines behind opening bills", () => {
  test("an invoice number compares without spaces or case", () => {
    expect(refKey(" JY5030 pi ")).toBe("JY5030PI");
  });

  test("a bill opened as '<ref> <supplier> <day>' is that ref on that day", () => {
    expect(openingBillKey("1 400-P002 2026-10-31", "400-P002")).toBe("400-P002|1|2026-10-31");
    expect(openingBillKey("NO NO 400-C010 2026-04-17", "400-C010")).toBe("400-C010|NONO|2026-04-17");
    expect(openingBillKey("QT-TC-00135", "400-M002")).toBe("400-M002|QT-TC-00135");
    // Another supplier's code inside the number is just part of the number.
    expect(openingBillKey("X 400-A001 2026-01-01", "400-M002")).toBe("400-M002|X400-A0012026-01-01");
  });

  test("bills link to the one PI they answer to; two PIs answering link nothing", () => {
    const bills = [
      { id: "a", invoiceNumber: "QT-TC-00135", supplierCode: "400-M002" },
      { id: "b", invoiceNumber: "JY5030 PI", supplierCode: "400-L007" },
      { id: "c", invoiceNumber: "1 400-P002 2026-10-31", supplierCode: "400-P002" },
      { id: "d", invoiceNumber: "1 400-P002 2026-09-30", supplierCode: "400-P002" },
      { id: "e", invoiceNumber: "OLD-1", supplierCode: "400-M002" },
      { id: "f", invoiceNumber: "TWICE", supplierCode: "400-G005" },
    ];
    const pis = [
      { piNo: "PI-002578", supplierCode: "400-M002", supplierRef: "QT-TC-00135", date: "2026-10-22" },
      { piNo: "PI-002562", supplierCode: "400-L007", supplierRef: "JY5030 PI", date: "2026-10-19" },
      { piNo: "PI-002701", supplierCode: "400-P002", supplierRef: "1", date: "2026-10-31" },
      { piNo: "PI-002514", supplierCode: "400-P002", supplierRef: "1", date: "2026-09-30" },
      { piNo: "PI-000001", supplierCode: "400-G005", supplierRef: "TWICE", date: "2026-06-01" },
      { piNo: "PI-000002", supplierCode: "400-G005", supplierRef: "TWICE", date: "2026-07-01" },
      { piNo: "PI-000003", supplierCode: "400-H004", supplierRef: null, date: "2026-07-01" },
    ];
    const m = matchOpeningBills(bills, pis);
    expect(m.links).toEqual([
      { id: "a", docNo: "QT-TC-00135", piNo: "PI-002578" },
      { id: "b", docNo: "JY5030 PI", piNo: "PI-002562" },
      { id: "c", docNo: "1 400-P002 2026-10-31", piNo: "PI-002701" },
      { id: "d", docNo: "1 400-P002 2026-09-30", piNo: "PI-002514" },
    ]);
    expect(m.ambiguous).toEqual([{ docNo: "TWICE", piNos: ["PI-000001", "PI-000002"] }]);
    expect(m.unlinked).toBe(1);
  });

  test("the page shows the lines off the supplier's account and the total the supplier was credited", () => {
    const base = { pi_no: "PI-002056", doc_date: "2026-05-01", supplier_code: "400-S006", supplier_ref: "ME10005660" };
    const v = piView([
      { ...base, line_no: 2, account_code: "900-P003", account_desc: "PETROL,TOL & PARKING FEE", project: "OFF & WH", description: "OFFICE SEASON PARKING", debit_sen: 20000, credit_sen: 0 },
      { ...base, line_no: 1, account_code: "400-S006", account_desc: "SUEZ DOMAIN SDN. BHD.", project: "OFF & WH", description: "OFFICE SEASON PARKING", debit_sen: 0, credit_sen: 20000 },
      { ...base, line_no: 3, account_code: "900-P003", account_desc: "PETROL,TOL & PARKING FEE", project: "OFF & WH", description: "Discount", debit_sen: 0, credit_sen: 500 },
      { ...base, line_no: 4, account_code: "400-S006", account_desc: "SUEZ DOMAIN SDN. BHD.", project: "OFF & WH", description: "Discount", debit_sen: 500, credit_sen: 0 },
    ]);
    expect(v).toEqual({
      piNo: "PI-002056", date: "2026-05-01", supplierRef: "ME10005660", totalSen: 19500,
      lines: [
        { description: "OFFICE SEASON PARKING", project: "OFF & WH", accountCode: "900-P003", accountDesc: "PETROL,TOL & PARKING FEE", amountSen: 20000 },
        { description: "Discount", project: "OFF & WH", accountCode: "900-P003", accountDesc: "PETROL,TOL & PARKING FEE", amountSen: -500 },
      ],
    });
    expect(piView([])).toBeNull();
  });
});
