import { describe, expect, test } from "vitest";
import { teamProjectSql } from "../src/services/renovation/teamScope";
import { withoutCost, type LinesAnswer } from "../src/services/renovation/betaLines";
import { financeHiddenForUser } from "../src/services/pmsAccess";
import type { AuthUser } from "../src/services/auth";

/* Owner, 27 Nov 2026: sales see the projects they sell, without POs or supplier prices. */
describe("a salesperson's projects", () => {
  const staff = "11111111-2222-4333-8444-555555555555";

  test("a project is theirs when they sell it: on the project or on one of its sales orders", () => {
    const sql = teamProjectSql([7], [staff]);
    expect(sql).toContain(`p.salesperson_staff_id::text IN ('${staff}')`);
    expect(sql).toContain(`tso.salesperson_id::text IN ('${staff}')`);
    expect(sql).toContain("p.sales_person_id IN (7)");
    expect(sql).toContain("p.designer_person_id IN (7)");
  });

  test("a salesperson with no project people record still sees what they sell", () => {
    const sql = teamProjectSql([], [staff]);
    expect(sql).not.toBe("FALSE");
    expect(sql).toContain("salesperson_staff_id");
  });

  test("nobody at all sees nothing, and a malformed staff id is never put into the SQL", () => {
    expect(teamProjectSql([], [])).toBe("FALSE");
    expect(teamProjectSql([], ["x' OR TRUE --"])).toBe("FALSE");
  });
});

describe("the SO tab for someone who may not see costs", () => {
  const answer = {
    finance: true, plansReady: true, categoryRestricted: false,
    sos: [{ docNo: "TC-SO-1", status: "RENO_CONFIRMED", voLocked: true, renovation: true }],
    suppliers: [{ id: "s1", name: "HIN LIM" }],
    warehouses: [{ id: "w1", code: "MAIN", name: "Main" }],
    pendingPoChanges: [{ id: "a1", amendmentNo: "POA-1", poId: "po1", poNumber: "TC-PO-1", voLabel: null }],
    lines: [{
      id: "l1", qty: 2, unitPriceSen: 10000, amountSen: 20000, supplierName: "HIN LIM", supplierId: "s1",
      supplierChoices: [{ id: "s1", code: "400-H004", name: "HIN LIM", main: true, priceSen: 6195 }],
      pos: [{ poId: "po1", poNumber: "TC-PO-1" }], gr: "yes", materials: [],
    }],
  } as unknown as LinesAnswer;

  test("POs, goods received and suppliers stay for follow-up; only the supplier price goes (owner, 27 Nov 2026)", () => {
    const out = withoutCost(answer);
    expect(JSON.stringify(out)).not.toContain("6195");
    const [line] = out.lines;
    expect(line.pos).toHaveLength(1);
    expect(line.supplierName).toBe("HIN LIM");
    expect(line.supplierChoices[0]?.name).toBe("HIN LIM");
    expect(line.supplierChoices[0]?.priceSen).toBeNull();
    expect(out.pendingPoChanges).toHaveLength(1);
    expect(line.amountSen).toBe(20000);
  });
});

describe("money on the wire for a Conts account with no engine position", () => {
  const conts = (page_access: Record<string, string>, perms: string[] = []): AuthUser => ({
    id: 9, email: "s@x", name: "S", role_id: 12, role_name: "Conts: staff abc12345", position_id: null, position_name: null,
    status: "active", permissions: perms, permissions_set: new Set(perms), manager_id: null, scope_to_pic: false, department_id: null,
    page_access,
  } as unknown as AuthUser);

  test("a salesperson (no Project finances, no Invoices) has the money withheld", () => {
    expect(financeHiddenForUser(conts({ "scm.sales": "edit", "projects.finances": "none", "scm.finance": "none" }))).toBe(true);
  });

  test("finance staff keep it: Invoices or Project finances open, or a finance grant", () => {
    expect(financeHiddenForUser(conts({ "projects.finances": "none", "scm.finance": "full" }))).toBe(false);
    expect(financeHiddenForUser(conts({ "projects.finances": "view", "scm.finance": "none" }))).toBe(false);
    expect(financeHiddenForUser(conts({}, ["projects.finance.view"]))).toBe(false);
    expect(financeHiddenForUser(conts({}, ["*"]))).toBe(false);
  });

  test("an older account with no position and no Conts role keeps what it always saw", () => {
    expect(financeHiddenForUser({ ...conts({}), role_name: "Owner" } as AuthUser)).toBe(false);
  });
});
