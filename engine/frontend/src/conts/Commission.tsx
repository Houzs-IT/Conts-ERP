// Conts only (not part of Houzs's code): Commission — /scm/commission (owner, 25 Nov 2026). Management only.
// Worked out on each load from the contracts, their VOs and the money collected; nothing to press.
// By order: every live renovation contract, its commission per person, split by the month each part was sold in.
// By person: what each person earned, was paid and can still claim. Monthly sales: each salesperson's sales per month
// and the tier it reached. Payouts: every payment, taken back but never deleted. Settings: one scheme per brand.
// The math is the backend's (scm/shared/renovation-commission.ts); this page only sums for display.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/Layout";
import { DataTable, type Column } from "../components/DataTable";
import { TabStrip } from "../components/TabStrip";
import { Button } from "../components/Button";
import { Modal } from "../vendor/scm/components/Modal";
import { DateField } from "../vendor/scm/components/DateField";
import styles from "../pages/scm-v2/SalesOrderDetail.module.css";
import { useDialog } from "../hooks/useDialog";
import {
  bpFromPct, pctText, personTotals, senFromRm, stageText, tierBp, useCommission, useDeleteScheme, useRecordPayout, useSaveScheme,
  useVoidPayout, type CommissionData, type CommissionMonth, type CommissionPayout, type CommissionRow, type CommissionScheme,
  type CommissionShare, type CommissionStage, type PersonTotal, type SchemeInput,
} from "./commissionQueries";

type Tab = "orders" | "people" | "months" | "payouts" | "settings";

const BAD = "var(--c-error, #b3261e)";
const GOOD = "var(--c-success, #2F5D4F)";
const MUTED = "var(--fg-muted)";
const num: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };
const today = (): string => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
const rm = (sen: number): string => new Intl.NumberFormat("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(sen / 100);
const rm0 = (sen: number): string => new Intl.NumberFormat("en-MY", { maximumFractionDigits: 2 }).format(sen / 100);
const errText = (e: unknown): string => (e instanceof Error ? e.message : "Not saved.");
const sum = (shares: CommissionShare[], k: "totalSen" | "earnedSen" | "paidSen" | "claimableSen"): number => shares.reduce((t, s) => t + s[k], 0);
const ROLE = { sales: "Salesperson", manager: "Sales manager" } as const;
const SOURCE = { SO: "Sales order", VO: "VO", OTHER: "Other change" } as const;
const PROBLEM = { no_salesperson: "No salesperson on the order", no_scheme: "No scheme for this brand" } as const;

const moneyCol = <T,>(key: string, label: string, get: (r: T) => number, opts: { strong?: boolean; hidden?: boolean } = {}): Column<T> => ({
  key, label, align: "right", defaultHidden: opts.hidden,
  render: (r) => <span style={{ ...num, fontWeight: opts.strong ? 600 : undefined, color: opts.strong && get(r) > 0 ? GOOD : undefined }}>{rm(get(r))}</span>,
  getValue: get, exportValue: (r) => get(r) / 100, exportFormat: "money",
});

const ORDER_COLUMNS: Column<CommissionRow>[] = [
  { key: "so", label: "SO", render: (r) => <Link to={`/scm/sales-orders/${encodeURIComponent(r.soDocNo)}`} onClick={(e) => e.stopPropagation()}>{r.soDocNo}</Link>, getValue: (r) => r.soDocNo },
  { key: "date", label: "SO date", render: (r) => r.soDate ?? "—", getValue: (r) => r.soDate ?? "" },
  { key: "project", label: "Project", render: (r) => <span style={{ fontWeight: 600 }}>{r.projectName || r.customerName}</span>, getValue: (r) => `${r.projectName} ${r.customerName}` },
  { key: "brand", label: "Brand", render: (r) => r.branding ?? "—", getValue: (r) => r.branding ?? "" },
  { key: "sp", label: "Salesperson", render: (r) => r.salespersonName ?? <span style={{ color: BAD }}>None</span>, getValue: (r) => r.salespersonName ?? "" },
  { key: "scheme", label: "Scheme", defaultHidden: true, render: (r) => r.schemeName ?? <span style={{ color: BAD }}>{r.problem ? PROBLEM[r.problem] : "—"}</span>, getValue: (r) => r.schemeName ?? "" },
  moneyCol<CommissionRow>("base", "Contract (RM)", (r) => r.baseSen),
  { key: "collected", label: "Collected", align: "right", render: (r) => <span style={num}>{pctText(r.collectedBp)}</span>, getValue: (r) => r.collectedBp, exportValue: (r) => r.collectedBp / 100, exportFormat: "number" },
  { key: "released", label: "Released", align: "right", render: (r) => <span style={num}>{r.problem ? "—" : pctText(r.releasedBp)}</span>, getValue: (r) => r.releasedBp },
  moneyCol<CommissionRow>("total", "Commission (RM)", (r) => sum(r.shares, "totalSen")),
  moneyCol<CommissionRow>("earned", "Earned (RM)", (r) => sum(r.shares, "earnedSen")),
  moneyCol<CommissionRow>("paid", "Paid (RM)", (r) => sum(r.shares, "paidSen")),
  moneyCol<CommissionRow>("claimable", "To pay (RM)", (r) => sum(r.shares, "claimableSen"), { strong: true }),
  moneyCol<CommissionRow>("pool", "Company pool (RM)", (r) => r.companyPoolSen, { hidden: true }),
];

const PEOPLE_COLUMNS: Column<PersonTotal>[] = [
  { key: "name", label: "Person", render: (r) => <span style={{ fontWeight: 600 }}>{r.staffName}</span>, getValue: (r) => r.staffName },
  { key: "orders", label: "Orders", align: "right", render: (r) => <span style={num}>{r.orders}</span>, getValue: (r) => r.orders },
  moneyCol<PersonTotal>("total", "Commission (RM)", (r) => r.totalSen),
  moneyCol<PersonTotal>("earned", "Earned (RM)", (r) => r.earnedSen),
  moneyCol<PersonTotal>("paid", "Paid (RM)", (r) => r.paidSen),
  moneyCol<PersonTotal>("claimable", "To pay (RM)", (r) => r.claimableSen, { strong: true }),
];

export function ContsCommission() {
  const q = useCommission();
  const [tab, setTab] = useState<Tab>("orders");
  const [open, setOpen] = useState<string | null>(null);
  const [person, setPerson] = useState<string>("");
  const data = q.data;
  const rows = useMemo(() => (data?.rows ?? []).filter((r) => !person || r.shares.some((s) => s.staffId === person) || r.salespersonId === person), [data, person]);
  const people = useMemo(() => personTotals(data?.rows ?? []), [data]);
  const toPay = people.reduce((t, p) => t + p.claimableSen, 0);
  const missing = (data?.rows ?? []).filter((r) => r.problem).length;
  const openRow = data?.rows.find((r) => r.soDocNo === open) ?? null;

  return (
    <div className="space-y-4">
      <PageHeader title="Commission" description="Worked out from each order, its VOs and the money collected. Paid out in stages as the customer pays." />
      {data && (
        <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", fontSize: "var(--fs-13)" }}>
          <Kpi label="To pay now" value={`RM ${rm(toPay)}`} strong />
          <Kpi label="Earned so far" value={`RM ${rm(people.reduce((t, p) => t + p.earnedSen, 0))}`} />
          <Kpi label="Paid" value={`RM ${rm(people.reduce((t, p) => t + p.paidSen, 0))}`} />
          {missing > 0 && <Kpi label="Orders with no commission" value={`${missing} of ${data.rows.length}`} bad />}
        </div>
      )}
      {data && data.schemes.filter((s) => s.active).length === 0 && (
        <div role="status" style={{ color: BAD }}>No commission scheme yet. Set one up under Settings to start working out commission.</div>
      )}
      <TabStrip<Tab> value={tab} onChange={setTab} options={[
        { value: "orders", label: "By order" },
        { value: "people", label: "By person", count: people.length },
        { value: "months", label: "Monthly sales" },
        { value: "payouts", label: "Payouts" },
        { value: "settings", label: "Settings" },
      ]} />
      {q.isError && <div role="alert" style={{ color: BAD }}>{errText(q.error)}</div>}
      {tab === "orders" && (
        <>
          <label className={styles.field} style={{ maxWidth: 280 }}>
            <span className={styles.fieldLabel}>Person</span>
            <select className={styles.fieldInput} value={person} onChange={(e) => setPerson(e.target.value)}>
              <option value="">Everyone</option>
              {people.map((p) => <option key={p.staffId} value={p.staffId}>{p.staffName}</option>)}
            </select>
          </label>
          <DataTable<CommissionRow>
            tableId="conts-commission-orders" exportName="commission-by-order" exportXlsx
            columns={ORDER_COLUMNS} rows={data ? rows : null} loading={q.isLoading}
            emptyLabel="No renovation contracts yet." getRowKey={(r) => r.soDocNo}
            onRowClick={(r) => setOpen(r.soDocNo)} clientSearch={{ placeholder: "Project, customer or SO" }}
          />
        </>
      )}
      {tab === "people" && (
        <DataTable<PersonTotal>
          tableId="conts-commission-people" exportName="commission-by-person" exportXlsx
          columns={PEOPLE_COLUMNS} rows={data ? people : null} loading={q.isLoading}
          emptyLabel="Nobody has commission yet." getRowKey={(r) => r.staffId}
          onRowClick={(r) => { setPerson(r.staffId); setTab("orders"); }}
        />
      )}
      {tab === "months" && data && <Months data={data} />}
      {tab === "payouts" && data && <Payouts data={data} />}
      {tab === "settings" && data && <Settings data={data} />}
      {openRow && data && <OrderDialog row={openRow} payouts={data.payouts.filter((p) => p.soDocNo === openRow.soDocNo)} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Kpi({ label, value, strong, bad }: { label: string; value: string; strong?: boolean; bad?: boolean }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 14px", minWidth: 150 }}>
      <div style={{ color: MUTED, fontSize: "var(--fs-12)" }}>{label}</div>
      <div style={{ ...num, fontWeight: 600, fontSize: "var(--fs-16, 16px)", color: bad ? BAD : strong ? GOOD : undefined }}>{value}</div>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "right", fontWeight: 500, padding: "4px 0 4px 8px" };
const td: React.CSSProperties = { ...num, textAlign: "right", padding: "6px 0 6px 8px" };

/* ── One order: months, stages, the split per person, and paying it ──────── */
function OrderDialog({ row, payouts, onClose }: { row: CommissionRow; payouts: CommissionPayout[]; onClose: () => void }) {
  const [paying, setPaying] = useState<CommissionShare | null>(null);
  const voidPayout = useVoidPayout();
  const dialog = useDialog();
  const [note, setNote] = useState<string | null>(null);
  return (
    <Modal title={row.projectName || row.customerName} ariaLabel="Commission on this order" onClose={onClose} width="min(860px, 100%)">
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", fontSize: "var(--fs-13)" }}>
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr auto 1fr", gap: "4px 16px", margin: 0 }}>
          <dt style={{ color: MUTED }}>SO</dt><dd style={{ margin: 0 }}>{row.soDocNo} · {row.soDate ?? "—"}</dd>
          <dt style={{ color: MUTED }}>Brand / scheme</dt><dd style={{ margin: 0 }}>{row.branding ?? "—"} / {row.schemeName ?? "—"}</dd>
          <dt style={{ color: MUTED }}>Contract</dt><dd style={{ ...num, margin: 0 }}>RM {rm(row.baseSen)}</dd>
          <dt style={{ color: MUTED }}>Collected</dt><dd style={{ ...num, margin: 0 }}>RM {rm(row.collectedSen)} ({pctText(row.collectedBp)})</dd>
        </dl>
        {row.problem && <div role="status" style={{ color: BAD }}>{PROBLEM[row.problem]}. {row.problem === "no_scheme" ? "Add a scheme for this brand under Settings." : "Set the salesperson on the sales order."}</div>}
        {!row.problem && (
          <div style={{ overflowX: "auto" }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>By month sold</div>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
              <thead><tr style={{ color: MUTED }}>
                <th style={{ ...th, textAlign: "left", paddingLeft: 0 }}>Month</th><th style={{ ...th, textAlign: "left" }}>From</th><th style={th}>Amount</th>
                <th style={th}>Month's sales</th><th style={th}>Salesperson</th><th style={th}>Manager</th><th style={th}>Salesperson RM</th><th style={th}>Manager RM</th>
              </tr></thead>
              <tbody>{row.portions.map((p, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px 0" }}>{p.month}</td><td style={{ paddingLeft: 8 }}>{SOURCE[p.source]}{p.source === "VO" ? ` ${p.ref}` : ""}</td>
                  <td style={td}>{rm(p.sen)}</td><td style={td}>{rm0(p.monthSalesSen)}</td>
                  <td style={td}>{pctText(p.salesBp)}</td><td style={td}>{pctText(p.managerBp)}</td>
                  <td style={td}>{rm(p.salesSen)}</td><td style={td}>{rm(p.managerSen)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {row.stages.length > 0 && (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Payout stages</div>
            {row.stages.map((s, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <span style={{ color: s.reached ? GOOD : MUTED, width: 18 }}>{s.reached ? "✓" : "○"}</span>
                <span style={{ flex: 1 }}>{s.label}{s.thresholdBp == null ? " (this contract has no such payment)" : ` (${pctText(s.thresholdBp)} of the contract collected)`}</span>
                <span style={num}>releases {pctText(s.releaseBp)}</span>
              </div>
            ))}
          </div>
        )}
        {row.shares.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
              <thead><tr style={{ color: MUTED }}>
                <th style={{ ...th, textAlign: "left", paddingLeft: 0 }}>Person</th><th style={{ ...th, textAlign: "left" }}>Role</th><th style={th}>Commission</th>
                <th style={th}>Earned</th><th style={th}>Paid</th><th style={th}>To pay</th><th />
              </tr></thead>
              <tbody>{row.shares.map((s) => (
                <tr key={s.staffId} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ fontWeight: 600, padding: "6px 0" }}>{s.staffName}</td><td style={{ paddingLeft: 8 }}>{ROLE[s.role]}</td>
                  <td style={td}>{rm(s.totalSen)}</td><td style={td}>{rm(s.earnedSen)}</td><td style={td}>{rm(s.paidSen)}</td>
                  <td style={{ ...td, fontWeight: 600, color: s.claimableSen > 0 ? GOOD : undefined }}>{rm(s.claimableSen)}</td>
                  <td style={{ textAlign: "right", paddingLeft: 8 }}><Button variant="secondary" onClick={() => setPaying(s)}>Record payout</Button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {row.companyPoolSen > 0 && <div style={{ color: MUTED }}>Company pool kept aside: RM {rm(row.companyPoolSen)} (not paid to anyone).</div>}
        {payouts.length > 0 && (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Paid on this order</div>
            {payouts.map((p) => (
              <div key={p.id} style={{ display: "flex", gap: 12, alignItems: "baseline", textDecoration: p.voidedAt ? "line-through" : undefined, color: p.voidedAt ? MUTED : undefined }}>
                <span style={{ width: 90 }}>{p.paidOn}</span><span style={{ flex: 1 }}>{p.staffName}{p.note ? ` · ${p.note}` : ""}</span>
                <span style={num}>RM {rm(p.amountSen)}</span>
                {!p.voidedAt && <Button variant="ghost" onClick={async () => {
                  setNote(null);
                  if (!(await dialog.confirm(`Take back RM ${rm(p.amountSen)} paid to ${p.staffName} on ${p.paidOn}? It stays in the list, marked taken back.`))) return;
                  try { await voidPayout.mutateAsync(p.id); } catch (e) { setNote(errText(e)); }
                }}>Take back</Button>}
              </div>
            ))}
          </div>
        )}
        {note && <div role="alert" style={{ color: BAD }}>{note}</div>}
      </div>
      {paying && <PayDialog soDocNo={row.soDocNo} share={paying} onClose={() => setPaying(null)} />}
    </Modal>
  );
}

function PayDialog({ soDocNo, share, onClose }: { soDocNo: string; share: CommissionShare; onClose: () => void }) {
  const [amount, setAmount] = useState(share.claimableSen > 0 ? (share.claimableSen / 100).toFixed(2) : "");
  const [paidOn, setPaidOn] = useState(today());
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const save = useRecordPayout();
  const dialog = useDialog();
  const submit = async () => {
    setNote(null);
    const sen = senFromRm(amount);
    const problems = [...(sen == null || sen <= 0 ? ["Enter the amount paid in RM."] : []), ...(!paidOn ? ["Enter the date it was paid."] : [])];
    if (problems.length > 0 || sen == null) { setNote(problems.join(" ")); return; }
    if (sen > share.claimableSen && !(await dialog.confirm(`RM ${rm(sen)} is more than the RM ${rm(share.claimableSen)} earned and not yet paid. Record it anyway?`))) return;
    try { await save.mutateAsync({ soDocNo, staffId: share.staffId, amountSen: sen, paidOn, note: text }); onClose(); } catch (e) { setNote(errText(e)); }
  };
  return (
    <Modal title={`Record payout to ${share.staffName}`} ariaLabel="Record payout" onClose={onClose} width="min(460px, 100%)">
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", fontSize: "var(--fs-13)" }}>
        <div style={{ color: MUTED }}>{soDocNo} · earned RM {rm(share.earnedSen)}, paid RM {rm(share.paidSen)}</div>
        <label className={styles.field}><span className={styles.fieldLabel}>Amount (RM)</span>
          <input className={styles.fieldInput} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></label>
        <label className={styles.field}><span className={styles.fieldLabel}>Paid on</span>
          <DateField value={paidOn} onChange={(v) => setPaidOn(v)} /></label>
        <label className={styles.field}><span className={styles.fieldLabel}>Note</span>
          <input className={styles.fieldInput} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. November payroll" /></label>
        {note && <div role="alert" style={{ color: BAD }}>{note}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save payout"}</Button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Monthly sales and the tier reached ─────────────────────────────────── */
function Months({ data }: { data: CommissionData }) {
  const schemeOf = new Map(data.schemes.map((s) => [s.id, s]));
  const cols: Column<CommissionMonth>[] = [
    { key: "month", label: "Month", render: (r) => r.month, getValue: (r) => r.month },
    { key: "person", label: "Salesperson", render: (r) => <span style={{ fontWeight: 600 }}>{r.staffName}</span>, getValue: (r) => r.staffName },
    { key: "scheme", label: "Scheme", render: (r) => schemeOf.get(r.schemeId)?.name ?? "—", getValue: (r) => schemeOf.get(r.schemeId)?.name ?? "" },
    moneyCol<CommissionMonth>("sales", "Sales incl. VOs (RM)", (r) => r.salesSen),
    { key: "tier", label: "Salesperson rate", align: "right", render: (r) => {
      const s = schemeOf.get(r.schemeId);
      if (!s) return "—";
      return <span style={num}>{s.managerStaffId === r.staffId ? `${pctText(s.managerBp)} (manager)` : pctText(tierBp(s.tiers, r.salesSen, s.managerBp))}</span>;
    }, getValue: (r) => r.salesSen },
  ];
  return (
    <DataTable<CommissionMonth>
      tableId="conts-commission-months" exportName="commission-monthly-sales" exportXlsx columns={cols} rows={data.months}
      emptyLabel="No sales yet under a scheme." getRowKey={(r) => `${r.schemeId}|${r.staffId}|${r.month}`}
    />
  );
}

/* ── Payouts ────────────────────────────────────────────────────────────── */
const PAYOUT_COLUMNS: Column<CommissionPayout>[] = [
  { key: "date", label: "Paid on", render: (r) => r.paidOn, getValue: (r) => r.paidOn },
  { key: "person", label: "Person", render: (r) => <span style={{ fontWeight: 600 }}>{r.staffName}</span>, getValue: (r) => r.staffName },
  { key: "so", label: "SO", render: (r) => r.soDocNo, getValue: (r) => r.soDocNo },
  moneyCol<CommissionPayout>("amount", "Amount (RM)", (r) => r.amountSen),
  { key: "note", label: "Note", render: (r) => r.note || "—", getValue: (r) => r.note },
  { key: "by", label: "Recorded by", render: (r) => r.createdBy || "—", getValue: (r) => r.createdBy ?? "" },
  { key: "state", label: "", render: (r) => (r.voidedAt ? <span style={{ color: BAD }}>Taken back</span> : ""), getValue: (r) => (r.voidedAt ? 1 : 0) },
];
function Payouts({ data }: { data: CommissionData }) {
  return (
    <DataTable<CommissionPayout>
      tableId="conts-commission-payouts" exportName="commission-payouts" exportXlsx columns={PAYOUT_COLUMNS} rows={data.payouts}
      emptyLabel="No commission paid yet. Open an order under By order and record a payout." getRowKey={(r) => r.id}
    />
  );
}

/* ── Settings: one scheme per brand ─────────────────────────────────────── */
const DEFAULT_TIERS = [
  { fromSen: 6_000_000, bp: 50 }, { fromSen: 10_000_000, bp: 100 }, { fromSen: 15_000_000, bp: 150 },
  { fromSen: 20_000_000, bp: 200 }, { fromSen: 25_000_000, bp: 250 }, { fromSen: 30_000_000, bp: 300 },
];
const newScheme = (branding: string | null): SchemeInput => ({
  name: branding ?? "All brands", branding, managerStaffId: null, managerBp: 400, companyPoolBp: 0, tiers: DEFAULT_TIERS, active: true,
  stages: [{ label: "2nd payment", kind: "instalment", value: 2, releaseBp: 5000 }, { label: "Last payment", kind: "collected", value: 10_000, releaseBp: 5000 }],
});

function Settings({ data }: { data: CommissionData }) {
  const [adding, setAdding] = useState<SchemeInput | null>(null);
  const covered = new Set(data.schemes.filter((s) => s.active).map((s) => s.branding ?? ""));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, flex: 1 }}>Schemes</h3>
        {data.brandings.filter((b) => !covered.has(b)).map((b) => (
          <Button key={b} variant="secondary" onClick={() => setAdding(newScheme(b))}>Add scheme for {b}</Button>
        ))}
        {!covered.has("") && <Button variant="secondary" onClick={() => setAdding(newScheme(null))}>Add scheme for all brands</Button>}
      </div>
      <div style={{ color: MUTED, fontSize: "var(--fs-12)" }}>
        Each brand follows its own scheme; a scheme for all brands covers any brand without one. Changing a scheme changes every unpaid figure at once; payouts already recorded stay.
      </div>
      {data.schemes.length === 0 && !adding && <div style={{ color: MUTED }}>No scheme yet.</div>}
      {adding && <SchemeCard scheme={null} initial={adding} data={data} onDone={() => setAdding(null)} />}
      {data.schemes.map((s) => <SchemeCard key={s.id} scheme={s} initial={s} data={data} />)}
    </div>
  );
}

const pctInput = (bp: number): string => String(Number((bp / 100).toFixed(2)));

function SchemeCard({ scheme, initial, data, onDone }: { scheme: CommissionScheme | null; initial: SchemeInput; data: CommissionData; onDone?: () => void }) {
  const [t, setT] = useState<SchemeInput>(initial);
  const [rates, setRates] = useState({ manager: pctInput(initial.managerBp), company: pctInput(initial.companyPoolBp) });
  const [tiers, setTiers] = useState(initial.tiers.map((x) => ({ from: rm0(x.fromSen).replace(/,/g, ""), pct: pctInput(x.bp) })));
  const [note, setNote] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useSaveScheme();
  const del = useDeleteScheme();
  const dialog = useDialog();
  const setStage = (i: number, s: Partial<CommissionStage>) => setT({ ...t, stages: t.stages.map((x, j) => (j === i ? { ...x, ...s } : x)) });
  const submit = async () => {
    setNote(null); setSaved(false);
    const managerBp = bpFromPct(rates.manager), companyPoolBp = bpFromPct(rates.company);
    const parsed = tiers.map((x) => ({ fromSen: senFromRm(x.from), bp: bpFromPct(x.pct) }));
    if (managerBp == null || companyPoolBp == null || parsed.some((x) => x.fromSen == null || x.bp == null)) {
      setNote("Enter each rate as a number like 1.25, and each monthly sales figure in RM like 60000."); return;
    }
    try {
      await save.mutateAsync({ id: scheme?.id ?? null, scheme: { ...t, managerBp, companyPoolBp, tiers: parsed.map((x) => ({ fromSen: x.fromSen ?? 0, bp: x.bp ?? 0 })) } });
      setSaved(true); onDone?.();
    } catch (e) { setNote(errText(e)); }
  };
  const managerBp = bpFromPct(rates.manager) ?? 0;
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)", fontSize: "var(--fs-13)", opacity: t.active ? 1 : 0.6 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "var(--space-3)" }}>
        <label className={styles.field}><span className={styles.fieldLabel}>Scheme name</span>
          <input className={styles.fieldInput} value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></label>
        <label className={styles.field}><span className={styles.fieldLabel}>Brand</span>
          <select className={styles.fieldInput} value={t.branding ?? ""} onChange={(e) => setT({ ...t, branding: e.target.value || null })}>
            <option value="">All brands</option>{[...new Set([...data.brandings, ...(t.branding ? [t.branding] : [])])].map((b) => <option key={b} value={b}>{b}</option>)}
          </select></label>
        <label className={styles.field}><span className={styles.fieldLabel}>Sales manager</span>
          <select className={styles.fieldInput} value={t.managerStaffId ?? ""} onChange={(e) => setT({ ...t, managerStaffId: e.target.value || null })}>
            <option value="">No manager</option>{data.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
        <label className={styles.field}><span className={styles.fieldLabel}>Manager rate (%)</span>
          <input className={styles.fieldInput} inputMode="decimal" value={rates.manager} onChange={(e) => setRates({ ...rates, manager: e.target.value })} /></label>
        <label className={styles.field}><span className={styles.fieldLabel}>Company pool (%)</span>
          <input className={styles.fieldInput} inputMode="decimal" value={rates.company} onChange={(e) => setRates({ ...rates, company: e.target.value })} /></label>
      </div>

      <div>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Salesperson rate by sales in the month (SO + VO)</div>
        {tiers.map((x, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(150px, 1fr) 110px minmax(120px, 1fr) auto", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <input className={styles.fieldInput} aria-label="From monthly sales (RM)" inputMode="decimal" value={x.from} onChange={(e) => setTiers(tiers.map((y, j) => (j === i ? { ...y, from: e.target.value } : y)))} />
            <input className={styles.fieldInput} aria-label="Salesperson rate (%)" inputMode="decimal" value={x.pct} onChange={(e) => setTiers(tiers.map((y, j) => (j === i ? { ...y, pct: e.target.value } : y)))} />
            <span style={{ color: MUTED }}>manager gets {pctText(Math.max(0, managerBp - (bpFromPct(x.pct) ?? 0)))}</span>
            <Button variant="ghost" onClick={() => setTiers(tiers.filter((_, j) => j !== i))}>Remove</Button>
          </div>
        ))}
        <div style={{ color: MUTED, fontSize: "var(--fs-12)", marginBottom: 4 }}>From RM (monthly sales), and the salesperson's %. Below the first tier the salesperson earns 0% and the manager the whole manager rate. A manager who opens the order earns the whole manager rate.</div>
        <Button variant="secondary" onClick={() => setTiers([...tiers, { from: "", pct: "" }])}>Add tier</Button>
      </div>

      <div>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Payout stages</div>
        {t.stages.map((s, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 1.4fr) minmax(160px, 1.2fr) 90px 110px auto", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <input className={styles.fieldInput} aria-label="Stage name" value={s.label} onChange={(e) => setStage(i, { label: e.target.value })} />
            <select className={styles.fieldInput} aria-label="When" value={s.kind} onChange={(e) => setStage(i, { kind: e.target.value as CommissionStage["kind"], value: e.target.value === "instalment" ? 2 : 10_000 })}>
              <option value="instalment">When payment no. is paid</option><option value="collected">When % collected</option>
            </select>
            <input className={styles.fieldInput} aria-label={s.kind === "instalment" ? "Payment number" : "Collected %"} inputMode="decimal"
              value={s.kind === "instalment" ? String(s.value) : String(s.value / 100)}
              onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) setStage(i, { value: s.kind === "instalment" ? Math.round(n) : Math.round(n * 100) }); }} />
            <input className={styles.fieldInput} aria-label="Release %" inputMode="decimal" value={String(s.releaseBp / 100)}
              onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) setStage(i, { releaseBp: Math.round(n * 100) }); }} />
            <Button variant="ghost" onClick={() => setT({ ...t, stages: t.stages.filter((_, j) => j !== i) })}>Remove</Button>
          </div>
        ))}
        <div style={{ color: MUTED, fontSize: "var(--fs-12)", marginBottom: 4 }}>Name, when it is reached, the payment number or % collected, and the % of the commission it releases. Now: {t.stages.map((s) => `${stageText(s)} ${pctText(s.releaseBp)}`).join(", ") || "none"}.</div>
        <Button variant="secondary" onClick={() => setT({ ...t, stages: [...t.stages, { label: "Last payment", kind: "collected", value: 10_000, releaseBp: 0 }] })}>Add stage</Button>
      </div>

      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" checked={t.active} onChange={(e) => setT({ ...t, active: e.target.checked })} /> Scheme in use
      </label>
      {note && <div role="alert" style={{ color: BAD }}>{note}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
        {saved && <span style={{ color: GOOD }}>Saved</span>}
        {scheme && <Button variant="ghost" onClick={async () => {
          setNote(null);
          if (!(await dialog.confirm(`Delete the scheme ${scheme.name}?`))) return;
          try { await del.mutateAsync(scheme.id); } catch (e) { setNote(errText(e)); }
        }}>Delete scheme</Button>}
        {onDone && <Button variant="secondary" onClick={onDone}>Cancel</Button>}
        <Button onClick={submit} disabled={save.isPending}>{save.isPending ? "Saving…" : scheme ? "Save scheme" : "Add scheme"}</Button>
      </div>
    </div>
  );
}
