// Conts only: the expected-cost review on Renovation Projects (SOP 4.2.1; plan 2026-11-02-renovation-expected-cost-review.md
// Task 4). Needs review: the open cost alerts, each answered by changing the expected cost or keeping it. Changes: every
// decision, filterable and exported. Alert settings: the threshold and the HOD email (off until finance turns it on).
import { useMemo, useState } from "react";
import { Button } from "../components/Button";
import { DataTable, type Column } from "../components/DataTable";
import { Modal } from "../vendor/scm/components/Modal";
import { DateField } from "../vendor/scm/components/DateField";
import { useAuth } from "../auth/AuthContext";
import styles from "../pages/scm-v2/SalesOrderDetail.module.css";
import {
  belowSpent, CHANGE_KEY, mytDay, pctFromBp, senFromRm, useAlertSettings, useChangeExpectedCost, useCostAlerts, useCostLog, useKeepAlert,
  useSaveAlertSettings, type CostAlert, type CostLogRow,
} from "./renoCostReviewQueries";
import type { RenoProjectRow } from "./renoProjectsQueries";

const BAD = "var(--c-error, #b3261e)";
const MUTED = "var(--fg-muted)";
const num: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };
const rm = (sen: number): string => {
  const s = new Intl.NumberFormat("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(sen) / 100);
  return sen < 0 ? `(${s})` : s;
};
const errText = (e: unknown): string => (e instanceof Error ? e.message : "Not saved.");

/** Change a contract's expected total cost (from today; earlier months stay as they were). */
export function ExpectedCostDialog({ row, onClose }: { row: Pick<RenoProjectRow, "soDocNo" | "projectName" | "expectedCostSen" | "costSpentSen" | "orderedNotBilledSen">; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const save = useChangeExpectedCost();
  const sen = senFromRm(amount);
  const submit = async () => {
    setNote(null);
    if (sen == null || sen <= 0) { setNote("Enter the new expected cost in RM."); return; }
    if (!reason.trim()) { setNote("Say why the expected cost changes."); return; }
    try { await save.mutateAsync({ soDocNo: row.soDocNo, newExpectedSen: sen, expectedOldSen: row.expectedCostSen, reason: reason.trim() }); onClose(); } catch (e) { setNote(errText(e)); }
  };
  return (
    <Modal title="Change expected cost" ariaLabel="Change expected cost" onClose={onClose} width="min(520px, 100%)">
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", fontSize: "var(--fs-13)" }}>
        <div style={{ fontWeight: 600 }}>{row.projectName} <span style={{ color: MUTED, fontWeight: 400 }}>{row.soDocNo}</span></div>
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 16px", margin: 0 }}>
          <dt style={{ color: MUTED }}>Current expected cost</dt><dd style={{ ...num, margin: 0, textAlign: "right" }}>RM {rm(row.expectedCostSen)}</dd>
          <dt style={{ color: MUTED }}>Cost spent</dt><dd style={{ ...num, margin: 0, textAlign: "right" }}>RM {rm(row.costSpentSen)}</dd>
          <dt style={{ color: MUTED }}>Ordered, not billed</dt><dd style={{ ...num, margin: 0, textAlign: "right" }}>RM {rm(row.orderedNotBilledSen)}</dd>
        </dl>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>New expected cost (RM)</span>
          <input className={styles.fieldInput} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </label>
        {sen != null && belowSpent(sen, row.costSpentSen) && (
          <div role="status" style={{ color: BAD }}>Below the cost already spent: completion will stay at 99% until handover.</div>
        )}
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Reason</span>
          <textarea className={styles.fieldInput} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <p style={{ margin: 0, color: MUTED }}>Counts from today. Earlier months stay as they were.</p>
        {note && <div role="alert" style={{ color: BAD }}>{note}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={save.isPending} onClick={() => void submit()}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}

function KeepDialog({ alert, onClose }: { alert: CostAlert; onClose: () => void }) {
  const [why, setWhy] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const keep = useKeepAlert();
  const submit = async () => {
    setNote(null);
    if (!why.trim()) { setNote("Say why the expected cost stays."); return; }
    try { await keep.mutateAsync({ id: alert.id, note: why.trim() }); onClose(); } catch (e) { setNote(errText(e)); }
  };
  return (
    <Modal title="Keep the expected cost" ariaLabel="Keep the expected cost" onClose={onClose} width="min(480px, 100%)">
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", fontSize: "var(--fs-13)" }}>
        <div><b>{alert.project_name}</b>: {alert.what}</div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Why keep it</span>
          <textarea className={styles.fieldInput} rows={3} value={why} onChange={(e) => setWhy(e.target.value)} autoFocus />
        </label>
        {note && <div role="alert" style={{ color: BAD }}>{note}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={keep.isPending} onClick={() => void submit()}>Keep</Button>
        </div>
      </div>
    </Modal>
  );
}

const money = <T,>(key: string, label: string, get: (r: T) => number | null): Column<T> => ({
  key, label, align: "right",
  render: (r) => { const v = get(r); return v == null ? <span style={{ color: MUTED }}>—</span> : <span style={num}>{rm(v)}</span>; },
  getValue: (r) => get(r) ?? 0,
  exportValue: (r) => { const v = get(r); return v == null ? null : v / 100; }, exportFormat: "money",
});

/** The open alerts. `rows` gives the change dialog the project's current figures. */
export function NeedsReview({ rows }: { rows: RenoProjectRow[] }) {
  const q = useCostAlerts();
  const { can } = useAuth();
  const canAct = can(CHANGE_KEY);
  const [changing, setChanging] = useState<RenoProjectRow | null>(null);
  const [keeping, setKeeping] = useState<CostAlert | null>(null);
  const rowOf = useMemo(() => new Map(rows.map((r) => [r.soDocNo, r])), [rows]);
  const columns = useMemo<Column<CostAlert>[]>(() => [
    { key: "project", label: "Project", render: (a) => <span style={{ fontWeight: 600 }}>{a.project_name}</span>, getValue: (a) => a.project_name },
    {
      key: "what", label: "What",
      render: (a) => <span>{a.what}{a.po_numbers.length > 0 && <span style={{ color: MUTED }}> ({a.po_numbers.join(", ")})</span>}</span>,
      getValue: (a) => a.what,
    },
    money<CostAlert>("budget", "Budget (RM)", (a) => a.budget_sen),
    money<CostAlert>("committed", "Committed (RM)", (a) => a.committed_sen),
    {
      key: "gap", label: "Gap (RM)", align: "right",
      render: (a) => <span style={{ ...num, color: a.kind === "LINE_UNDER" ? undefined : BAD }}>{a.kind === "LINE_UNDER" ? "−" : "+"}{rm(a.gap_sen)}</span>,
      getValue: (a) => a.gap_sen, exportValue: (a) => (a.kind === "LINE_UNDER" ? -a.gap_sen : a.gap_sen) / 100, exportFormat: "money",
    },
    { key: "raised", label: "Raised", render: (a) => mytDay(a.raised_at), getValue: (a) => a.raised_at },
    {
      key: "act", label: "",
      render: (a) => (canAct ? (
        <span style={{ display: "inline-flex", gap: 6 }}>
          <Button className="h-8" disabled={!rowOf.get(a.so_doc_no)} onClick={() => setChanging(rowOf.get(a.so_doc_no) ?? null)}>Change expected cost</Button>
          <Button className="h-8" variant="secondary" onClick={() => setKeeping(a)}>Keep</Button>
        </span>
      ) : null),
      getValue: () => "", exportValue: () => null,
    },
  ], [canAct, rowOf]);
  return (
    <>
      <DataTable<CostAlert>
        tableId="conts-reno-cost-alerts"
        columns={columns}
        rows={q.data ? q.data.alerts : null}
        loading={q.isLoading}
        error={q.isError ? "The alerts did not load." : null}
        emptyLabel="Nothing to review."
        getRowKey={(a) => a.id}
      />
      <p style={{ margin: 0, fontSize: "var(--fs-12)", color: MUTED }}>
        Checked every 30 minutes. A line alert compares its purchase orders with the line's cost; a project alert compares cost spent and ordered with the expected cost.
      </p>
      {changing && <ExpectedCostDialog row={changing} onClose={() => setChanging(null)} />}
      {keeping && <KeepDialog alert={keeping} onClose={() => setKeeping(null)} />}
    </>
  );
}

const LOG_COLUMNS: Column<CostLogRow>[] = [
  { key: "date", label: "Date", render: (r) => r.date, getValue: (r) => r.date },
  { key: "project", label: "Project", render: (r) => <span style={{ fontWeight: 600 }}>{r.projectName}</span>, getValue: (r) => `${r.projectName} ${r.soDocNo}` },
  { key: "outcome", label: "Outcome", render: (r) => r.outcome, getValue: (r) => r.outcome },
  money<CostLogRow>("old", "Old (RM)", (r) => r.oldSen),
  money<CostLogRow>("new", "New (RM)", (r) => r.newSen),
  money<CostLogRow>("difference", "Difference (RM)", (r) => r.differenceSen),
  { key: "cause", label: "Cause", render: (r) => r.cause, getValue: (r) => r.cause },
  { key: "reason", label: "Reason", render: (r) => r.reason, getValue: (r) => r.reason },
  { key: "by", label: "By", render: (r) => r.by || "—", getValue: (r) => r.by },
];

export function CostChanges() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const q = useCostLog(from, to);
  return (
    <>
      <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <label className={styles.field} style={{ minWidth: 160 }}>
          <span className={styles.fieldLabel}>From</span>
          <DateField value={from} onChange={(v) => setFrom(v ?? "")} aria-label="From" className={styles.fieldInput} />
        </label>
        <label className={styles.field} style={{ minWidth: 160 }}>
          <span className={styles.fieldLabel}>To</span>
          <DateField value={to} onChange={(v) => setTo(v ?? "")} aria-label="To" className={styles.fieldInput} />
        </label>
      </div>
      <DataTable<CostLogRow>
        tableId="conts-reno-cost-log"
        exportName="renovation-expected-cost-changes"
        exportXlsx
        columns={LOG_COLUMNS}
        rows={q.data ? q.data.rows : null}
        loading={q.isLoading}
        error={q.isError ? "The changes did not load." : null}
        emptyLabel="No changes yet."
        getRowKey={(r) => `${r.outcome}-${r.id}`}
        clientSearch={{ placeholder: "Project or SO" }}
      />
    </>
  );
}

export function AlertSettingsPanel() {
  const q = useAlertSettings();
  const save = useSaveAlertSettings();
  const { can } = useAuth();
  const canEdit = can("scm.payment_voucher.post");
  const [form, setForm] = useState<{ rm: string; pct: string; hodNotify: boolean; hodEmails: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const v = form ?? (q.data ? { rm: String(q.data.minSen / 100), pct: pctFromBp(q.data.pctBp), hodNotify: q.data.hodNotify, hodEmails: q.data.hodEmails } : null);
  if (!v) return <p style={{ color: MUTED }}>{q.isError ? "The settings did not load." : "Loading…"}</p>;
  const set = (patch: Partial<typeof v>) => setForm({ ...v, ...patch });
  const submit = async () => {
    setNote(null);
    const minSen = senFromRm(v.rm);
    const pct = Number(v.pct);
    if (minSen == null) { setNote("Enter the amount in RM."); return; }
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) { setNote("Enter a percentage from 0 to 100."); return; }
    try {
      await save.mutateAsync({ minSen, pctBp: Math.round(pct * 100), hodNotify: v.hodNotify, hodEmails: v.hodEmails });
      setForm(null);
      setNote("Saved.");
    } catch (e) { setNote(errText(e)); }
  };
  return (
    <section className={styles.card} style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)", maxWidth: 640 }} aria-label="Alert settings">
      <h2 style={{ margin: 0, fontSize: "var(--fs-15)" }}>Alert settings</h2>
      <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className={styles.field} style={{ minWidth: 200 }}>
          <span className={styles.fieldLabel}>Alert when over by more than RM</span>
          <input className={styles.fieldInput} inputMode="decimal" value={v.rm} disabled={!canEdit} onChange={(e) => set({ rm: e.target.value })} />
        </label>
        <label className={styles.field} style={{ minWidth: 100 }}>
          <span className={styles.fieldLabel}>or %</span>
          <input className={styles.fieldInput} inputMode="decimal" value={v.pct} disabled={!canEdit} onChange={(e) => set({ pct: e.target.value })} />
        </label>
        <span style={{ color: MUTED, fontSize: "var(--fs-12)", paddingBottom: 8 }}>whichever is larger</span>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" checked={v.hodNotify} disabled={!canEdit} onChange={(e) => set({ hodNotify: e.target.checked })} />
        Email HOD about new alerts
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>HOD email addresses</span>
        <input className={styles.fieldInput} value={v.hodEmails} disabled={!canEdit} placeholder="hod@example.com, another@example.com" onChange={(e) => set({ hodEmails: e.target.value })} />
      </label>
      {note && <div role={note === "Saved." ? "status" : "alert"} style={{ color: note === "Saved." ? MUTED : BAD }}>{note}</div>}
      {canEdit && <div><Button disabled={save.isPending || !form} onClick={() => void submit()}>Save settings</Button></div>}
    </section>
  );
}
