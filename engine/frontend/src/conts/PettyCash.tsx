// Conts only (not part of Houzs's code): /scm/petty-cash — every department's float at a glance, the receipts finance
// pays back by bank transfer (departments with no float), and people pointed at another department's float (SOP 6;
// design docs/superpowers/specs/2026-10-28-payment-requests-petty-cash-design.md §4.5, §4.7). A float opens on its own
// page with its receipts.
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "../components/Layout";
import { Button } from "../components/Button";
import { StatCard } from "../components/StatCard";
import { DataTable, type Column } from "../components/DataTable";
import { usePrompt } from "../vendor/scm/components/PromptDialog";
import { useChoice } from "../vendor/scm/components/ChoiceDialog";
import { useAuth } from "../auth/AuthContext";
import {
  DEPARTMENT, RECEIPT_STATUS, financeReceiptFileUrl, pettyPath, useFinanceAction, useFinanceReceipts, useFloats, useOverrides,
  type FloatRow, type Receipt,
} from "./claimsQueries";
import { FileButtons, Money, thisMonth, useChooseBank, usePettyOptions } from "./ClaimsParts";
import styles from "../pages/scm-v2/SalesOrderDetail.module.css";

type Tab = "floats" | "finance" | "overrides";
const ringgitToSen = (v: string): number | null => {
  const n = Number(v.replace(/[,\s]/g, "").replace(/^RM/i, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

export function PettyCash() {
  const [tab, setTab] = useState<Tab>("floats");
  const floats = useFloats();
  const opts = usePettyOptions();
  const { can } = useAuth();
  const full = can("scm.payment_voucher.approve");
  const navigate = useNavigate();
  const prompt = usePrompt();
  const choose = useChoice();
  const act = useFinanceAction();
  const [note, setNote] = useState<string | null>(null);
  const run = async (path: string, body: unknown, method: "POST" | "PATCH" | "PUT" = "POST") => {
    setNote(null);
    try {
      const res = await act.mutateAsync({ path, body, method });
      /* A check answers 207 when a receipt was not checked: say why. */
      const failed = (res.results as Array<{ ok: boolean; message?: string }> | undefined)?.filter((x) => !x.ok) ?? [];
      if (failed.length) setNote(failed.map((x) => x.message ?? "Not checked.").join(" "));
      return res;
    } catch (e) { setNote(e instanceof Error ? e.message : "Not saved."); return null; }
  };

  const newFloat = async () => {
    const o = opts.data;
    if (!o) return;
    const taken = new Set((floats.data?.floats ?? []).filter((f) => f.active).map((f) => f.departmentId));
    const dept = await choose({ title: "Which department's petty cash?", options: o.departments.filter((d) => !taken.has(d.id)).map((d) => ({ value: d.id, label: d.name })) });
    if (!dept) return;
    const keeper = await choose({
      title: "Who keeps the cash?",
      options: [...o.staff].sort((a, b) => Number(b.departmentId === dept) - Number(a.departmentId === dept) || a.name.localeCompare(b.name))
        .map((s) => ({ value: s.id, label: s.name, detail: o.departments.find((d) => d.id === s.departmentId)?.name })),
    });
    if (!keeper) return;
    const free = o.floatAccounts.filter((a) => !a.floatId);
    if (free.length === 0) { setNote("Every petty cash account already has a float. Add one to the chart first, e.g. PETTY CASH - (keeper)."); return; }
    const account = await choose({
      title: "Which account is this float booked to?", body: "Receipts paid from the float come off this account; a top-up goes into it.",
      options: free.map((a) => ({ value: a.code, label: `${a.code} ${a.name}` })),
    });
    if (!account) return;
    const amount = await prompt({ title: "How much is the float?", placeholder: "RM, e.g. 1000", confirmLabel: "Next", validate: (v) => (!ringgitToSen(v) ? "Enter an amount in RM, more than 0." : null) });
    if (amount == null) return;
    /* A float that already exists outside the ERP starts from the cash counted in the keeper's hands (chew 29 Oct 2026). */
    const opening = await prompt({
      title: "Cash the keeper holds now", body: "For a float that is already running: count the cash in hand. Leave it at 0 for a new float paid out by voucher.",
      defaultValue: "0", placeholder: "RM", confirmLabel: "Set the float", validate: (v) => (ringgitToSen(v || "0") == null ? "Enter an amount in RM, or 0." : null),
    });
    if (opening == null) return;
    await run(`${pettyPath}/floats`, { departmentId: dept, keeperUserId: keeper, accountCode: account, floatSen: ringgitToSen(amount), openingSen: ringgitToSen(opening || "0") });
  };

  const totals = floats.data?.totals;
  const live = (floats.data?.floats ?? []).filter((f) => f.active);
  const columns = useMemo<Column<FloatRow>[]>(() => [
    { key: "dept", label: "Department", render: (f) => <Link className="font-semibold underline" to={`/scm/petty-cash/${f.id}`}>{f.departmentName || "—"}</Link>, getValue: (f) => f.departmentName },
    { key: "keeper", label: "Kept by", render: (f) => f.keeperName, getValue: (f) => f.keeperName },
    { key: "account", label: "Account", render: (f) => (f.accountCode ? `${f.accountCode} ${f.accountName ?? ""}`.trim() : <span className="text-err">Not chosen</span>), getValue: (f) => f.accountCode ?? "" },
    { key: "float", label: "Float", align: "right", render: (f) => <Money sen={f.floatSen} />, getValue: (f) => f.floatSen },
    {
      key: "balance", label: "Balance", align: "right", getValue: (f) => f.balanceSen,
      render: (f) => (
        <span>
          <Money sen={f.balanceSen} strong />
          {f.low && <span className="ml-1 rounded bg-err-bg px-1 text-xs text-err">low</span>}
        </span>
      ),
    },
    { key: "waiting", label: "Waiting for a check", align: "right", render: (f) => (f.waitingCheckCount ? <span><Money sen={f.waitingCheckSen} /> <span className="text-xs text-ink-muted">({f.waitingCheckCount})</span></span> : "—"), getValue: (f) => f.waitingCheckSen },
    { key: "topup", label: "Last top-up", render: (f) => (f.lastTopUpOn ?? "—"), getValue: (f) => f.lastTopUpOn ?? "" },
    { key: "asked", label: "", render: (f) => (f.topUpRequested ? <span className="text-xs text-warning-text">Top-up asked for</span> : f.active ? null : <span className="text-xs text-ink-muted">Closed</span>), getValue: () => "" },
  ], []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader eyebrow="Finance" title="Petty cash" description="One float per department. Receipts handed in come off the balance at once; a top-up brings the float back to its amount."
        actions={full ? <Button disabled={!opts.data} onClick={() => void newFloat()}>New float</Button> : undefined} />
      {live.some((f) => !f.accountCode) && (
        <div role="note" className="rounded border border-warning-text/30 bg-warning-bg px-3 py-2 text-sm text-warning-text">
          {live.filter((f) => !f.accountCode).map((f) => f.departmentName || "A float").join(", ")} has no petty cash account: its receipts cannot be checked and it cannot be topped up. Open the float → Change float → The account.
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
        <StatCard label="Floats" value={totals ? <Money sen={totals.floatSen} /> : null} pending={!totals} failed={floats.isError} onRetry={() => void floats.refetch()} subtitle={`${live.length} department${live.length === 1 ? "" : "s"}`} />
        <StatCard label="Cash the keepers should hold" value={totals ? <Money sen={totals.balanceSen} strong /> : null} pending={!totals} failed={floats.isError}
          tone={totals && totals.balanceSen < 0 ? "error" : live.some((f) => f.low) ? "warning" : "default"}
          subtitle={live.some((f) => f.low) ? `${live.filter((f) => f.low).length} running low` : "None running low"} />
        <StatCard label="Waiting for a check" value={totals ? <Money sen={totals.waitingCheckSen} /> : null} pending={!totals} failed={floats.isError}
          subtitle={`${live.reduce((n, f) => n + f.waitingCheckCount, 0)} receipts`} />
      </div>
      <div role="tablist" style={{ display: "flex", gap: 8 }}>
        {([["floats", "Floats"], ["finance", "Paid back by finance"], ["overrides", "People on another float"]] as [Tab, string][]).map(([k, label]) => (
          <Button key={k} role="tab" aria-selected={tab === k} variant={tab === k ? "primary" : "secondary"} className="h-8" onClick={() => setTab(k)}>{label}</Button>
        ))}
      </div>
      {note && <div role="alert" className="text-err">{note}</div>}
      {tab === "floats" && (
        <DataTable<FloatRow> tableId="conts-petty-floats" columns={columns} rows={floats.data ? floats.data.floats : null} loading={floats.isLoading}
          error={floats.isError ? "The floats did not load." : null} emptyLabel="No petty cash floats yet." getRowKey={(f) => f.id}
          onRowClick={(f) => navigate(`/scm/petty-cash/${f.id}`)} />
      )}
      {tab === "finance" && <FinancePaysBack run={run} />}
      {tab === "overrides" && <Overrides run={run} floats={live} />}
    </div>
  );
}

/** Receipts from people whose department has no float: finance checks them and pays each back by transfer. */
function FinancePaysBack({ run }: { run: (path: string, body: unknown, method?: "POST" | "PATCH" | "PUT") => Promise<Record<string, unknown> | null> }) {
  const [month, setMonth] = useState(thisMonth());
  const q = useFinanceReceipts(month);
  const opts = usePettyOptions();
  const { can } = useAuth();
  const full = can("scm.payment_voucher.approve");
  const edit = can("scm.payment_voucher.write");
  const prompt = usePrompt();
  const choose = useChoice();
  const chooseBank = useChooseBank();
  const navigate = useNavigate();

  const check = async (r: Receipt) => {
    const accounts = opts.data?.expenseAccounts ?? [];
    const lines = [];
    for (const l of r.lines) {
      const code = l.accountCode ?? await choose({ title: `What was ${l.description ?? r.vendorName ?? "this"} for?`, body: <Money sen={l.amountSen} />, options: accounts.map((a) => ({ value: a.code, label: `${a.code} ${a.name}` })) });
      if (!code) return;
      lines.push({ ...l, accountCode: code });
    }
    await run(`${pettyPath}/receipts/check`, { items: [{ id: r.id, lines }] });
  };
  const reject = async (r: Receipt) => {
    const reason = await prompt({ title: `Reject ${r.receiptNo}?`, placeholder: "Why", multiline: true, confirmLabel: "Reject", validate: (v) => (v.trim() ? null : "Say why, so the person knows.") });
    if (reason != null) await run(`${pettyPath}/receipts/${r.id}/reject`, { reason });
  };
  const payBack = async (r: Receipt) => {
    const bank = await chooseBank(opts.data?.banks ?? [], `Pay ${r.submitterName} back from which bank?`);
    if (!bank) return;
    const made = await run(`${pettyPath}/receipts/${r.id}/voucher`, { bankAccountCode: bank });
    if (made?.pvId) navigate(`/scm/payment-vouchers/${String(made.pvId)}`);
  };

  const columns: Column<Receipt>[] = [
    { key: "date", label: "Date", render: (r) => r.spendDate, getValue: (r) => r.spendDate },
    { key: "no", label: "Receipt", render: (r) => r.receiptNo, getValue: (r) => r.receiptNo },
    { key: "by", label: "Handed in by", render: (r) => r.submitterName, getValue: (r) => r.submitterName },
    { key: "what", label: "For", render: (r) => [r.vendorName, r.lines.map((l) => l.description).filter(Boolean).join("; ")].filter(Boolean).join(" — ") || "—", getValue: (r) => r.vendorName ?? "" },
    { key: "dept", label: "Department", render: (r) => [...new Set(r.lines.map((l) => DEPARTMENT[l.department]))].join(", "), getValue: (r) => r.lines[0]?.department ?? "" },
    { key: "amount", label: "Amount", align: "right", render: (r) => <Money sen={r.amountSen} strong />, getValue: (r) => r.amountSen },
    { key: "files", label: "Receipt", render: (r) => <FileButtons files={r.files} open={(f, mime) => financeReceiptFileUrl(r.id, f, mime)} />, getValue: (r) => r.files.length },
    { key: "status", label: "Status", render: (r) => <span>{RECEIPT_STATUS[r.status]}{r.rejectReason && <span className="block text-xs text-ink-muted">{r.rejectReason}</span>}{r.overLimit && <span className="block text-xs text-err">Project over its limit</span>}</span>, getValue: (r) => r.status },
    {
      key: "act", label: "", getValue: () => "",
      render: (r) => (
        <span style={{ display: "inline-flex", gap: 6 }}>
          {edit && r.status === "HANDED_IN" && <Button className="h-8" onClick={() => void check(r)}>Check</Button>}
          {edit && r.status === "HANDED_IN" && <Button className="h-8" variant="secondary" onClick={() => void reject(r)}>Reject</Button>}
          {full && r.status === "CHECKED" && !r.paybackPvId && <Button className="h-8" onClick={() => void payBack(r)}>Pay back</Button>}
          {r.paybackPvId && <Link className="text-xs underline" to={`/scm/payment-vouchers/${r.paybackPvId}`}>Voucher</Link>}
        </span>
      ),
    },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <label className={styles.field} style={{ maxWidth: 200 }}>
        <span className={styles.fieldLabel}>Month</span>
        <input type="month" className={styles.fieldInput} value={month} onChange={(e) => setMonth(e.target.value)} />
      </label>
      <DataTable<Receipt> tableId="conts-petty-finance" columns={columns} rows={q.data ? q.data.receipts : null} loading={q.isLoading}
        error={q.isError ? "The receipts did not load." : null} emptyLabel="No receipts to pay back this month." getRowKey={(r) => r.id} />
    </div>
  );
}

/** People who hand receipts in to another department's float than their own. */
function Overrides({ run, floats }: { run: (path: string, body: unknown, method?: "POST" | "PATCH" | "PUT") => Promise<Record<string, unknown> | null>; floats: FloatRow[] }) {
  const q = useOverrides();
  const opts = usePettyOptions();
  const { can } = useAuth();
  const full = can("scm.payment_voucher.approve");
  const choose = useChoice();
  const list = q.data?.overrides ?? [];
  const nameOf = (id: string) => opts.data?.staff.find((s) => s.id === id)?.name ?? id;
  const floatOf = (id: string) => floats.find((f) => f.id === id)?.departmentName ?? "—";
  const save = (next: { userId: string; floatId: string }[]) => run(`${pettyPath}/overrides`, { overrides: next }, "PUT");
  const add = async () => {
    const person = await choose({ title: "Who?", options: (opts.data?.staff ?? []).filter((s) => !list.some((o) => o.userId === s.id)).map((s) => ({ value: s.id, label: s.name })) });
    if (!person) return;
    const floatId = await choose({ title: `${nameOf(person)} hands receipts in to`, options: floats.map((f) => ({ value: f.id, label: `${f.departmentName} — kept by ${f.keeperName}` })) });
    if (floatId) await save([...list, { userId: person, floatId }]);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p className="text-sm text-ink-muted">Everyone hands receipts in to their own department's float. Someone listed here uses another one instead.</p>
      {list.length === 0 ? <p className="text-sm">Nobody is on another float.</p> : (
        <ul style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {list.map((o) => (
            <li key={o.userId} style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span style={{ minWidth: 200 }}>{nameOf(o.userId)}</span>
              <span className="text-ink-muted">→ {floatOf(o.floatId)}</span>
              {full && <Button className="h-8" variant="ghost" onClick={() => void save(list.filter((x) => x.userId !== o.userId))}>Remove</Button>}
            </li>
          ))}
        </ul>
      )}
      {full && <div><Button className="h-8" variant="secondary" disabled={!opts.data || floats.length === 0} onClick={() => void add()}>Add a person</Button></div>}
    </div>
  );
}
