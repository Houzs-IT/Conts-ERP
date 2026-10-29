import { describe, expect, it } from "vitest";
import { PETTY_CASH_HEADER, pettyCashRows } from "./pettyCashExport";
import type { Receipt } from "./claimsQueries";

const receipt = (over: Partial<Receipt>): Receipt => ({
  id: "R1", receiptNo: "CLM-2610-001", submitterUserId: "u1", submitterName: "Ah Wai", floatId: "F1", spendDate: "2026-10-03",
  amountSen: 4500, vendorName: "ACE", note: null, status: "CHECKED", rejectReason: null, checkedAt: null, checkedBy: null,
  topUpPvId: null, paybackPvId: null, replacesId: null, source: "field_app",
  lines: [{ department: "rental", unitId: "U1", maintenanceIssueId: "M1", projectId: null, accountCode: "905-0000", amountSen: 4500, description: "Tap" }],
  files: [{ id: "f1", fileName: "a.jpg", mime: "image/jpeg" }, { id: "f2", fileName: "b.jpg", mime: "image/jpeg" }],
  ...over,
});

describe("pettyCashRows", () => {
  it("one row per receipt line under the header, amounts in ringgit, the number of receipts", () => {
    const rows = pettyCashRows([
      receipt({}),
      receipt({ id: "R2", receiptNo: "CLM-2610-002", status: "HANDED_IN", files: [],
        lines: [
          { department: "supply", unitId: null, maintenanceIssueId: null, projectId: 7, accountCode: null, amountSen: 1999, description: "Paint" },
          { department: "shared", unitId: null, maintenanceIssueId: null, projectId: null, accountCode: "906-0000", amountSen: 1, description: null },
        ] }),
    ], { unit: () => "Skyline A-01", project: (id) => `P${id}` });
    expect(rows[0]).toEqual(PETTY_CASH_HEADER);
    expect(rows).toHaveLength(4);
    expect(rows[1]).toEqual(["2026-10-03", "CLM-2610-001", "Ah Wai", "ACE", "Tap", "Rental", "Skyline A-01 · Maintenance job", "905-0000", 45, "Checked", 2]);
    expect(rows[2].slice(5, 11)).toEqual(["Supply chain", "P7", "", 19.99, "Waiting for a check", 0]);
    expect(rows[3][8]).toBe(0.01);
  });
});
