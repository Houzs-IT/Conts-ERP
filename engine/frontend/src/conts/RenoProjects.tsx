// Conts only (not part of Houzs's code): Renovation projects — /scm/reno-projects (finance, chew 23 Oct 2026; SOP
// 4.2.3; plan 2026-10-31-renovation-completion-dashboard.md Task 7). One row per live renovation contract as at a
// date: the work (completion %, earned), the money, the cost and the margins, with the alerts in words. Management
// only: the books follow the invoices; completion revenue is never posted.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/Layout";
import { DataTable, type Column } from "../components/DataTable";
import { DateField } from "../vendor/scm/components/DateField";
import styles from "../pages/scm-v2/SalesOrderDetail.module.css";
import { useProjectLimit } from "./projectLimitQueries";
import { alertsOf, kpisOf, useRenoProjects, type RenoProjectRow } from "./renoProjectsQueries";

const BAD = "var(--c-error, #b3261e)";
const GOOD = "var(--c-success, #2F5D4F)";
const MUTED = "var(--fg-muted)";
const today = (): string => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
const rm = (sen: number): string => {
  const s = new Intl.NumberFormat("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(sen) / 100);
  return sen < 0 ? `(${s})` : s;
};
const rmShort = (sen: number): string => new Intl.NumberFormat("en-MY", { notation: "compact", maximumFractionDigits: 1 }).format(sen / 100);
const pct = (bp: number | null): string => (bp == null ? "—" : `${(bp / 100).toFixed(1)}%`);
const days = (d: number | null): string => (d == null ? "—" : `${d}`);
const num: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };

/** The project's limit left, read per row from the project limit route (SOP 3.4). */
function LimitLeft({ projectId }: { projectId: number | null }) {
  const q = useProjectLimit(projectId);
  if (projectId == null) return <>—</>;
  if (q.isLoading) return <span style={{ color: MUTED }}>…</span>;
  if (!q.data) return <>—</>;
  return <span style={{ ...num, color: q.data.leftSen < 0 ? BAD : undefined }}>{rm(q.data.leftSen)}</span>;
}

const money = (key: keyof RenoProjectRow, label: string, defaultHidden = false): Column<RenoProjectRow> => ({
  key, label, align: "right", defaultHidden,
  render: (r) => <span style={num}>{rm(Number(r[key]))}</span>, getValue: (r) => Number(r[key]),
  exportValue: (r) => Number(r[key]) / 100, exportFormat: "money",
});
const percent = (key: "collectedBp" | "completionBp" | "expectedGpBp" | "gpToDateBp", label: string, defaultHidden = false): Column<RenoProjectRow> => ({
  key, label, align: "right", defaultHidden,
  render: (r) => <span style={{ ...num, color: (r[key] ?? 0) < 0 ? BAD : undefined }}>{pct(r[key])}</span>, getValue: (r) => r[key] ?? -1e9,
  exportValue: (r) => (r[key] == null ? null : Number(r[key]) / 100), exportFormat: "number",
});
const gap = (which: "gapsByInvoiceDays" | "gapsByPaymentDays", i: number, label: string): Column<RenoProjectRow> => ({
  key: `${which}${i}`, label, align: "right", defaultHidden: true,
  render: (r) => <span style={num}>{days(r[which][i] ?? null)}</span>, getValue: (r) => r[which][i] ?? -1,
  exportValue: (r) => r[which][i] ?? null, exportFormat: "number",
});

const COLUMNS: Column<RenoProjectRow>[] = [
  { key: "project", label: "Project", render: (r) => <span style={{ fontWeight: 600 }}>{r.projectName}</span>, getValue: (r) => r.projectName },
  { key: "so", label: "SO", defaultHidden: true, render: (r) => <span style={{ fontFamily: "var(--font-mono)" }}>{r.soDocNo}</span>, getValue: (r) => r.soDocNo },
  {
    key: "customer", label: "Customer",
    render: (r) => <span>{r.customerName}{r.customerCode && <span style={{ color: MUTED }}> {r.customerCode}</span>}</span>,
    getValue: (r) => `${r.customerCode ?? ""} ${r.customerName}`,
  },
  { key: "salesperson", label: "Salesperson", defaultHidden: true, render: (r) => r.salesperson ?? "—", getValue: (r) => r.salesperson ?? "" },
  { key: "brand", label: "Brand", defaultHidden: true, render: (r) => r.brand ?? "—", getValue: (r) => r.brand ?? "" },
  { key: "kind", label: "Type", defaultHidden: true, render: (r) => (r.kind === "INHOUSE_RENOVATION" ? "In-house renovation" : "Renovation"), getValue: (r) => r.kind },
  { key: "status", label: "Status", render: (r) => r.stage ?? r.status.replace(/^RENO_/, "").replace(/_/g, " ").toLowerCase(), getValue: (r) => r.stage ?? r.status },
  { key: "handover", label: "Handover", defaultHidden: true, render: (r) => r.handoverDate ?? "—", getValue: (r) => r.handoverDate ?? "" },
  money("contractSen", "Contract", true),
  money("voSen", "VO", true),
  money("revisedContractSen", "Revised contract"),
  money("receivedSen", "Received"),
  money("outstandingSen", "Outstanding", true),
  percent("collectedBp", "Collected %"),
  {
    key: "next", label: "Next instalment", defaultHidden: true,
    render: (r) => (r.nextInstalment ? <span>{r.nextInstalment.seq}. {r.nextInstalment.label} <span style={num}>{rm(r.nextInstalment.amountSen)}</span></span> : "—"),
    getValue: (r) => r.nextInstalment?.amountSen ?? 0,
    exportValue: (r) => (r.nextInstalment ? `${r.nextInstalment.seq}. ${r.nextInstalment.label} ${rm(r.nextInstalment.amountSen)}` : ""),
  },
  gap("gapsByInvoiceDays", 0, "Days 1→2 (invoice)"), gap("gapsByInvoiceDays", 1, "Days 2→3 (invoice)"), gap("gapsByInvoiceDays", 2, "Days 3→4 (invoice)"),
  gap("gapsByPaymentDays", 0, "Days 1→2 (paid)"), gap("gapsByPaymentDays", 1, "Days 2→3 (paid)"), gap("gapsByPaymentDays", 2, "Days 3→4 (paid)"),
  percent("completionBp", "Completion %"),
  money("earnedSen", "Earned"),
  money("invoicedSen", "Invoiced"),
  money("differenceSen", "Difference"),
  money("advanceLeftSen", "Not yet invoiced", true),
  money("expectedCostSen", "Expected cost"),
  money("costSpentSen", "Cost spent"),
  money("orderedNotBilledSen", "Ordered, not billed", true),
  money("remainingCostSen", "Still to spend", true),
  money("owedToSuppliersSen", "Owed to suppliers", true),
  percent("expectedGpBp", "Expected GP %", true),
  percent("gpToDateBp", "GP to date %"),
  /* Read per row on screen from the project limit route: not sorted or exported from this table. */
  { key: "limit", label: "Limit left", align: "right", defaultHidden: true, render: (r) => <LimitLeft projectId={r.projectId} />, exportValue: () => null },
  {
    key: "alerts", label: "Alerts",
    render: (r) => {
      const a = alertsOf(r);
      return a.length === 0 ? <span style={{ color: MUTED }}>—</span> : (
        <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {a.map((t) => <span key={t} style={{ color: BAD, border: `1px solid ${BAD}`, borderRadius: 4, padding: "0 4px", fontSize: "var(--fs-11)", whiteSpace: "nowrap" }}>{t}</span>)}
        </span>
      );
    },
    getValue: (r) => alertsOf(r).join(", "),
  },
];

function Kpi({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "good" | "bad" }) {
  return (
    <section className={styles.card} style={{ padding: "var(--space-3) var(--space-4)", display: "flex", flexDirection: "column", gap: 2 }} aria-label={label}>
      <span style={{ fontSize: "var(--fs-12)", color: MUTED }}>{label}</span>
      <span style={{ ...num, fontSize: 28, fontWeight: 700, color: tone === "bad" ? BAD : undefined }}>{value}</span>
      {note && <span style={{ fontSize: "var(--fs-12)", color: tone === "good" ? GOOD : tone === "bad" ? BAD : MUTED }}>{note}</span>}
    </section>
  );
}

export function RenoProjects() {
  const [asOf, setAsOf] = useState(today());
  const q = useRenoProjects(asOf);
  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);
  const k = useMemo(() => kpisOf(rows), [rows]);
  /* Earned against what the books invoiced: ▲ earned is ahead (work not yet invoiced), ▼ behind (invoiced ahead of the work). */
  const diff = k.earnedSen - k.invoicedSen;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <PageHeader
        title="Renovation projects"
        description="Completion revenue is for management; the books follow the invoices."
        actions={(
          <label className={styles.field} style={{ minWidth: 160 }}>
            <span className={styles.fieldLabel}>As at</span>
            <DateField value={asOf} onChange={(v) => v && setAsOf(v)} aria-label="As at" className={styles.fieldInput} />
          </label>
        )}
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--space-3)" }}>
        <Kpi label="Revised contracts (RM)" value={q.data ? rmShort(k.revisedSen) : "—"} note={q.data ? `${rows.length} project${rows.length === 1 ? "" : "s"}` : undefined} />
        <Kpi label="Invoiced — the books (RM)" value={q.data ? rmShort(k.invoicedSen) : "—"} />
        <Kpi label="Earned by completion (RM)" value={q.data ? rmShort(k.earnedSen) : "—"}
          note={q.data ? (diff === 0 ? "Same as invoiced" : `${diff > 0 ? "▲" : "▼"} RM ${rm(Math.abs(diff))} ${diff > 0 ? "of work not yet invoiced" : "invoiced ahead of the work"}`) : undefined} />
        <Kpi label="Projects over budget" value={q.data ? String(k.overBudget) : "—"} tone={k.overBudget > 0 ? "bad" : undefined}
          note={q.data ? (k.overBudget > 0 ? "Cost spent above the expected cost" : "None") : undefined} />
      </div>
      <DataTable<RenoProjectRow>
        tableId="conts-reno-projects"
        exportName="renovation-projects"
        exportXlsx
        columns={COLUMNS}
        rows={q.data ? rows : null}
        loading={q.isLoading}
        error={q.isError ? "The projects did not load." : null}
        emptyLabel="No renovation contracts yet."
        getRowKey={(r) => r.soDocNo}
        clientSearch={{ placeholder: "Project, customer or SO" }}
      />
      <p style={{ margin: 0, fontSize: "var(--fs-12)", color: MUTED }}>
        Completion % = cost booked ÷ expected cost, at most 99% until handover. Earned = completion × revised contract.
        Old contracts need their cost before go-live (<Link to="/scm/ledger-setup">Ledger setup</Link>).
      </p>
    </div>
  );
}
