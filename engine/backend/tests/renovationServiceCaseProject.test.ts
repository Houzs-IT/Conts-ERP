import { describe, expect, test } from "vitest";
import {
  annotateCaseProjects,
  caseFieldsFromProject,
  projectSearchArgs,
  readCaseProject,
  searchCaseProjects,
  type CaseProject,
} from "../src/services/renovation/serviceCaseProject";
import type { Db, DbStmt } from "../src/services/renovation/load";

const P: CaseProject = {
  id: 7, code: "RN-2610-001", name: "Vista Harmoni B-8-2", customerName: "Tan Ah Kow", customerPhone: "012-345 6789",
  customerEmail: "tan@example.com", address1: "B-8-2 Vista Harmoni", address2: "Jalan Cheras", postcode: "56000", city: "Kuala Lumpur",
  state: "WP Kuala Lumpur", siteAddress: "", building: "Vista Harmoni", unitNo: "B-8-2", soDocNo: "SO-2610-0001", openCaseCount: 0,
};

/** A fake Db that records every statement and answers from a queue. */
function fakeDb(answers: unknown[]) {
  const calls: { sql: string; args: unknown[] }[] = [];
  const db: Db = {
    prepare(sql: string): DbStmt {
      const call = { sql, args: [] as unknown[] };
      calls.push(call);
      const stmt: DbStmt = {
        bind: (...args: unknown[]) => { call.args = args; return stmt; },
        all: async <T,>() => ({ results: (answers.shift() ?? []) as T[] }),
        first: async <T,>() => (answers.shift() ?? null) as T | null,
        run: async () => ({}),
      };
      return stmt;
    },
  };
  return { db, calls };
}

describe("service case from a renovation project (owner, 15 Oct 2026)", () => {
  test("the case takes the project's customer, phone, email and the four address lines", () => {
    expect(caseFieldsFromProject(P)).toEqual({
      customer_name: "Tan Ah Kow", phone: "+60123456789", customer_email: "tan@example.com",
      addr1: "B-8-2 Vista Harmoni", addr2: "Jalan Cheras", addr3: "56000 Kuala Lumpur", addr4: "WP Kuala Lumpur",
    });
  });
  test("an email typed on the form wins over the project's", () => {
    expect(caseFieldsFromProject(P, " other@example.com ").customer_email).toBe("other@example.com");
    expect(caseFieldsFromProject({ ...P, customerEmail: "" }, "").customer_email).toBeNull();
  });
  test("a project saved before the structured address splits its one site address by line; extra lines join the fourth", () => {
    const old = { ...P, address1: "", address2: "", postcode: "", city: "", state: "", siteAddress: "L1\nL2\nL3\nL4\nL5" };
    const f = caseFieldsFromProject(old);
    expect([f.addr1, f.addr2, f.addr3, f.addr4]).toEqual(["L1", "L2", "L3", "L4, L5"]);
  });
  test("blank fields are stored as null, never as empty text", () => {
    const f = caseFieldsFromProject({ ...P, customerName: "", customerPhone: "", customerEmail: "", address2: "", state: "" });
    expect(f.customer_name).toBeNull();
    expect(f.phone).toBeNull();
    expect(f.addr4).toBeNull();
  });
  test("search terms: lower-case text, and the digits alone once there are three", () => {
    expect(projectSearchArgs(" Vista ")).toEqual({ like: "%vista%", digits: "" });
    expect(projectSearchArgs("012-345")).toEqual({ like: "%012-345%", digits: "%012345%" });
    expect(projectSearchArgs("")).toEqual({ like: "%%", digits: "" });
  });
  test("the picker searches renovation projects of the company only, by code, name, building, unit, customer and phone", async () => {
    const { db, calls } = fakeDb([[{ row: { id: 7, code: "RN-2610-001", name: "Vista Harmoni B-8-2", customer_name: "Tan Ah Kow" }, so_doc_no: "SO-1", open_case_count: 2 }]]);
    const out = await searchCaseProjects(db, " AND p.company_id = 1", "tan");
    expect(out[0]).toMatchObject({ id: 7, code: "RN-2610-001", customerName: "Tan Ah Kow", soDocNo: "SO-1", openCaseCount: 2, address1: "" });
    expect(calls[0]!.sql).toContain("p.project_kind = 'renovation' AND p.archived_at IS NULL AND p.company_id = 1");
    for (const col of ["p.code", "p.name", "p.building", "p.unit_no", "p.customer_name", "p.customer_phone"]) expect(calls[0]!.sql).toContain(col);
    expect(calls[0]!.sql).not.toContain("--");
  });
  test("a project with no sales order gives an empty SO doc no; an unknown project is null", async () => {
    const { db } = fakeDb([{ row: JSON.stringify({ id: 9, code: null, name: "Landed" }), so_doc_no: null, open_case_count: 0 }, null]);
    expect((await readCaseProject(db, 9, ""))?.soDocNo).toBe("");
    expect(await readCaseProject(db, 10, "")).toBeNull();
  });
  test("list and detail rows with a project get its code and name; rows without one are left alone", async () => {
    const { db, calls } = fakeDb([[{ id: 7, code: "RN-2610-001", name: "Vista Harmoni B-8-2" }]]);
    const rows: Record<string, unknown>[] = [{ id: 1, project_id: 7 }, { id: 2, projectId: "7" }, { id: 3, project_id: null }];
    await annotateCaseProjects(db, rows);
    expect(rows[0]).toMatchObject({ project_id: 7, project_code: "RN-2610-001", project_name: "Vista Harmoni B-8-2" });
    expect(rows[1]).toMatchObject({ project_id: 7, project_code: "RN-2610-001" });
    expect(rows[2]).toEqual({ id: 3, project_id: null });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual([JSON.stringify(["7"])]);
  });
  test("nothing to annotate: no query at all", async () => {
    const { db, calls } = fakeDb([]);
    await annotateCaseProjects(db, [{ id: 1 }, null]);
    expect(calls).toHaveLength(0);
  });
});
