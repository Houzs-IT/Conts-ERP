// Conts only (not part of Houzs's code): Commission — /scm/commission and /scm/my-commission (owner, 25 Nov 2026).
// Sensitive: management sees everyone; a scheme's sales manager sees that scheme; everyone else only their own share
// (the backend decides and says so in `viewer`). A salesperson gets one page: their month, their orders, what they can claim.
// Worked out on each load from the contracts, their VOs and the money collected; nothing to press.
// Monthly settlement: every claim ready to pay, old or new, ticked and paid in one go; filter and sort by any column.
// People and orders: the people on the left with what each can claim; pick one for their months (sales, rate,
// commission, claimed) and their orders with how each adds up, or Everyone for every order.
// Payouts: every payment, taken back but never deleted. Settings: one scheme per brand.
// The math is the backend's (scm/shared/renovation-commission.ts); this page only sums for display.
import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/Layout";
import { DataTable, type Column } from "../components/DataTable";
import { TabStrip } from "../components/TabStrip";
import { Button } from "../components/Button";
import { StatCard } from "../components/StatCard";
import { Modal } from "../vendor/scm/components/Modal";
import { DateField } from "../vendor/scm/components/DateField";
import styles from "../pages/scm-v2/SalesOrderDetail.module.css";
import { useDialog } from "../hooks/useDialog";
import {
  bpFromPct, claimParts, claimsOf, personMonths, pctText, personTotals, senFromRm, stageText, useCommission, useDeleteScheme, useRecordPayout, useSaveScheme,
  useSettle, useVoidPayout, type Claim, type CommissionData, type CommissionPayout, type CommissionRow, type CommissionScheme,
  type CommissionShare, type CommissionStage, type PersonMonth, type PersonTotal, type SchemeInput,
} from "./commissionQueries";

type Tab = "settle" | "overview" | "payouts" | "settings";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (m: string): string => `${MON[Number(m.slice(5, 7)) - 1] ?? ""} ${m.slice(0, 4)}`;

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

export function ContsCommission() {
  const q = useCommission();
  const [tabPicked, setTab] = useState<Tab | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const data = q.data;
  const people = useMemo(() => personTotals(data?.rows ?? []), [data]);
  const toPay = people.reduce((t, p) => t + p.claimableSen, 0);
  const missing = (data?.rows ?? []).filter((r) => r.problem).length;
  const openRow = data?.rows.find((r) => r.soDocNo === open) ?? null;
  const claims = useMemo(() => claimsOf(data?.rows ?? []), [data]);
  const viewer = data?.viewer;
  const plain = viewer != null && !viewer.isAdmin && viewer.editableSchemeIds.length === 0;
  const tab: Tab = tabPicked ?? (viewer?.canPay ? "settle" : "overview");
  /* Biggest claim first, so the people waiting on money are at the top; the viewer leads when they have any. */
  const personList = useMemo(() => {
    const list = [...people].sort((a, b) => b.claimableSen - a.claimableSen || a.staffName.localeCompare(b.staffName));
    const mine = list.findIndex((x) => x.staffId === viewer?.staffId);
    if (mine > 0) list.unshift(...list.splice(mine, 1));
    return list;
  }, [people, viewer]);
  const myself: PersonTotal[] = viewer?.staffId
    ? [people.find((p) => p.staffId === viewer.staffId) ?? { staffId: viewer.staffId, staffName: "Me", orders: 0, totalSen: 0, earnedSen: 0, paidSen: 0, claimableSen: 0 }]
    : [];

  if (plain && data) {
    return (
      <div className="space-y-4">
        <PageHeader title="My commission" description="Your sales each month, the rate they reached, your commission on every order, and what you can claim. Only you see this." />
        {q.isError && <div role="alert" style={{ color: BAD }}>{errText(q.error)}</div>}
        <Overview data={data} people={myself} allowEveryone={false} onOpen={setOpen} />
        {openRow && <OrderDialog row={openRow} payouts={data.payouts.filter((p) => p.soDocNo === openRow.soDocNo)} canPay={false} onClose={() => setOpen(null)} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Commission" description="Worked out from each order, its VOs and the money collected. Paid out in stages as the customer pays." />
      {data && (
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <StatCard label="Can claim now" value={`RM ${rm(toPay)}`} tone="success" />
          <StatCard label="Earned so far" value={`RM ${rm(people.reduce((t, p) => t + p.earnedSen, 0))}`} />
          <StatCard label="Paid" value={`RM ${rm(people.reduce((t, p) => t + p.paidSen, 0))}`} />
          {missing > 0 && <StatCard label="Orders with no commission" value={`${missing} of ${data.rows.length}`} tone="error" />}
        </div>
      )}
      {data && data.schemes.filter((s) => s.active).length === 0 && (
        <div role="status" style={{ color: BAD }}>No commission scheme yet. Set one up under Settings to start working out commission.</div>
      )}
      <TabStrip<Tab> value={tab} onChange={setTab} options={[
        ...(viewer?.canPay ? [{ value: "settle" as const, label: "Monthly settlement", count: claims.length }] : []),
        { value: "overview", label: "People and orders", count: people.length },
        ...(viewer?.canPay ? [{ value: "payouts" as const, label: "Payouts" }] : []),
        { value: "settings", label: "Settings" },
      ]} />
      {q.isError && <div role="alert" style={{ color: BAD }}>{errText(q.error)}</div>}
      {tab === "settle" && data && viewer?.canPay && <Settle claims={claims} onOpen={setOpen} />}
      {tab === "overview" && data && <Overview data={data} people={personList} allowEveryone onOpen={setOpen} />}
      {tab === "payouts" && data && <Payouts data={data} claims={claims} onOpen={setOpen} />}
      {tab === "settings" && data && <Settings data={data} />}
      {openRow && data && <OrderDialog row={openRow} payouts={data.payouts.filter((p) => p.soDocNo === openRow.soDocNo)} canPay={data.viewer.canPay} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Kpi({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ minWidth: 150 }}>
      <StatCard label={label} value={value} tone={strong ? "success" : "default"} />
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "right", fontWeight: 500, padding: "4px 0 4px 8px" };
const td: React.CSSProperties = { ...num, textAlign: "right", padding: "6px 0 6px 8px" };

const chip: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 999, background: "var(--bg-subtle, rgba(0,0,0,0.04))", fontSize: "var(--fs-12)", whiteSpace: "nowrap" };
const sectionTitle: React.CSSProperties = { margin: "0 0 8px", fontSize: "var(--fs-14, 14px)", fontWeight: 700 };

function Fact({ label, value, sub, bar }: { label: string; value: string; sub?: string; bar?: number }) {
  return (
    <div style={{ background: "var(--bg, #fff)", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ color: MUTED, fontSize: "var(--fs-12)" }}>{label}</span>
      <span style={{ ...num, fontWeight: 700, fontSize: "var(--fs-16, 16px)" }}>{value}{sub && <span style={{ color: MUTED, fontWeight: 500, fontSize: "var(--fs-12)" }}> {sub}</span>}</span>
      {bar != null && <div style={{ height: 5, borderRadius: 999, background: "var(--bg-subtle, rgba(0,0,0,0.08))" }}><div style={{ height: 5, borderRadius: 999, width: `${Math.min(100, bar / 100)}%`, background: GOOD }} /></div>}
    </div>
  );
}
function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div><div style={{ color: MUTED, fontSize: "var(--fs-12)" }}>{label}</div><div style={{ ...num, fontWeight: 600 }}>{value}</div></div>
  );
}

/* ── One order: months, stages, the split per person, and paying it ──────── */
function OrderDialog({ row, payouts, canPay, onClose }: { row: CommissionRow; payouts: CommissionPayout[]; canPay: boolean; onClose: () => void }) {
  const [paying, setPaying] = useState<CommissionShare | null>(null);
  const voidPayout = useVoidPayout();
  const [takingBack, setTakingBack] = useState<string | null>(null);
  /* A salesperson is sent only their own side (the backend blanks the other); show only the columns that came. */
  const showSales = row.portions.some((p) => p.salespersonName !== "" || p.salesSen !== 0);
  const showManager = row.portions.some((p) => p.managerName != null || p.managerSen !== 0);
  const [note, setNote] = useState<string | null>(null);
  return (
    <Modal title={row.projectName || row.customerName} ariaLabel="Commission on this order" onClose={onClose} width="min(900px, 100%)">
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", fontSize: "var(--fs-13)" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span style={{ ...chip, fontFamily: "var(--font-mono, ui-monospace, monospace)", fontWeight: 600 }}>{row.soDocNo}</span>
          <span style={{ color: MUTED }}>{row.soDate ?? ""}</span>
          {row.branding && <span style={chip}>{row.branding}</span>}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 1, background: "var(--line)", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
          <Fact label="Contract" value={`RM ${rm(row.baseSen)}`} />
          <Fact label="Collected" value={`RM ${rm(row.collectedSen)}`} sub={pctText(row.collectedBp)} bar={row.collectedBp} />
          <Fact label="Commission released" value={row.problem ? "—" : pctText(row.releasedBp)} sub={row.stages.length ? `${row.stages.filter((x) => x.reached).length} of ${row.stages.length} stages reached` : undefined} />
          <Fact label="Total commission" value={`RM ${rm(sum(row.shares, "totalSen"))}`} />
        </div>

        {row.problem && <div role="status" style={{ color: BAD }}>{PROBLEM[row.problem]}. {row.problem === "no_scheme" ? "Add a scheme for this brand under Settings." : "Set the salesperson on the sales order."}</div>}

        {row.stages.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {row.stages.map((x, i) => (
              <span key={i} style={{ ...chip, background: x.reached ? "var(--c-success-bg)" : "var(--bg-subtle, rgba(0,0,0,0.04))", color: x.reached ? GOOD : MUTED }}>
                {x.reached ? "✓" : "○"} {x.label}{x.thresholdBp == null ? " (no such payment)" : ""} · releases {pctText(x.releaseBp)}
              </span>
            ))}
          </div>
        )}

        {!row.problem && (
          <section>
            <h3 style={sectionTitle}>Commission by part</h3>
            <div className="rounded-xl border border-border bg-surface shadow-stone" style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
                <thead><tr className="bg-surface-2" style={{ color: MUTED }}>
                  <th style={{ ...th, textAlign: "left", paddingLeft: 12 }}>Part</th><th style={{ ...th, textAlign: "left" }}>Month</th><th style={th}>Amount</th>
                  {showSales && <th style={th}>Month&apos;s sales</th>}{showSales && <th style={th}>Salesperson</th>}{showManager && <th style={th}>Manager</th>}<th style={{ ...th, paddingRight: 12 }}>Rate</th>
                </tr></thead>
                <tbody>
                  {row.portions.map((p, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                      <td style={{ padding: "8px 0 8px 12px", fontWeight: 600 }}>{p.source === "SO" ? "Sales order" : p.source === "VO" ? p.ref : "Other changes"}</td>
                      <td style={{ paddingLeft: 8 }}>{monthLabel(p.month)}</td>
                      <td style={td}>{rm(p.sen)}</td>
                      {showSales && <td style={{ ...td, color: MUTED }}>{rm0(p.monthSalesSen)}</td>}
                      {showSales && <td style={td}>{pctText(p.salesBp)} · <strong>{rm(p.salesSen)}</strong></td>}
                      {showManager && <td style={td}>{pctText(p.managerBp)} · <strong>{rm(p.managerSen)}</strong></td>}
                      <td style={{ ...td, paddingRight: 12 }}><span style={{ ...chip, color: p.lockedAt ? MUTED : GOOD }}>{p.lockedAt ? "Locked" : "Month open"}</span></td>
                    </tr>
                  ))}
                  {row.portions.length > 1 && (
                    <tr style={{ borderTop: "2px solid var(--line)", fontWeight: 600 }}>
                      <td style={{ padding: "8px 0 8px 12px" }} colSpan={2}>Total</td>
                      <td style={td}>{rm(row.portions.reduce((t, p) => t + p.sen, 0))}</td>
                      {showSales && <td />}
                      {showSales && <td style={td}>{rm(row.portions.reduce((t, p) => t + p.salesSen, 0))}</td>}
                      {showManager && <td style={td}>{rm(row.portions.reduce((t, p) => t + p.managerSen, 0))}</td>}<td />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {row.shares.length > 0 && (
          <section>
            <h3 style={sectionTitle}>Who gets what</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
              {row.shares.map((s) => (
                <div key={s.staffId} className="rounded-xl border border-border bg-surface shadow-stone" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, fontSize: "var(--fs-15, 15px)", flex: 1 }}>{s.staffName}</span>
                    <span style={chip}>{ROLE[s.role]}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr)) 1.3fr", gap: 8, alignItems: "end" }}>
                    <Mini label="Commission" value={rm(s.totalSen)} />
                    <Mini label="Earned" value={rm(s.earnedSen)} />
                    <Mini label="Paid" value={rm(s.paidSen)} />
                    <div style={{ textAlign: "right" }}>
                      <div style={{ color: MUTED, fontSize: "var(--fs-12)" }}>Can claim</div>
                      <div style={{ ...num, fontWeight: 700, fontSize: "var(--fs-18, 18px)", color: s.claimableSen > 0 ? GOOD : undefined }}>RM {rm(s.claimableSen)}</div>
                    </div>
                  </div>
                  <details>
                    <summary style={{ cursor: "pointer", color: MUTED }}>How it adds up, part by part</summary>
                    <div style={{ overflowX: "auto", marginTop: 8 }}><ClaimBreakdown row={row} share={s} /></div>
                  </details>
                  {canPay && <Button variant="secondary" onClick={() => setPaying(s)}>Record payout</Button>}
                </div>
              ))}
            </div>
          </section>
        )}

        {payouts.length > 0 && (
          <section>
            <h3 style={sectionTitle}>Paid on this order</h3>
            <div className="rounded-xl border border-border bg-surface shadow-stone">
              {payouts.map((p, i) => (
                <div key={p.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "8px 12px", borderTop: i ? "1px solid var(--line)" : undefined, textDecoration: p.voidedAt ? "line-through" : undefined, color: p.voidedAt ? MUTED : undefined }}>
                  <span style={{ width: 96, color: MUTED }}>{p.paidOn}</span><span style={{ flex: 1 }}>{p.staffName}{p.note ? ` · ${p.note}` : ""}</span>
                  <span style={{ ...num, fontWeight: 600 }}>RM {rm(p.amountSen)}</span>
                  {/* Asked here, not in a pop-up: a pop-up opens behind this dialog. */}
                  {!p.voidedAt && canPay && takingBack !== p.id && <Button variant="ghost" onClick={() => { setNote(null); setTakingBack(p.id); }}>Take back</Button>}
                  {!p.voidedAt && canPay && takingBack === p.id && (
                    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", textDecoration: "none" }}>
                      <span style={{ color: BAD }}>Take back? It stays listed.</span>
                      <Button variant="secondary" disabled={voidPayout.isPending} onClick={async () => {
                        try { await voidPayout.mutateAsync(p.id); setTakingBack(null); } catch (e) { setNote(errText(e)); }
                      }}>Yes, take back</Button>
                      <Button variant="ghost" onClick={() => setTakingBack(null)}>No</Button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
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
  /* More than can be claimed: asked by a second press, not a pop-up (a pop-up opens behind this dialog). */
  const [overOk, setOverOk] = useState<number | null>(null);
  const submit = async () => {
    setNote(null);
    const sen = senFromRm(amount);
    const problems = [...(sen == null || sen <= 0 ? ["Enter the amount paid in RM."] : []), ...(!paidOn ? ["Enter the date it was paid."] : [])];
    if (problems.length > 0 || sen == null) { setNote(problems.join(" ")); return; }
    if (sen > share.claimableSen && overOk !== sen) {
      setOverOk(sen);
      setNote(`RM ${rm(sen)} is more than the RM ${rm(share.claimableSen)} earned and not yet paid. Press "Record anyway" to save it.`);
      return;
    }
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
          <Button onClick={submit} disabled={save.isPending}>{save.isPending ? "Saving…" : overOk != null && overOk === senFromRm(amount) ? "Record anyway" : "Save payout"}</Button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Monthly sales: every SO and VO in the month, the tier it reached, the rate each line paid ── */
/* ── Monthly settlement: tick the claims being paid, mark them paid in one go ── */
type SettleSortKey = "person" | "role" | "order" | "date" | "project" | "released" | "total" | "paid" | "claim";
const SETTLE_SORT: Record<SettleSortKey, (c: Claim) => string | number> = {
  person: (c) => c.share.staffName, role: (c) => ROLE[c.share.role], order: (c) => c.row.soDocNo, date: (c) => c.row.soDate ?? "",
  project: (c) => c.row.projectName || c.row.customerName, released: (c) => c.row.releasedBp, total: (c) => c.share.totalSen,
  paid: (c) => c.share.paidSen, claim: (c) => c.share.claimableSen,
};
function Settle({ claims, onOpen }: { claims: Claim[]; onOpen: (soDocNo: string) => void }) {
  const [person, setPerson] = useState("");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [paidOn, setPaidOn] = useState(today());
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const settle = useSettle();
  const dialog = useDialog();
  const people = [...new Map(claims.map((c) => [c.share.staffId, c.share.staffName])).entries()].sort((x, y) => x[1].localeCompare(y[1]));
  const [role, setRole] = useState("");
  const [brand, setBrand] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SettleSortKey; desc: boolean }>({ key: "date", desc: false });
  const brands = [...new Set(claims.map((c) => c.row.branding ?? ""))].sort();
  const q = query.trim().toLowerCase();
  const shown = claims
    .filter((c) => (!person || c.share.staffId === person) && (!role || c.share.role === role) && (!brand || (c.row.branding ?? "") === brand)
      && (!q || `${c.row.soDocNo} ${c.row.projectName} ${c.row.customerName}`.toLowerCase().includes(q)))
    .sort((x, y) => {
      const a = SETTLE_SORT[sort.key](x), b = SETTLE_SORT[sort.key](y);
      const d = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
      return sort.desc ? -d : d;
    });
  const head = (key: SettleSortKey, label: string, left = false, extra: React.CSSProperties = {}) => (
    <th style={{ ...th, ...(left ? { textAlign: "left" as const } : {}), ...extra }} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button type="button" onClick={() => setSort(sort.key === key ? { key, desc: !sort.desc } : { key, desc: false })}
        style={{ border: 0, background: "none", padding: 0, font: "inherit", color: "inherit", cursor: "pointer", fontWeight: sort.key === key ? 600 : 500 }}>
        {label}{sort.key === key ? (sort.desc ? " \u2193" : " \u2191") : ""}
      </button>
    </th>
  );
  const resetPick = () => setPicked({});
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
        <label className={styles.field} style={{ maxWidth: 180 }}>
          <span className={styles.fieldLabel}>Role</span>
          <select className={styles.fieldInput} value={role} onChange={(e) => { setRole(e.target.value); resetPick(); }}>
            <option value="">Any role</option>
            {Object.entries(ROLE).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        {brands.length > 1 && (
          <label className={styles.field} style={{ maxWidth: 180 }}>
            <span className={styles.fieldLabel}>Brand</span>
            <select className={styles.fieldInput} value={brand} onChange={(e) => { setBrand(e.target.value); resetPick(); }}>
              <option value="">Every brand</option>
              {brands.map((b) => <option key={b} value={b}>{b || "No brand"}</option>)}
            </select>
          </label>
        )}
        <label className={styles.field} style={{ maxWidth: 240 }}>
          <span className={styles.fieldLabel}>Search</span>
          <input className={styles.fieldInput} value={query} placeholder="SO, project or customer" onChange={(e) => { setQuery(e.target.value); resetPick(); }} />
        </label>
        <span style={{ color: MUTED, flex: 1, minWidth: 240 }}>Every order whose customer has paid far enough, however old. Amounts use the rates locked when each month closed.</span>
      </div>
      <div className="rounded-xl border border-border bg-surface shadow-stone" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
          <thead><tr style={{ color: MUTED }}>
            <th style={{ ...th, textAlign: "left", paddingLeft: 12, width: 32 }}>
              <input type="checkbox" aria-label="Tick every claim" checked={allPicked}
                onChange={(e) => setPicked(e.target.checked ? Object.fromEntries(shown.map((c) => [c.key, true])) : {})} />
            </th>
            {head("person", "Person", true)}{head("role", "Role", true)}{head("order", "Order", true)}{head("date", "SO date", true)}{head("project", "Project", true)}
            {head("total", "Total comm")}{head("claim", "Claim now", false, { paddingRight: 12 })}
          </tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={8} style={{ padding: 14, color: MUTED }}>Nothing to claim right now.</td></tr>}
            {shown.map((c) => (
              <tr key={c.key} style={{ borderTop: "1px solid var(--line)" }}>
                <td style={{ padding: "6px 0 6px 12px" }}>
                  <input type="checkbox" aria-label={`Pay ${c.share.staffName} on ${c.row.soDocNo}`} checked={!!picked[c.key]}
                    onChange={(e) => setPicked({ ...picked, [c.key]: e.target.checked })} />
                </td>
                <td style={{ paddingLeft: 8, fontWeight: 600 }}>{c.share.staffName}</td>
                <td style={{ paddingLeft: 8, color: MUTED }}>{ROLE[c.share.role]}</td>
                <td style={{ paddingLeft: 8 }}>
                  <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onOpen(c.row.soDocNo)} style={{ border: 0, background: "none", padding: 0, cursor: "pointer", font: "inherit" }}>{c.row.soDocNo}</button>
                </td>
                <td style={{ paddingLeft: 8, color: MUTED, whiteSpace: "nowrap" }}>{c.row.soDate ?? ""}</td>
                <td style={{ paddingLeft: 8 }}>{c.row.projectName || c.row.customerName}</td>
                <td style={td}>{rm(c.share.totalSen)}</td>
                <td style={{ ...td, paddingRight: 12 }}>
                  <div style={{ fontWeight: 600, color: GOOD }}>{rm(c.share.claimableSen)}</div>
                  {(c.row.releasedBp < 10_000 || c.share.paidSen > 0) && (
                    <div style={{ color: MUTED, fontSize: "var(--fs-12, 12px)" }}>
                      {[c.row.releasedBp < 10_000 ? `${pctText(c.row.releasedBp)} released` : "", c.share.paidSen > 0 ? `${rm(c.share.paidSen)} claimed before` : ""].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </td>
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
/* Payouts: the month's panel HR pays from (owner, 26 Nov 2026). Per person: what was paid that month, and what can be
   claimed now split into the person's own orders and the team orders they earn on as manager. HR ticks and records the
   payment here; it then shows under the month it was paid in. */
function Payouts({ data, claims, onOpen }: { data: CommissionData; claims: Claim[]; onOpen: (soDocNo: string) => void }) {
  const thisMonth = today().slice(0, 7);
  const live = data.payouts.filter((p) => !p.voidedAt);
  const monthList = [...new Set([thisMonth, ...live.map((p) => p.paidOn.slice(0, 7))])].sort().reverse();
  const [month, setMonth] = useState(thisMonth);
  const [openPerson, setOpenPerson] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [paidOn, setPaidOn] = useState(today());
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const settle = useSettle();
  const dialog = useDialog();
  const project = (so: string) => { const r = data.rows.find((x) => x.soDocNo === so); return r ? r.projectName || r.customerName : ""; };
  const isOwn = (c: Claim) => c.share.role === "sales" || c.row.salespersonId === c.share.staffId;
  const inMonth = live.filter((p) => p.paidOn.startsWith(month));
  const people = new Map<string, { id: string; name: string; paid: CommissionPayout[]; own: Claim[]; team: Claim[] }>();
  const at = (id: string, name: string) => { let x = people.get(id); if (!x) { x = { id, name, paid: [], own: [], team: [] }; people.set(id, x); } return x; };
  for (const p of inMonth) at(p.staffId, p.staffName).paid.push(p);
  for (const c of claims) { const x = at(c.share.staffId, c.share.staffName); (isOwn(c) ? x.own : x.team).push(c); }
  const list = [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
  const paidSum = (xs: CommissionPayout[]) => xs.reduce((t, p) => t + p.amountSen, 0);
  const claimSum = (xs: Claim[]) => xs.reduce((t, c) => t + c.share.claimableSen, 0);
  const allPaid = list.flatMap((x) => x.paid);
  const allOpen = claims;

  const pay = async (person: { name: string; own: Claim[]; team: Claim[] }) => {
    setNote(null); setDone(null);
    const chosen = [...person.own, ...person.team].filter((c) => picked[c.key]);
    if (chosen.length === 0) { setNote("Tick the orders you are paying."); return; }
    if (!paidOn) { setNote("Enter the date it was paid."); return; }
    const sen = claimSum(chosen);
    if (!(await dialog.confirm(`Record RM ${rm(sen)} paid to ${person.name} on ${paidOn} for ${chosen.length} order${chosen.length === 1 ? "" : "s"}?`))) return;
    try {
      await settle.mutateAsync({ paidOn, note: "", items: chosen.map((c) => ({ soDocNo: c.row.soDocNo, staffId: c.share.staffId, amountSen: c.share.claimableSen })) });
      setPicked({}); setMonth(paidOn.slice(0, 7));
      setDone(`Recorded RM ${rm(sen)} paid to ${person.name} on ${paidOn}. It now shows under ${monthLabel(paidOn.slice(0, 7))}.`);
    } catch (e) { setNote(errText(e)); }
  };

  const claimTable = (title: string, rows: Claim[]) => rows.length === 0 ? null : (
    <>
      <tr style={{ background: "var(--bg-subtle, rgba(0,0,0,0.03))" }}>
        <td colSpan={6} style={{ padding: "6px 10px", fontWeight: 600 }}>{title} ({rows.length})</td>
        <td style={{ ...td, paddingRight: 10, fontWeight: 600 }}>{rm(claimSum(rows))}</td>
      </tr>
      {rows.map((c) => (
        <tr key={c.key} style={{ borderTop: "1px solid var(--border)" }}>
          <td style={{ padding: "6px 0 6px 10px", width: 28 }}>
            <input type="checkbox" aria-label={`Pay ${c.row.soDocNo}`} checked={!!picked[c.key]} onChange={(e) => setPicked({ ...picked, [c.key]: e.target.checked })} />
          </td>
          <td style={{ paddingLeft: 8, whiteSpace: "nowrap" }}>
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onOpen(c.row.soDocNo)} style={{ border: 0, background: "none", padding: 0, cursor: "pointer", font: "inherit" }}>{c.row.soDocNo}</button>
          </td>
          <td style={{ paddingLeft: 8 }}>{c.row.projectName || c.row.customerName}</td>
          <td style={{ paddingLeft: 8, color: MUTED }}>{isOwn(c) ? "Own sale" : `Manager · ${c.row.salespersonName ?? "team"}`}</td>
          <td style={td}>{rm(c.share.totalSen)}</td>
          <td style={td}>{rm(c.share.paidSen)}</td>
          <td style={{ ...td, paddingRight: 10 }}>
            <div style={{ fontWeight: 600, color: GOOD }}>{rm(c.share.claimableSen)}</div>
            {c.row.releasedBp < 10_000 && <div style={{ color: MUTED, fontSize: "var(--fs-12, 12px)" }}>{pctText(c.row.releasedBp)} released</div>}
          </td>
        </tr>
      ))}
    </>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", fontSize: "var(--fs-13)" }}>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label className={styles.field} style={{ width: 180 }}>
          <span className={styles.fieldLabel}>Month</span>
          <select className={styles.fieldInput} value={month} onChange={(e) => { setMonth(e.target.value); setOpenPerson(null); }}>
            {monthList.map((x) => <option key={x} value={x}>{monthLabel(x)}</option>)}
          </select>
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingBottom: 4 }}>
          <span style={{ color: MUTED }}>Paid in {monthLabel(month)}</span>
          <span style={{ fontSize: "var(--fs-18, 18px)", fontWeight: 700 }}>RM {rm(paidSum(allPaid))} <span style={{ fontSize: "var(--fs-13)", fontWeight: 400, color: MUTED }}>on {allPaid.length} order{allPaid.length === 1 ? "" : "s"}</span></span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingBottom: 4 }}>
          <span style={{ color: MUTED }}>Can claim now, not paid yet</span>
          <span style={{ fontSize: "var(--fs-18, 18px)", fontWeight: 700, color: GOOD }}>RM {rm(claimSum(allOpen))} <span style={{ fontSize: "var(--fs-13)", fontWeight: 400, color: MUTED }}>on {allOpen.length} order{allOpen.length === 1 ? "" : "s"}</span></span>
        </div>
      </div>
      <div style={{ color: MUTED }}>Click a person to see each order they can claim. Tick what HR pays and press Record payment; it then shows under the month it was paid in. A wrong payment can be taken back from its order: click the order number.</div>
      {note && <div role="alert" style={{ color: BAD }}>{note}</div>}
      {done && <div role="status" style={{ color: GOOD }}>{done}</div>}

      <div className="rounded-xl border border-border bg-surface shadow-stone" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
          <thead><tr style={{ color: MUTED }}>
            <th style={{ ...th, textAlign: "left", paddingLeft: 14 }}>Person</th>
            <th style={th}>Paid in {monthLabel(month)}</th>
            <th style={th}>Own orders to claim</th>
            <th style={th}>Team orders to claim</th>
            <th style={{ ...th, paddingRight: 14 }}>Can claim now</th>
          </tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={5} style={{ padding: 14, color: MUTED }}>Nothing paid or waiting.</td></tr>}
            {list.map((x) => {
              const opened = openPerson === x.id;
              const both = [...x.own, ...x.team];
              const ticked = both.filter((c) => picked[c.key]);
              return (
                <Fragment key={x.id}>
                  <tr style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }} onClick={() => setOpenPerson(opened ? null : x.id)}>
                    <td style={{ padding: "8px 0 8px 14px", fontWeight: 600 }}>{opened ? "▾" : "▸"} {x.name}</td>
                    <td style={td}>RM {rm(paidSum(x.paid))} <span style={{ color: MUTED }}>({x.paid.length})</span></td>
                    <td style={td}>RM {rm(claimSum(x.own))} <span style={{ color: MUTED }}>({x.own.length})</span></td>
                    <td style={td}>RM {rm(claimSum(x.team))} <span style={{ color: MUTED }}>({x.team.length})</span></td>
                    <td style={{ ...td, paddingRight: 14, fontWeight: 700, color: both.length ? GOOD : MUTED }}>RM {rm(claimSum(both))}</td>
                  </tr>
                  {opened && (
                    <tr><td colSpan={5} style={{ padding: "4px 14px 16px" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        <div style={{ fontWeight: 700 }}>Can claim now: RM {rm(claimSum(both))}</div>
                        {both.length === 0 ? <div style={{ color: MUTED }}>Nothing waiting.</div> : (
                          <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflowX: "auto" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                              <thead><tr style={{ color: MUTED }}>
                                <th style={{ ...th, textAlign: "left", paddingLeft: 10 }}>
                                  <input type="checkbox" aria-label="Tick every order" checked={ticked.length === both.length}
                                    onChange={(e) => { const p = { ...picked }; for (const c of both) p[c.key] = e.target.checked; setPicked(p); }} />
                                </th>
                                <th style={{ ...th, textAlign: "left" }}>Order</th><th style={{ ...th, textAlign: "left" }}>Project</th><th style={{ ...th, textAlign: "left" }}>As</th>
                                <th style={th}>Total comm</th><th style={th}>Paid before</th><th style={{ ...th, paddingRight: 10 }}>Claim now</th>
                              </tr></thead>
                              <tbody>
                                {claimTable("Own orders", x.own)}
                                {claimTable("Team orders, as manager", x.team)}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {both.length > 0 && (
                          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                            <label className={styles.field} style={{ width: 170 }}><span className={styles.fieldLabel}>Paid on</span><DateField value={paidOn} onChange={(v) => setPaidOn(v)} /></label>
                            <span style={{ paddingBottom: 8, fontWeight: 600 }}>{ticked.length} ticked, RM {rm(claimSum(ticked))}</span>
                            <Button onClick={() => pay(x)} disabled={settle.isPending || ticked.length === 0}>{settle.isPending ? "Saving…" : "Record payment"}</Button>
                          </div>
                        )}
                        <div style={{ fontWeight: 700, marginTop: 6 }}>Paid in {monthLabel(month)}: RM {rm(paidSum(x.paid))}</div>
                        {x.paid.length === 0 ? <div style={{ color: MUTED }}>Nothing paid this month.</div> : x.paid.map((p) => (
                          <div key={p.id} style={{ display: "flex", gap: 10, padding: "4px 0", borderTop: "1px solid var(--border)" }}>
                            <span style={{ color: MUTED, whiteSpace: "nowrap" }}>{p.paidOn}</span>
                            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onOpen(p.soDocNo)} style={{ border: 0, background: "none", padding: 0, cursor: "pointer", font: "inherit" }}>{p.soDocNo}</button>
                            <span style={{ flex: 1, color: MUTED }}>{project(p.soDocNo)}</span>
                            <span style={{ ...num, fontWeight: 600 }}>{rm(p.amountSen)}</span>
                          </div>
                        ))}
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={sectionTitle}>Every payout</div>
      <DataTable<CommissionPayout>
        tableId="conts-commission-payouts" exportName="commission-payouts" exportXlsx columns={PAYOUT_COLUMNS} rows={data.payouts}
        emptyLabel="No commission paid yet." getRowKey={(r) => r.id}
      />
    </div>
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
        {data.viewer.canAddScheme && data.brandings.filter((b) => !covered.has(b)).map((b) => (
          <Button key={b} variant="secondary" onClick={() => setAdding(newScheme(b))}>Add scheme for {b}</Button>
        ))}
        {data.viewer.canAddScheme && !covered.has("") && <Button variant="secondary" onClick={() => setAdding(newScheme(null))}>Add scheme for all brands</Button>}
      </div>
      <div style={{ color: MUTED, fontSize: "var(--fs-12)" }}>
        Each brand follows its own scheme; a scheme for all brands covers any brand without one. A change applies to months still open; months already closed keep the rates locked when they closed, unless you tick "Also apply to closed months" when saving.
      </div>
      {data.schemes.length === 0 && !adding && <div style={{ color: MUTED }}>No scheme yet.</div>}
      {adding && <SchemeCard scheme={null} initial={adding} data={data} onDone={() => setAdding(null)} />}
      {data.schemes.map((s) => <SchemeCard key={s.id} scheme={s} initial={s} data={data} readOnly={!data.viewer.editableSchemeIds.includes(s.id)} />)}
    </div>
  );
}

const pctInput = (bp: number): string => String(Number((bp / 100).toFixed(2)));

function SchemeCard({ scheme, initial, data, onDone, readOnly }: { scheme: CommissionScheme | null; initial: SchemeInput; data: CommissionData; onDone?: () => void; readOnly?: boolean }) {
  const adminOnly = !data.viewer.isAdmin;
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
    <fieldset disabled={readOnly} className="rounded-xl border border-border bg-surface shadow-stone" style={{ padding: "var(--space-4)", margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)", fontSize: "var(--fs-13)", opacity: t.active ? 1 : 0.6 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "var(--space-3)" }}>
        <label className={styles.field}><span className={styles.fieldLabel}>Scheme name</span>
          <input className={styles.fieldInput} value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></label>
        <label className={styles.field}><span className={styles.fieldLabel}>Brand</span>
          <select className={styles.fieldInput} disabled={adminOnly} value={t.branding ?? ""} onChange={(e) => setT({ ...t, branding: e.target.value || null })}>
            <option value="">All brands</option>{[...new Set([...data.brandings, ...(t.branding ? [t.branding] : [])])].map((b) => <option key={b} value={b}>{b}</option>)}
          </select></label>
        <label className={styles.field}><span className={styles.fieldLabel}>Sales manager</span>
          <select className={styles.fieldInput} disabled={adminOnly} value={t.managerStaffId ?? ""} onChange={(e) => setT({ ...t, managerStaffId: e.target.value || null })}>
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
        {scheme && data.viewer.canAddScheme && <Button variant="ghost" onClick={async () => {
          setNote(null);
          if (!(await dialog.confirm(`Delete the scheme ${scheme.name}?`))) return;
          try { await del.mutateAsync(scheme.id); } catch (e) { setNote(errText(e)); }
        }}>Delete scheme</Button>}
        {onDone && <Button variant="secondary" onClick={onDone}>Cancel</Button>}
        {!readOnly && <Button onClick={submit} disabled={save.isPending}>{save.isPending ? "Saving…" : scheme ? "Save scheme" : "Add scheme"}</Button>}
      </div>
    </fieldset>
  );
}

/* ── One person by month: sales, the rate reached, commission, claimed this month, can claim now ── */
/* ── Overview: people on the left; the picked person's months and orders on the right (Everyone = every order) ── */
type OrderSortKey = "order" | "date" | "project" | "role" | "released" | "total" | "earned" | "paid" | "claim";
type MyOrder = { row: CommissionRow; share: CommissionShare };
const ORDER_SORT: Record<OrderSortKey, (x: MyOrder) => string | number> = {
  order: (x) => x.row.soDocNo, date: (x) => x.row.soDate ?? "", project: (x) => x.row.projectName || x.row.customerName, role: (x) => x.share.role,
  released: (x) => x.row.releasedBp, total: (x) => x.share.totalSen, earned: (x) => x.share.earnedSen, paid: (x) => x.share.paidSen,
  claim: (x) => x.share.claimableSen,
};
function sortTh<K extends string>(sort: { key: K; desc: boolean }, setSort: (s: { key: K; desc: boolean }) => void) {
  return function SortTh(key: K, label: string, left = false, extra: React.CSSProperties = {}) {
    return (
      <th key={key} style={{ ...th, ...(left ? { textAlign: "left" as const } : {}), ...extra }} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}>
        <button type="button" onClick={() => setSort(sort.key === key ? { key, desc: !sort.desc } : { key, desc: false })}
          style={{ border: 0, background: "none", padding: 0, font: "inherit", color: "inherit", cursor: "pointer", fontWeight: sort.key === key ? 600 : 500 }}>
          {label}{sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
        </button>
      </th>
    );
  };
}
const cmp = (a: string | number, b: string | number): number => (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b)));

function Overview({ data, people, allowEveryone, onOpen }: {
  data: CommissionData; people: PersonTotal[]; allowEveryone: boolean; onOpen: (soDocNo: string) => void;
}) {
  const first = people.find((p) => p.staffId === data.viewer.staffId && p.totalSen > 0)?.staffId ?? (allowEveryone ? "" : people[0]?.staffId ?? "");
  const [staffId, setStaffId] = useState(first);
  const picked = people.find((p) => p.staffId === staffId) ?? null;
  const everyone = allowEveryone && !picked;
  const all = {
    staffId: "", staffName: "Everyone", orders: data.rows.length,
    totalSen: people.reduce((t, p) => t + p.totalSen, 0), earnedSen: people.reduce((t, p) => t + p.earnedSen, 0),
    paidSen: people.reduce((t, p) => t + p.paidSen, 0), claimableSen: people.reduce((t, p) => t + p.claimableSen, 0),
  };
  const pick = (id: string) => setStaffId(id);
  const listItem = (p: PersonTotal) => {
    const on = p.staffId === (picked?.staffId ?? "");
    return (
      <button key={p.staffId || "all"} type="button" onClick={() => pick(p.staffId)} aria-pressed={on} className={on ? undefined : "bg-surface"}
        style={{
          display: "flex", flexDirection: "column", gap: 2, width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: 8, cursor: "pointer", font: "inherit",
          border: on ? `1px solid ${GOOD}` : "1px solid var(--line)", background: on ? "var(--c-success-bg)" : undefined,
        }}>
        <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontWeight: 600 }}>{p.staffId === data.viewer.staffId ? `${p.staffName} (me)` : p.staffName}</span>
          <span style={{ ...num, color: MUTED }}>{p.orders} order{p.orders === 1 ? "" : "s"}</span>
        </span>
        <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span style={{ color: MUTED }}>Can claim</span>
          <span style={{ ...num, fontWeight: 600, color: p.claimableSen > 0 ? GOOD : MUTED }}>RM {rm(p.claimableSen)}</span>
        </span>
      </button>
    );
  };
  const showList = people.length > 1 || allowEveryone;
  return (
    <div style={{ display: "flex", gap: "var(--space-4)", alignItems: "flex-start", flexWrap: "wrap", fontSize: "var(--fs-13)" }}>
      {showList && (
        <div style={{ flex: "1 1 220px", maxWidth: 280, display: "flex", flexDirection: "column", gap: 8 }}>
          <span className={styles.fieldLabel}>People</span>
          {allowEveryone && listItem(all)}
          {people.map(listItem)}
        </div>
      )}
      <div style={{ flex: "999 1 560px", minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        {everyone ? <EveryoneOrders data={data} onOpen={onOpen} /> : picked ? <PersonPane key={picked.staffId} data={data} person={picked} onOpen={onOpen} /> : (
          <div style={{ color: MUTED }}>No commission yet.</div>
        )}
      </div>
    </div>
  );
}

function EveryoneOrders({ data, onOpen }: { data: CommissionData; onOpen: (soDocNo: string) => void }) {
  return (
    <DataTable<CommissionRow>
      tableId="conts-commission-orders" exportName="commission-by-order" exportXlsx
      columns={ORDER_COLUMNS} rows={data.rows}
      emptyLabel="No renovation contracts yet." getRowKey={(r) => r.soDocNo}
      onRowClick={(r) => onOpen(r.soDocNo)} clientSearch={{ placeholder: "Project, customer or SO" }}
    />
  );
}

function PersonPane({ data, person, onOpen }: { data: CommissionData; person: PersonTotal; onOpen: (soDocNo: string) => void }) {
  const staffId = person.staffId;
  const months = useMemo(() => personMonths(data.rows, staffId), [data, staffId]);
  const myPayouts = data.payouts.filter((p) => p.staffId === staffId && !p.voidedAt);
  const monthList = [...new Set([...months.map((x) => x.month), ...myPayouts.map((p) => p.paidOn.slice(0, 7))])].sort().reverse();
  const [month, setMonth] = useState<string | null>(null);
  const m: PersonMonth | null = month ? months.find((x) => x.month === month) ?? { month, salesSen: 0, salesBp: null, commissionSen: 0, lines: [] } : null;
  const claimedIn = (mo: string) => myPayouts.filter((p) => p.paidOn.startsWith(mo)).reduce((t, p) => t + p.amountSen, 0);
  /* A manager earns on the team's orders too; their sales are shown apart from the person's own. */
  const teamIn = (x: PersonMonth | undefined | null) => (x ? x.lines.filter((l) => l.role === "manager").reduce((t, l) => t + l.portion.sen, 0) : 0);
  const asText = (l: PersonMonth["lines"][number]) => (l.role === "manager" ? `Manager · ${l.portion.salespersonName || l.row.salespersonName || "team"}` : "Own sale");
  const [query, setQuery] = useState("");
  const [onlyClaimable, setOnlyClaimable] = useState(false);
  const [sort, setSort] = useState<{ key: OrderSortKey; desc: boolean }>({ key: "date", desc: true });
  const head = sortTh(sort, setSort);
  const q = query.trim().toLowerCase();
  const orders = data.rows
    .map((r) => ({ row: r, share: r.shares.find((s) => s.staffId === staffId) }))
    .filter((x): x is MyOrder => x.share != null)
    .filter((x) => (!onlyClaimable || x.share.claimableSen > 0) && (!q || `${x.row.soDocNo} ${x.row.projectName} ${x.row.customerName}`.toLowerCase().includes(q)))
    .sort((a, b) => (sort.desc ? -1 : 1) * cmp(ORDER_SORT[sort.key](a), ORDER_SORT[sort.key](b)));
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const maxSales = Math.max(1, ...months.map((x) => x.salesSen + teamIn(x)));
  return (
    <>
      <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
        <Kpi label="Claim now" value={`RM ${rm(person.claimableSen)}`} strong />
        <Kpi label="Claimed" value={`RM ${rm(person.paidSen)}`} />
        <Kpi label="Total comm" value={`RM ${rm(person.totalSen)}`} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={sectionTitle}>Sales by month</span>
          <span style={{ color: MUTED, flex: 1 }}>Own sales set the salesperson rate. Team sales are the orders of the people under this manager. Click a month to see what was sold.</span>
          {m && <Button variant="ghost" onClick={() => setMonth(null)}>Close the month</Button>}
        </div>
        {monthList.length === 0 ? <div style={{ color: MUTED }}>No sales yet.</div> : (
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
            {monthList.map((mo) => {
              const x = months.find((y) => y.month === mo);
              const team = teamIn(x);
              const on = m?.month === mo;
              return (
                <button key={mo} type="button" onClick={() => setMonth(on ? null : mo)} aria-pressed={on} className={on ? undefined : "bg-surface"}
                  style={{
                    flex: "0 0 168px", display: "flex", flexDirection: "column", gap: 3, padding: "8px 10px", borderRadius: 8, textAlign: "left", cursor: "pointer", font: "inherit",
                    border: on ? `1px solid ${GOOD}` : "1px solid var(--line)", background: on ? "var(--c-success-bg)" : undefined,
                  }}>
                  <span style={{ fontWeight: 600 }}>{monthLabel(mo)}</span>
                  <span style={{ height: 4, borderRadius: 2, background: "var(--line)", overflow: "hidden" }}>
                    <span style={{ display: "block", height: "100%", width: `${Math.round((((x?.salesSen ?? 0) + team) / maxSales) * 100)}%`, background: GOOD }} />
                  </span>
                  <span style={num}>Own RM {rm0(x?.salesSen ?? 0)}{x?.salesBp != null && (x.salesSen) !== 0 ? ` · ${pctText(x.salesBp)}` : ""}</span>
                  {team !== 0 && <span style={num}>Team RM {rm0(team)}</span>}
                  <span style={{ ...num, fontWeight: 600 }}>Comm RM {rm0(x?.commissionSen ?? 0)}</span>
                  {claimedIn(mo) > 0 && <span style={{ color: GOOD }}>Claimed RM {rm0(claimedIn(mo))}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {m && (
        <div className="rounded-xl border border-border bg-surface shadow-stone" style={{ overflowX: "auto" }}>
          <div style={{ padding: "10px 14px", fontWeight: 600 }}>
            {monthLabel(m.month)}: own sales RM {rm(m.salesSen)}{teamIn(m) !== 0 ? `, team sales RM ${rm(teamIn(m))}` : ""}, comm RM {rm(m.commissionSen)}
          </div>
          {m.lines.length === 0 ? <div style={{ padding: "0 14px 12px", color: MUTED }}>Nothing sold this month.</div> : (
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead><tr style={{ color: MUTED }}>
                <th style={{ ...th, textAlign: "left", paddingLeft: 14 }}>Order / VO</th><th style={{ ...th, textAlign: "left" }}>Project</th><th style={{ ...th, textAlign: "left" }}>Date</th>
                <th style={{ ...th, textAlign: "left" }}>As</th><th style={th}>Sales (RM)</th><th style={th}>Rate</th><th style={{ ...th, paddingRight: 14 }}>Comm (RM)</th>
              </tr></thead>
              <tbody>
                {m.lines.map((l, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "6px 0 6px 14px" }}><span style={{ fontWeight: 600 }}>{l.portion.source === "OTHER" ? "Other" : l.portion.source}</span> {l.row.soDocNo}{l.portion.source === "VO" ? ` ${l.portion.ref}` : ""}</td>
                    <td style={{ paddingLeft: 8 }}>{l.row.projectName || l.row.customerName}</td>
                    <td style={{ paddingLeft: 8 }}>{l.portion.date}</td>
                    <td style={{ paddingLeft: 8, color: l.role === "manager" ? MUTED : undefined }}>{asText(l)}</td>
                    <td style={td}>{rm(l.portion.sen)}</td>
                    <td style={td}>{pctText(l.rateBp)}</td>
                    <td style={{ ...td, paddingRight: 14 }}>{rm(l.commissionSen)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: "2px solid var(--line)", fontWeight: 600 }}>
                  <td style={{ padding: "6px 0 6px 14px" }} colSpan={6}>Comm on {monthLabel(m.month)} sales</td>
                  <td style={{ ...td, paddingRight: 14 }}>{rm(m.commissionSen)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ ...sectionTitle, flex: 1 }}>Claim by order, all months ({orders.length})</span>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={onlyClaimable} onChange={(e) => setOnlyClaimable(e.target.checked)} /> Only with money to claim
          </label>
          <input className={styles.fieldInput} style={{ maxWidth: 240 }} value={query} placeholder="Search SO, project or customer" aria-label="Search orders" onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="rounded-xl border border-border bg-surface shadow-stone" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead><tr style={{ color: MUTED }}>
              {head("order", "Order", true, { paddingLeft: 14 })}{head("date", "SO date", true)}{head("project", "Project", true)}{head("role", "As", true)}
              {head("total", "Total comm")}{head("paid", "Claimed")}{head("claim", "Claim now", false, { paddingRight: 14 })}
            </tr></thead>
            <tbody>
              {orders.length === 0 && <tr><td colSpan={7} style={{ padding: 14, color: MUTED }}>No orders match.</td></tr>}
              {orders.map(({ row, share }) => (
                <Fragment key={row.soDocNo}>
                  <tr style={{ borderTop: "1px solid var(--line)", cursor: "pointer" }} onClick={() => setOpenDoc(openDoc === row.soDocNo ? null : row.soDocNo)}>
                    <td style={{ padding: "6px 0 6px 14px", fontWeight: 600, whiteSpace: "nowrap" }}>{openDoc === row.soDocNo ? "▾" : "▸"} {row.soDocNo}</td>
                    <td style={{ paddingLeft: 8, color: MUTED, whiteSpace: "nowrap" }}>{row.soDate ?? ""}</td>
                    <td style={{ paddingLeft: 8 }}>{row.projectName || row.customerName}</td>
                    <td style={{ paddingLeft: 8, color: MUTED }}>{share.role === "manager" ? `Manager · ${row.salespersonName ?? "team"}` : "Own sale"}</td>
                    <td style={td}>{rm(share.totalSen)}</td>
                    <td style={td}>{rm(share.paidSen)}</td>
                    <td style={{ ...td, paddingRight: 14 }}>
                      <div style={{ fontWeight: 600, color: share.claimableSen > 0 ? GOOD : undefined }}>{rm(share.claimableSen)}</div>
                      {row.releasedBp < 10_000 && <div style={{ color: MUTED, fontSize: "var(--fs-12, 12px)" }}>{pctText(row.releasedBp)} released</div>}
                    </td>
                  </tr>
                  {openDoc === row.soDocNo && (
                    <tr><td colSpan={7} style={{ padding: "4px 14px 12px" }}>
                      <ClaimBreakdown row={row} share={share} />
                      <Button variant="ghost" onClick={() => onOpen(row.soDocNo)}>Open the order</Button>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/** How one person's commission on an order adds up, part by part, and which parts the money claimed so far paid. */
function ClaimBreakdown({ row, share }: { row: CommissionRow; share: CommissionShare }) {
  const parts = claimParts(row, share.staffId, share.paidSen);
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680, background: "var(--bg-subtle, rgba(0,0,0,0.03))", borderRadius: 6 }}>
      <thead><tr style={{ color: MUTED }}>
        <th style={{ ...th, textAlign: "left", paddingLeft: 10 }}>Part</th><th style={{ ...th, textAlign: "left" }}>Month</th><th style={th}>Amount</th><th style={th}>Rate</th>
        <th style={th}>Commission</th><th style={th}>Earned ({pctText(row.releasedBp)} released)</th><th style={th}>Claimed</th><th style={{ ...th, paddingRight: 10 }}>Left</th>
      </tr></thead>
      <tbody>
        {parts.map((x, i) => (
          <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
            <td style={{ padding: "6px 0 6px 10px" }}>{x.portion.source === "SO" ? `Order ${row.soDocNo}` : x.portion.source === "VO" ? x.portion.ref : "Other changes"}</td>
            <td style={{ paddingLeft: 8 }}>{monthLabel(x.portion.month)}{x.portion.lockedAt ? " (locked)" : ""}</td>
            <td style={td}>{rm(x.portion.sen)}</td>
            <td style={td}>{pctText(x.rateBp)}</td>
            <td style={td}>{rm(x.commissionSen)}</td>
            <td style={td}>{rm(x.earnedSen)}</td>
            <td style={td}>{rm(x.claimedSen)}</td>
            <td style={{ ...td, paddingRight: 10, fontWeight: 600 }}>{rm(x.leftSen)}</td>
          </tr>
        ))}
        <tr style={{ borderTop: "2px solid var(--line)", fontWeight: 600 }}>
          <td style={{ padding: "6px 0 6px 10px" }} colSpan={4}>Total</td>
          <td style={td}>{rm(share.totalSen)}</td><td style={td}>{rm(share.earnedSen)}</td><td style={td}>{rm(share.paidSen)}</td>
          <td style={{ ...td, paddingRight: 10 }}>{rm(share.claimableSen)}</td>
        </tr>
      </tbody>
    </table>
  );
}

