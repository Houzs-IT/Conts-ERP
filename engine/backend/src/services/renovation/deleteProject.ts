/* Delete a renovation project opened by mistake (chew, 10 Nov 2026: "我要我能删除，刚刚不小心开错了").

   Only a project nothing has been made on can go: no quotation, order, receipt, invoice, voucher, journal, claim,
   request or signed handover (DELETE_BLOCKERS). Its own working rows go with it: stages, checklist, trade tasks,
   team, notes, appointments, design records, photos and the activity log (OWN_ROWS here, the rest by the database's
   ON DELETE CASCADE). Uploaded files stay in storage: a drawing copied to another project keeps pointing at the
   file it was copied from. */

import { isMissingRelation, type Db } from "./load";

/** Anything made on the project. `doc` counts the documents, not their lines. */
export const DELETE_BLOCKERS: ReadonlyArray<{ table: string; doc: string; label: string }> = [
  { table: "scm.reno_quotations", doc: "id", label: "quotation" },
  { table: "scm.mfg_sales_orders", doc: "doc_no", label: "sales order" },
  { table: "scm.purchase_orders", doc: "id", label: "purchase order" },
  { table: "scm.production_orders", doc: "id", label: "production order" },
  { table: "scm.grns", doc: "id", label: "goods receipt" },
  { table: "scm.delivery_orders", doc: "id", label: "delivery order" },
  { table: "scm.dp_orders", doc: "id", label: "delivery job" },
  { table: "scm.sales_invoices", doc: "id", label: "sales invoice" },
  { table: "scm.acc_debtor_bill_lines", doc: "bill_id", label: "customer invoice" },
  { table: "scm.acc_receipt_lines", doc: "receipt_id", label: "customer receipt" },
  { table: "scm.ap_invoice_lines", doc: "invoice_id", label: "supplier invoice" },
  { table: "scm.payment_voucher_lines", doc: "pv_id", label: "payment voucher" },
  { table: "scm.journal_entry_lines", doc: "journal_entry_id", label: "journal entry" },
  { table: "scm.acc_payment_requests", doc: "id", label: "payment request" },
  { table: "scm.payment_request_lines", doc: "request_id", label: "payment request" },
  { table: "scm.staff_receipt_lines", doc: "receipt_id", label: "staff claim" },
  { table: "scm.project_limit_requests", doc: "id", label: "limit request" },
  { table: "assr_cases", doc: "id", label: "service case" },
  { table: "project_stock_transfers", doc: "id", label: "stock transfer" },
  { table: "project_finance_lines", doc: "id", label: "finance entry" },
  { table: "project_sales_reports", doc: "id", label: "sales report" },
  { table: "sales_entries", doc: "id", label: "sales entry" },
  { table: "project_handovers", doc: "id", label: "signed handover" },
];

export interface DeleteBlocker { label: string; count: number }

/** What is on the project, one entry per kind of document. A table this database does not have counts as empty. */
export async function deleteBlockers(db: Db, projectId: number): Promise<DeleteBlocker[]> {
  const found = new Map<string, number>();
  // One at a time: a burst of reads fills the database pool (3 Nov 2026), and this runs only when someone deletes.
  for (const b of DELETE_BLOCKERS) {
    let n = 0;
    try {
      const row = await db.prepare(`SELECT count(DISTINCT ${b.doc})::int AS n FROM ${b.table} WHERE project_id = ?`).bind(projectId).first<{ n: number }>();
      n = Number(row?.n ?? 0);
    } catch (e) {
      if (!isMissingRelation(e)) throw e;
    }
    if (n > 0) found.set(b.label, (found.get(b.label) ?? 0) + n);
  }
  return [...found].map(([label, count]) => ({ label, count }));
}

const plural = (label: string): string => (/[^aeiou]y$/.test(label) ? `${label.slice(0, -1)}ies` : `${label}s`);
const counted = (b: DeleteBlocker): string => (b.count === 1 ? `a ${b.label}`.replace(/^a (?=[aeiou])/, "an ") : `${b.count} ${plural(b.label)}`);

/** "RN-2611-015 already has a quotation and 2 purchase orders, so it cannot be deleted." */
export function blockedText(name: string, blockers: readonly DeleteBlocker[]): string {
  const parts = blockers.map(counted);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "documents");
  return `${name} already has ${list}, so it cannot be deleted. Only a project with nothing made on it can be deleted.`;
}

/** The project's own rows with no foreign key to it; every other table follows the project by ON DELETE CASCADE. */
export const OWN_ROWS: readonly string[] = [
  "DELETE FROM project_checklist_attachments WHERE item_id IN (SELECT id FROM project_checklist WHERE project_id = ?)",
  "DELETE FROM project_checklist WHERE project_id = ?",
  "DELETE FROM project_checklist_sections WHERE project_id = ?",
  "DELETE FROM project_activity WHERE project_id = ?",
  "DELETE FROM project_attachments WHERE project_id = ?",
  "DELETE FROM project_defects WHERE project_id = ?",
  "DELETE FROM project_finance WHERE project_id = ?",
  "DELETE FROM project_phase_photos WHERE project_id = ?",
  "DELETE FROM project_reads WHERE project_id = ?",
  "DELETE FROM project_sales_attendees WHERE project_id = ?",
  "DELETE FROM project_team WHERE project_id = ?",
];

/** Deletes the project and its own rows in one transaction. Check deleteBlockers first. */
export async function deleteProjectRows(db: Db, projectId: number, companyId: number): Promise<void> {
  if (!db.batch) throw new Error("deleteProjectRows needs a database that runs a batch in one transaction");
  await db.batch([
    ...OWN_ROWS.map((sql) => db.prepare(sql).bind(projectId)),
    db.prepare(`DELETE FROM projects WHERE id = ? AND company_id = ? AND project_kind = 'renovation'`).bind(projectId, companyId),
  ]);
}
