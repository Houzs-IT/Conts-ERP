import { describe, expect, test } from "vitest";
import { recoveryOpen, recoveryUnits } from "./ownerRecovery";
import type { ClaimLine } from "./claimsQueries";

const line = (unitId: string | null, amountSen: number, over: Partial<ClaimLine> = {}): ClaimLine =>
  ({ department: "rental", unitId, maintenanceIssueId: null, projectId: null, accountCode: null, amountSen, description: null, ...over });

describe("what the owner pays back, on finance's Payment requests (0352, 0363)", () => {
  test("each unit once, its lines added up; a job's line and a line with no unit left out", () => {
    expect(recoveryUnits([line("U1", 1000, { targetLabel: "Agile A-1" }), line(null, 500), line("U1", 200), line("U2", 900, { maintenanceIssueId: "M1" })]))
      .toEqual([["U1", { label: "Agile A-1", sen: 1200 }]]);
  });
  test("a request until it is paid; a claim until it is checked", () => {
    expect(recoveryOpen("request", "SUBMITTED")).toBe(true);
    expect(recoveryOpen("request", "PAID")).toBe(false);
    expect(recoveryOpen("claim", "HANDED_IN")).toBe(true);
    expect(["CHECKED", "TOPPED_UP", "PAID_BACK", "WRITTEN_OFF", "REPLACED"].map((s) => recoveryOpen("claim", s))).toEqual([false, false, false, false, false]);
  });
});
