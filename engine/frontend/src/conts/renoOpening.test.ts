// Renovation contracts at go-live (plan 2026-10-30-renovation-revenue-ledger.md Task 8): reading finance's Excel.
import { describe, expect, it } from "vitest";
import { RENO_OPENING_COLUMNS, RENO_OPENING_COST_COLUMN, parseRenoOpeningGrid } from "./renoOpening";

describe("the go-live sheet", () => {
  it("reads each contract's SO, customer, advance account and RM invoiced before go-live", () => {
    const sheet = parseRenoOpeningGrid([
      ["Renovation contracts at go-live"],
      [...RENO_OPENING_COLUMNS],
      ["2990-SO-2609-001", "301-C005", "480-D007", "30,000.00"],
      ["2990-SO-2609-002", "301-C006", "480-D008", ""],
      [" ", "", "", ""],
      ["", "301-C007", "480-D009", 100],
      ["2990-SO-2609-004", "301-C008", "480-D010", "-5"],
    ]);
    expect(sheet.error).toBeNull();
    expect(sheet.rows.map((r) => [r.line, r.value, r.error])).toEqual([
      [3, { soDocNo: "2990-SO-2609-001", debtorCode: "301-C005", advanceAccountCode: "480-D007", billedBeforeGoLiveSen: 3_000_000, costBeforeGoLiveSen: null }, null],
      [4, { soDocNo: "2990-SO-2609-002", debtorCode: "301-C006", advanceAccountCode: "480-D008", billedBeforeGoLiveSen: 0, costBeforeGoLiveSen: null }, null],
      [6, { soDocNo: "", debtorCode: "301-C007", advanceAccountCode: "480-D009", billedBeforeGoLiveSen: 10_000, costBeforeGoLiveSen: null }, "No SO doc no."],
      [7, { soDocNo: "2990-SO-2609-004", debtorCode: "301-C008", advanceAccountCode: "480-D010", billedBeforeGoLiveSen: 0, costBeforeGoLiveSen: null }, "The amount is not a plain RM figure."],
    ]);
  });

  it("reads the optional cost before go-live: blank is not given, a bad figure is named", () => {
    const sheet = parseRenoOpeningGrid([
      [...RENO_OPENING_COLUMNS, RENO_OPENING_COST_COLUMN],
      ["SO-1", "301-C005", "480-D007", "30,000.00", "20,000.00"],
      ["SO-2", "301-C006", "480-D008", "0", ""],
      ["SO-3", "301-C007", "480-D009", "0", "abc"],
    ]);
    expect(sheet.rows.map((r) => [r.value.costBeforeGoLiveSen, r.error])).toEqual([
      [2_000_000, null], [null, null], [null, "The cost before go-live is not a plain RM figure."],
    ]);
  });

  it("names the columns a sheet without them needs", () => {
    expect(parseRenoOpeningGrid([["SO", "Customer"]]).error).toContain("SO doc no, Customer account, Advance account, Invoiced before go-live (RM)");
  });
});
