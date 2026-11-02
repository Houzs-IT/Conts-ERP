// Conts only: the Close-out tab on Renovation Projects (SOP 4.2.2; chew 2 Nov 2026; plan 2026-11-02-renovation-close-out.md
// Task 3). Every handed-over project with the four close-out conditions: billed and collected, suppliers paid, the
// building deposit back, the advance cleared. Closed when all four are done; worked out on each read, never clicked.
import { useMemo, useState } from "react";
import { DataTable, type Column } from "../components/DataTable";
import styles from "../pages/scm-v2/SalesOrderDetail.module.css";
import type { CloseOutCheck, RenoProjectRow } from "./renoProjectsQueries";

const BAD = "var(--c-error, #b3261e)";
const GOOD = "var(--c-success, #2F5D4F)";
const MUTED = "var(--fg-muted)";
type Show = "open" | "closed" | "all";

/** The rows the tab lists for a filter: handed-over projects only. Exported for the test. */
export function closeOutRows(rows: RenoProjectRow[], show: Show): RenoProjectRow[] {
  return rows.filter((r) => r.closeOut && (show === "all" || (show === "closed") === r.closeOut.closed));
}

const check = (key: CloseOutCheck["key"], label: string): Column<RenoProjectRow> => ({
  key, label,
  render: (r) => {
    const c = r.closeOut?.checks.find((x) => x.key === key);
    if (!c) return "—";
    return <span style={{ color: c.ok === true ? GOOD : c.ok === false ? BAD : MUTED }}>{c.ok === true ? "✓ Done" : c.text}</span>;
  },
  getValue: (r) => r.closeOut?.checks.find((x) => x.key === key)?.text ?? "",
});

const COLUMNS: Column<RenoProjectRow>[] = [
  { key: "project", label: "Project", render: (r) => <span style={{ fontWeight: 600 }}>{r.projectName}</span>, getValue: (r) => r.projectName },
  { key: "customer", label: "Customer", render: (r) => r.customerName, getValue: (r) => r.customerName },
  { key: "handover", label: "Planned handover", render: (r) => r.handoverDate ?? "—", getValue: (r) => r.handoverDate ?? "" },
  check("billed", "Billed and collected"),
  check("suppliers", "Suppliers paid"),
  check("deposit", "Building deposit"),
  check("advance", "Advance cleared"),
  {
    key: "status", label: "Status",
    render: (r) => (r.closeOut?.closed ? <span style={{ color: GOOD, fontWeight: 700 }}>Closed</span> : <span style={{ color: BAD, fontWeight: 700 }}>Open</span>),
    getValue: (r) => (r.closeOut?.closed ? "Closed" : "Open"),
  },
];

export function RenoCloseOut({ rows, loading, error }: { rows: RenoProjectRow[]; loading: boolean; error: boolean }) {
  const [show, setShow] = useState<Show>("open");
  const shown = useMemo(() => closeOutRows(rows, show), [rows, show]);
  return (
    <>
      <label className={styles.field} style={{ maxWidth: 200 }}>
        <span className={styles.fieldLabel}>Show</span>
        <select className={styles.fieldInput} value={show} onChange={(e) => setShow(e.target.value as Show)}>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="all">All handed over</option>
        </select>
      </label>
      <DataTable<RenoProjectRow>
        tableId="conts-reno-close-out"
        exportName="renovation-close-out"
        exportXlsx
        columns={COLUMNS}
        rows={loading ? null : shown}
        loading={loading}
        error={error ? "The projects did not load." : null}
        emptyLabel={show === "open" ? "Every handed-over project is closed." : "No handed-over project here."}
        getRowKey={(r) => r.soDocNo}
        clientSearch={{ placeholder: "Project or customer" }}
      />
      <p style={{ margin: 0, fontSize: "var(--fs-12)", color: MUTED }}>
        As at today. A project is closed when every instalment is invoiced and received, its suppliers are paid (retention included),
        its building deposit on 330-0040 is back, and its advance account is cleared. Deposits paid before go-live count once the
        opening deposits are uploaded (Ledger setup).
      </p>
    </>
  );
}
