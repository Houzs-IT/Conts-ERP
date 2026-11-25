// Conts only (not part of Houzs's code): Commission — /scm/commission (owner, 25 Nov 2026). Management only.
// Worked out on each load from the contracts, their VOs and the money collected; nothing to press.
// Monthly settlement: every claim ready to pay, old or new, ticked and paid in one go.
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
  bpFromPct, claimsOf, monthGroups, pctText, personTotals, senFromRm, stageText, useCommission, useDeleteScheme, useRecordPayout, useSaveScheme,
  useSettle, useVoidPayout, type Claim, type CommissionData, type CommissionPayout, type CommissionRow, type CommissionScheme,
  type CommissionShare, type CommissionStage, type PersonTotal, type SchemeInput,
} from "./commissionQueries";

type Tab = "settle" | "orders" | "people" | "months" | "payouts" | "settings";

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
  moneyCol<CommissionRow>("claimable", "Can claim (RM)", (r) => sum(r.shares, "claimableSen"), { strong: true }),
];

const PEOPLE_COLUMNS: Column<PersonTotal>[] = [
  { key: "name", label: "Person", render: (r) => <span style={{ fontWeight: 600 }}>{r.staffName}</span>, getValue: (r) => r.staffName },
  { key: "orders", label: "Orders", align: "right", render: (r) => <span style={num}>{r.orders}</span>, getValue: (r) => r.orders },
  moneyCol<PersonTotal>("total", "Commission (RM)", (r) => r.totalSen),
  moneyCol<PersonTotal>("earned", "Earned (RM)", (r) => r.earnedSen),
  moneyCol<PersonTotal>("paid", "Paid (RM)", (r) => r.paidSen),
  moneyCol<PersonTotal>("claimable", "Can claim (RM)", (r) => r.claimableSen, { strong: true }),
];

export function ContsCommission() {
  const q = useCommission();
  const [tab, setTab] = useState<Tab>("settle");
  const [open, setOpen] = useState<string | null>(null);
  const [person, setPerson] = useState<string>("");
  const data = q.data;
  const rows = useMemo(() => (data?.rows ?? []).filter((r) => !person || r.shares.some((s) => s.staffId === person) || r.salespersonId === person), [data, person]);
  const people = useMemo(() => personTotals(data?.rows ?? []), [data]);
  const toPay = people.reduce((t, p) => t + p.claimableSen, 0);
  const missing = (data?.rows ?? []).filter((r) => r.problem).length;
  const openRow = data?.rows.find((r) => r.soDocNo === open) ?? null;
  const claims = useMemo(() => claimsOf(data?.rows ?? []), [data]);

  return (
    <div className="space-y-4">
      <PageHeader title="Commission" description="Worked out from each order, its VOs and the money collected. Paid out in stages as the customer pays." />
      {data && (
        <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", fontSize: "var(--fs-13)" }}>
          <Kpi label="Can claim now" value={`RM ${rm(toPay)}`} strong />
          <Kpi label="Earned so far" value={`RM ${rm(people.reduce((t, p) => t + p.earnedSen, 0))}`} />
          <Kpi label="Paid" value={`RM ${rm(people.reduce((t, p) => t + p.paidSen, 0))}`} />
          {missing > 0 && <Kpi label="Orders with no commission" value={`${missing} of ${data.rows.length}`} bad />}
        </div>
      )}
      {data && data.schemes.filter((s) => s.active).length === 0 && (
        <div role="status" style={{ color: BAD }}>No commission scheme yet. Set one up under Settings to start working out commission.</div>
      )}
      <TabStrip<Tab> value={tab} onChange={setTab} options={[
        { value: "settle", label: "Monthly settlement", count: claims.length },
        { value: "orders", label: "By order" },
        { value: "people", label: "By person", count: people.length },
        { value: "months", label: "Monthly sales" },
        { value: "payouts", label: "Payouts" },
        { value: "settings", label: "Settings" },
      ]} />
      {q.isError && <div role="alert" style={{ color: BAD }}>{errText(q.error)}</div>}
      {tab === "settle" && data && <Settle claims={claims} onOpen={setOpen} />}
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
                <th style={th}>Month's sales</th><th style={th}>Salesperson</th><th style={th}>Manager</th><th style={th}>Salesperson RM</th><th style={th}>Manager RM</th><th style={th}>Rate</th>
              </tr></thead>
              <tbody>{row.portions.map((p, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px 0" }}>{p.month}</td><td style={{ paddingLeft: 8 }}>{SOURCE[p.source]}{p.source === "VO" ? ` ${p.ref}` : ""}</td>
                  <td style={td}>{rm(p.sen)}</td><td style={td}>{rm0(p.monthSalesSen)}</td>
                  <td style={td}>{pctText(p.salesBp)}</td><td style={td}>{pctText(p.managerBp)}</td>
                  <td style={td}>{rm(p.salesSen)}</td><td style={td}>{rm(p.managerSen)}</td>
                  <td style={{ ...td, color: p.lockedAt ? MUTED : undefined }}>{p.lockedAt ? "Locked" : "Month open"}</td>
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
                <th style={th}>Earned</th><th style={th}>Paid</th><th style={th}>Can claim</th><th />
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

/* ── Monthly sales: every SO and VO in the month, the tier it reached, the rate each line paid ── */
function Months({ data }: { data: CommissionData }) {
  const groups = useMemo(() => monthGroups(data.rows), [data]);
  const [person, setPerson] = useState("");
  const people = [...new Map(groups.map((g) => [g.staffId, g.staffName])).entries()].sort((x, y) => x[1].localeCompare(y[1]));
  const shown = groups.filter((g) => !person || g.staffId === person);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", fontSize: "var(--fs-13)" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label className={styles.field} style={{ maxWidth: 280 }}>
          <span className={styles.fieldLabel}>Salesperson</span>
          <select className={styles.fieldInput} value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="">Everyone</option>
            {people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <span style={{ color: MUTED, flex: 1, minWidth: 240 }}>Each SO counts in the month of its date and each VO in the month of its own date. The month total picks the tier. Once the month ends its rates are locked.</span>
      </div>
      {shown.length === 0 && <div style={{ color: MUTED }}>No sales yet under a scheme.</div>}
      {shown.map((g) => (
        <div key={g.key} style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "baseline", padding: "10px 14px", background: "var(--bg-subtle, rgba(0,0,0,0.03))" }}>
            <span style={{ fontWeight: 600, flex: 1, minWidth: 200 }}>{g.staffName} · {g.month}</span>
            <span style={{ color: MUTED }}>{g.schemeName}</span>
            <span style={{ ...num, fontWeight: 600 }}>RM {rm(g.totalSen)}</span>
            <span style={{ ...num, fontWeight: 600, color: GOOD }}>Salesperson {pctText(g.salesBp)}</span>
            <span style={{ color: MUTED }}>{g.locked ? "Locked" : "Month open"}</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead><tr style={{ color: MUTED }}>
                <th style={{ ...th, textAlign: "left", paddingLeft: 14 }}>Order / VO</th><th style={{ ...th, textAlign: "left" }}>Project</th><th style={{ ...th, textAlign: "left" }}>Date</th>
                <th style={th}>Sales (RM)</th><th style={th}>Salesperson</th><th style={th}>Manager</th><th style={{ ...th, paddingRight: 14 }}>Manager (RM)</th>
              </tr></thead>
              <tbody>{g.lines.map(({ row, portion: p }, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px 0 6px 14px" }}><span style={{ fontWeight: 600 }}>{p.source === "OTHER" ? "Other" : p.source}</span> {row.soDocNo}{p.source === "VO" ? ` ${p.ref}` : ""}</td>
                  <td style={{ paddingLeft: 8 }}>{row.projectName || row.customerName}</td>
                  <td style={{ paddingLeft: 8 }}>{p.date}</td>
                  <td style={td}>{rm(p.sen)}</td>
                  <td style={td}>{pctText(p.salesBp)} = {rm(p.salesSen)}</td>
                  <td style={td}>{p.managerName ? `${p.managerName} ${pctText(p.managerBp)}` : "—"}</td>
                  <td style={{ ...td, paddingRight: 14 }}>{rm(p.managerSen)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Monthly settlement: tick the claims being paid, mark them paid in one go ── */
function Settle({ claims, onOpen }: { claims: Claim[]; onOpen: (soDocNo: string) => void }) {
  const [person, setPerson] = useState("");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [paidOn, setPaidOn] = useState(today());
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const settle = useSettle();
  const dialog = useDialog();
  const people = [...new Map(claims.map((c) => [c.share.staffId, c.share.staffName])).entries()].sort((x, y) => x[1].localeCompare(y[1]));
  const shown = claims.filter((c) => !person || c.share.staffId === person);
  const chosen = shown.filter((c) => picked[c.key]);
  const chosenSen = chosen.reduce((t, c) => t + c.share.claimableSen, 0);
  const allPicked = shown.length > 0 && chosen.length === shown.length;
  const submit = async () => {
    setNote(null); setDone(null);
    if (chosen.length === 0) { setNote("Tick the claims you are paying."); return; }
    if (!paidOn) { setNote("Enter the date it was paid."); return; }
    if (!(await dialog.confirm(`Mark ${chosen.length} claim${chosen.length === 1 ? "" : "s"} as paid on ${paidOn}, RM ${rm(chosenSen)} in total?`))) return;
    try {
      await settle.mutateAsync({ paidOn, note: "", items: chosen.map((c) => ({ soDocNo: c.row.soDocNo, staffId: c.share.staffId, amountSen: c.share.claimableSen })) });
      setPicked({}); setDone(`Recorded ${chosen.length} payout${chosen.length === 1 ? "" : "s"}, RM ${rm(chosenSen)}.`);
    } catch (e) { setNote(errText(e)); }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", fontSize: "var(--fs-13)" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label className={styles.field} style={{ maxWidth: 280 }}>
          <span className={styles.fieldLabel}>Person</span>
          <select className={styles.fieldInput} value={person} onChange={(e) => { setPerson(e.target.value); setPicked({}); }}>
            <option value="">Everyone</option>
            {people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <span style={{ color: MUTED, flex: 1, minWidth: 240 }}>Every order whose customer has paid far enough, however old. Amounts use the rates locked when each month closed.</span>
      </div>
      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
          <thead><tr style={{ color: MUTED }}>
            <th style={{ ...th, textAlign: "left", paddingLeft: 12, width: 32 }}>
              <input type="checkbox" aria-label="Tick every claim" checked={allPicked}
                onChange={(e) => setPicked(e.target.checked ? Object.fromEntries(shown.map((c) => [c.key, true])) : {})} />
            </th>
            <th style={{ ...th, textAlign: "left" }}>Person</th><th style={{ ...th, textAlign: "left" }}>Order</th><th style={{ ...th, textAlign: "left" }}>Project</th>
            <th style={th}>Released</th><th style={th}>Commission</th><th style={th}>Paid before</th><th style={{ ...th, paddingRight: 12 }}>Can claim</th>
          </tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={8} style={{ padding: 14, color: MUTED }}>Nothing to claim right now.</td></tr>}
            {shown.map((c) => (
              <tr key={c.key} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "6px 0 6px 12px" }}>
                  <input type="checkbox" aria-label={`Pay ${c.share.staffName} on ${c.row.soDocNo}`} checked={!!picked[c.key]}
                    onChange={(e) => setPicked({ ...picked, [c.key]: e.target.checked })} />
                </td>
                <td style={{ paddingLeft: 8 }}><div style={{ fontWeight: 600 }}>{c.share.staffName}</div><div style={{ color: MUTED }}>{ROLE[c.share.role]}</div></td>
                <td style={{ paddingLeft: 8 }}>
                  <button type="button" onClick={() => onOpen(c.row.soDocNo)} style={{ border: 0, background: "none", padding: 0, color: "var(--c-link, #1f5c4a)", cursor: "pointer", font: "inherit" }}>{c.row.soDocNo}</button>
                  <div style={{ color: MUTED }}>{c.row.soDate ?? ""}</div>
                </td>
                <td style={{ paddingLeft: 8 }}>{c.row.projectName || c.row.customerName}</td>
                <td style={td}>{pctText(c.row.releasedBp)}</td>
                <td style={td}>{rm(c.share.totalSen)}</td>
                <td style={td}>{rm(c.share.paidSen)}</td>
                <td style={{ ...td, paddingRight: 12, fontWeight: 600, color: GOOD }}>{rm(c.share.claimableSen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", justifyContent: "flex-end" }}>
        <span style={{ ...num, fontWeight: 600, flex: 1, minWidth: 200 }}>{chosen.length > 0 ? `${chosen.length} ticked · RM ${rm(chosenSen)}` : `${shown.length} claims · RM ${rm(shown.reduce((t, c) => t + c.share.claimableSen, 0))}`}</span>
        <label className={styles.field} style={{ width: 170 }}><span className={styles.fieldLabel}>Paid on</span><DateField value={paidOn} onChange={(v) => setPaidOn(v)} /></label>
        <Button onClick={submit} disabled={settle.isPending || chosen.length === 0}>{settle.isPending ? "Saving…" : "Mark ticked as paid"}</Button>
      </div>
      {note && <div role="alert" style={{ color: BAD }}>{note}</div>}
      {done && <div role="status" style={{ color: GOOD }}>{done}</div>}
    </div>
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
        Each brand follows its own scheme; a scheme for all brands covers any brand without one. A change applies to months still open; months already closed keep the rates locked when they closed, unless you tick "Also apply to closed months" when saving.
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
  const [relock, setRelock] = useState(false);
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
      if (relock && !(await dialog.confirm("Recalculate every closed month of this scheme at the new rates? Money already paid stays paid; what is left to claim follows the new figures."))) return;
      await save.mutateAsync({ id: scheme?.id ?? null, scheme: { ...t, managerBp, companyPoolBp, tiers: parsed.map((x) => ({ fromSen: x.fromSen ?? 0, bp: x.bp ?? 0 })) }, relockClosedMonths: relock });
      setSaved(true); setRelock(false); onDone?.();
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
      {scheme && (
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={relock} onChange={(e) => setRelock(e.target.checked)} /> Also apply to closed months (normally only open months change)
        </label>
      )}
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
