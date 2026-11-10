// Delete a renovation project opened by mistake (chew, 10 Nov 2026: "我要我能删除，刚刚不小心开错了"). What is pinned:
//   • a project with nothing made on it can go; any document on it (quotation, order, receipt, invoice, voucher,
//     journal, claim, request, signed handover) stops the delete and the message says what is there;
//   • a table this database does not have counts as empty, but any other read failure stops the delete;
//   • the project and its own rows go in ONE transaction, the project's row last, scoped to its company and kind;
//   • every table that keeps a project_id without a foreign key (production, 10 Nov 2026) is either a blocker or
//     deleted with the project, so nothing is left pointing at a project that is gone.
import { describe, expect, test } from "vitest";
import type { Db } from "../src/services/renovation/load";
import { DELETE_BLOCKERS, OWN_ROWS, blockedText, deleteBlockers, deleteProjectRows } from "../src/services/renovation/deleteProject";

type Stmt = { sql: string; args: unknown[] };

/** Answers each blocker count from `counts` (by table); `missing` tables answer as Postgres does for an unknown relation. */
function fakeDb(counts: Record<string, number> = {}, opts: { missing?: string[]; broken?: string } = {}) {
  const batches: Stmt[][] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => {
        const stmt = {
          sql, args,
          first: async () => {
            const table = /FROM (\S+) WHERE project_id = \?/.exec(sql)?.[1] ?? "";
            if (opts.missing?.includes(table)) throw Object.assign(new Error(`relation "${table}" does not exist`), { code: "42P01" });
            if (opts.broken === table) throw new Error("connection reset");
            return { n: counts[table] ?? 0 };
          },
          all: async () => ({ results: [] }),
          run: async () => ({}),
        };
        return stmt;
      },
    }),
    batch: async (stmts: Stmt[]) => { batches.push(stmts.map(({ sql, args }) => ({ sql, args }))); return []; },
  };
  return { db: db as unknown as Db, batches };
}

describe("what stops a delete", () => {
  test("a project with nothing made on it has nothing in the way", async () => {
    expect(await deleteBlockers(fakeDb().db, 326)).toEqual([]);
  });

  test("each kind of document stops it, counted per document; the two payment request tables are one kind", async () => {
    const { db } = fakeDb({ "scm.reno_quotations": 1, "scm.purchase_orders": 2, "scm.acc_payment_requests": 1, "scm.payment_request_lines": 1, project_handovers: 1 });
    expect(await deleteBlockers(db, 326)).toEqual([
      { label: "quotation", count: 1 },
      { label: "purchase order", count: 2 },
      { label: "payment request", count: 2 },
      { label: "signed handover", count: 1 },
    ]);
  });

  test("the documents are counted, not their lines (a finance entry is its own line)", () => {
    const lines = DELETE_BLOCKERS.filter((b) => b.table.startsWith("scm.") && b.table.endsWith("_lines"));
    expect(lines.map((b) => b.doc)).toEqual(["bill_id", "receipt_id", "invoice_id", "pv_id", "journal_entry_id", "request_id", "receipt_id"]);
  });

  test("a table this database does not have counts as empty; any other read failure stops the delete", async () => {
    expect(await deleteBlockers(fakeDb({ "scm.grns": 1 }, { missing: ["scm.dp_orders", "sales_entries"] }).db, 326)).toEqual([{ label: "goods receipt", count: 1 }]);
    await expect(deleteBlockers(fakeDb({}, { broken: "scm.mfg_sales_orders" }).db, 326)).rejects.toThrow("connection reset");
  });

  test("the message says what is on the project", () => {
    expect(blockedText("RN-2611-015", [{ label: "quotation", count: 1 }, { label: "purchase order", count: 2 }, { label: "journal entry", count: 3 }]))
      .toBe("RN-2611-015 already has a quotation, 2 purchase orders and 3 journal entries, so it cannot be deleted. Only a project with nothing made on it can be deleted.");
    expect(blockedText("RN-2611-015", [{ label: "sales order", count: 1 }]))
      .toBe("RN-2611-015 already has a sales order, so it cannot be deleted. Only a project with nothing made on it can be deleted.");
  });
});

describe("the delete", () => {
  test("one transaction: the project's own rows first, then the project, scoped to its company and to renovation", async () => {
    const { db, batches } = fakeDb();
    await deleteProjectRows(db, 326, 1);
    expect(batches).toHaveLength(1);
    const [stmts] = batches;
    expect(stmts.slice(0, -1)).toEqual(OWN_ROWS.map((sql) => ({ sql, args: [326] })));
    expect(stmts[stmts.length - 1]).toEqual({ sql: "DELETE FROM projects WHERE id = ? AND company_id = ? AND project_kind = 'renovation'", args: [326, 1] });
    // A checklist item's files are found through the item, so they go before the checklist.
    const at = (t: string) => stmts.findIndex((s) => s.sql.startsWith(`DELETE FROM ${t} `));
    expect(at("project_checklist_attachments")).toBeLessThan(at("project_checklist"));
  });

  test("refuses a database that cannot run the rows in one transaction", async () => {
    const { db } = fakeDb();
    await expect(deleteProjectRows({ prepare: db.prepare } as Db, 326, 1)).rejects.toThrow(/one transaction/);
  });

  test("every table keeping a project_id without a foreign key is a blocker or goes with the project", () => {
    // Production, 10 Nov 2026: the tables with a project_id column and no foreign key to projects. The others follow
    // the project by ON DELETE CASCADE, or are refused by the database itself (RESTRICT / NO ACTION).
    const NO_FOREIGN_KEY = [
      "project_activity", "project_attachments", "project_checklist", "project_checklist_sections", "project_defects", "project_finance",
      "project_finance_lines", "project_phase_photos", "project_reads", "project_sales_attendees", "project_sales_reports", "project_stock_transfers",
      "project_team", "sales_entries", "scm.acc_debtor_bill_lines", "scm.acc_payment_requests", "scm.acc_receipt_lines", "scm.ap_invoice_lines",
      "scm.dp_orders", "scm.journal_entry_lines", "scm.mfg_sales_orders", "scm.payment_voucher_lines",
    ];
    const blocked = new Set(DELETE_BLOCKERS.map((b) => b.table));
    const deleted = new Set(OWN_ROWS.map((sql) => /^DELETE FROM (\S+) /.exec(sql)?.[1]));
    expect(NO_FOREIGN_KEY.filter((t) => !blocked.has(t) && !deleted.has(t))).toEqual([]);
    // The tables whose foreign key would quietly let go of the project (ON DELETE SET NULL) are blockers too.
    for (const t of ["assr_cases", "scm.delivery_orders", "scm.production_orders", "scm.purchase_orders", "scm.sales_invoices"]) expect(blocked.has(t)).toBe(true);
  });
});
