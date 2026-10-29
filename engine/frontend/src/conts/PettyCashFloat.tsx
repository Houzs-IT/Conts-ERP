// Conts only (not part of Houzs's code): /scm/petty-cash/:id — one department's float: the balance, and every receipt
// handed in on it for a month, with photos (finance, chew 28 Oct 2026: 收据照片、按月份筛选和导出 Excel). Finance checks
// each receipt (choosing the account), rejects with a reason, records money repaid or returned, writes off, tops the
// float up, and exports the month to Excel. SOP 6; design §4.5, §4.7.
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "../components/Layout";
import { Button } from "../components/Button";
import { StatCard } from "../components/StatCard";
import { DataTable, type Column } from "../components/DataTable";
import { usePrompt } from "../vendor/scm/components/PromptDialog";
import { useChoice } from "../vendor/scm/components/ChoiceDialog";
import { useConfirm } from "../vendor/scm/components/ConfirmDialog";
import { useAuth } from "../auth/AuthContext";
import { fmtSenPlain } from "../vendor/shared/format";
import { DEPARTMENT, RECEIPT_STATUS, financeReceiptFileUrl, pettyPath, useFinanceAction, useFloatReceipts, type Receipt } from "./claimsQueries";
import { FileButtons, Money, thisMonth, useChooseBank, usePettyOptions } from "./ClaimsParts";
import { exportPettyCash } from "./pettyCashExport";
import styles from "../pages/scm-v2/SalesOrderDetail.module.css";

const ringgitToSen = (v: string): number | null => {
  const n = Number(v.replace(/[,\s]/g, "").replace(/^RM/i, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};

export function PettyCashFloat() {
  const { id = "" } = useParams();
  const [month, setMonth] = useState(thisMonth());
  const q = useFloatReceipts(id, month);
  const opts = usePettyOptions();
  const act = useFinanceAction();
  const { can } = useAuth();
  const full = can("scm.payment_voucher.approve");
  const edit = can("scm.payment_voucher.write");
  const prompt = usePrompt();
  const choose = useChoice();
  const confirm = useConfirm();
  const chooseBank = useChooseBank();
  const navigate = useNavigate();
  const [note, setNote] = useState<string | null>(null);
  const run = async (path: string, body: unknown, method: "POST" | "PATCH" = "POST") => {
    setNote(null);
    try {
      const res = await act.mutateAsync({ path, body, method });
      const failed = (res.results as Array<{ ok: boolean; message?: string }> | undefined)?.filter((x) => !x.ok) ?? [];
      if (failed.length) setNote(failed.map((x) => x.message ?? "Not checked.").join(" "));
      return res;
    } catch (e) { setNote(e instanceof Error ? e.message : "Not saved."); return null; }
  };

  const f = q.data?.float;
  const receipts = q.data?.receipts ?? [];
  const waiting = receipts.filter((r) => r.status === "HANDED_IN");
  const accountName = (code: string | null) => (code ? opts.data?.expenseAccounts.find((a) => a.code === code)?.name ?? code : "—");

  /** Finance chooses the account for every line that has none, then the receipt is checked and booked. */
  const linesWithAccounts = async (r: Receipt) => {
    const out = [];
    for (const l of r.lines) {
      const code = l.accountCode ?? await choose({
        title: `What was ${l.description ?? r.vendorName ?? r.receiptNo} for?`, body: `RM ${fmtSenPlain(l.amountSen)} — handed in by ${r.submitterName}`,
        options: (opts.data?.expenseAccounts ?? []).map((a) => ({ value: a.code, label: `${a.code} ${a.name}` })),
      });
      if (!code) return null;
      out.push({ ...l, accountCode: code });
    }
    return out;
  };
  const check = async (r: Receipt) => {
    const lines = await linesWithAccounts(r);
    if (lines) await run(`${pettyPath}/receipts/check`, { items: [{ id: r.id, lines }] });
  };
  const correct = async (r: Receipt) => {
    if (r.lines.length !== 1) { setNote("This receipt has several lines; check it as handed in, or reject it."); return; }
    const v = await prompt({ title: `The right amount on ${r.receiptNo}?`, defaultValue: fmtSenPlain(r.amountSen).replace(/,/g, ""), confirmLabel: "Use this amount",
      validate: (x) => (ringgitToSen(x) == null ? "Enter an amount in RM." : null) });
    if (v == null) return;
    const lines = await linesWithAccounts(r);
    if (lines) await run(`${pettyPath}/receipts/check`, { items: [{ id: r.id, lines: [{ ...lines[0], amountSen: ringgitToSen(v) }] }] });
  };
  const checkAll = async () => {
    const ready = waiting.filter((r) => r.lines.every((l) => l.accountCode));
    const ask = waiting.length - ready.length;
    if (!(await confirm({ title: `Check ${ready.length} receipt${ready.length === 1 ? "" : "s"}?`, body: ask ? `${ask} more need an account chosen first; check those one by one.` : "Each is booked on the account it names.", confirmLabel: "Check" }))) return;
    if (ready.length) await run(`${pettyPath}/receipts/check`, { items: ready.map((r) => ({ id: r.id })) });
  };
  const reject = async (r: Receipt) => {
    const reason = await prompt({ title: `Reject ${r.receiptNo}?`, body: `${r.submitterName} owes the float RM ${fmtSenPlain(r.amountSen)} until a proper receipt or the money comes back.`,
      placeholder: "Why", multiline: true, confirmLabel: "Reject", validate: (v) => (v.trim() ? null : "Say why, so the person knows.") });
    if (reason != null) await run(`${pettyPath}/receipts/${r.id}/reject`, { reason });
  };
  const repaid = async (r: Receipt) => {
    if (await confirm({ title: `${r.submitterName} gave RM ${fmtSenPlain(r.amountSen)} back?`, body: "The money goes back into the float.", confirmLabel: "Record" })) await run(`${pettyPath}/receipts/${r.id}/repaid`, {});
  };
  const writeOff = async (r: Receipt) => {
    const account = await choose({ title: `Write off ${r.receiptNo}, RM ${fmtSenPlain(r.amountSen)}, to`, options: (opts.data?.writeOffAccounts ?? []).map((a) => ({ value: a.code, label: `${a.code} ${a.name}` })) });
    if (account) await run(`${pettyPath}/receipts/${r.id}/write-off`, { accountCode: account });
  };
  const topUp = async () => {
    if (!f) return;
    const bank = await chooseBank(opts.data?.banks ?? [], `Top up from which bank?`);
    if (!bank) return;
    const made = await run(`${pettyPath}/floats/${id}/top-up`, { bankAccountCode: bank });
    if (made?.pvId) navigate(`/scm/payment-vouchers/${String(made.pvId)}`);
  };
  const returned = async () => {
    const v = await prompt({ title: "Cash given back to finance", body: "Record it in the books as money received as well.", placeholder: "RM", confirmLabel: "Record", validate: (x) => (ringgitToSen(x) == null ? "Enter an amount in RM." : null) });
    if (v != null) await run(`${pettyPath}/floats/${id}/returned`, { amountSen: ringgitToSen(v), date: new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10) });
  };
  const changeFloat = async () => {
    if (!f) return;
    const how = await choose({ title: "Change the float", options: [{ value: "amount", label: "The amount" }, { value: "keeper", label: "Who keeps it" }, { value: "account", label: "The account" }, { value: "close", label: "Close this float" }] });
    if (how === "amount") {
      const v = await prompt({ title: "The new float", defaultValue: fmtSenPlain(f.floatSen).replace(/,/g, ""), validate: (x) => (ringgitToSen(x) == null ? "Enter an amount in RM." : null) });
      if (v != null) await run(`${pettyPath}/floats/${id}`, { floatSen: ringgitToSen(v) }, "PATCH");
    } else if (how === "keeper") {
      const keeper = await choose({ title: "Who keeps the cash now?", body: "Count the cash with both of them at the handover.", options: (opts.data?.staff ?? []).map((s) => ({ value: s.id, label: s.name })) });
      if (keeper) await run(`${pettyPath}/floats/${id}`, { keeperUserId: keeper }, "PATCH");
    } else if (how === "account") {
      const account = await choose({
        title: "Which account is this float booked to?", body: "Only until something is booked to it: after that, move the balance with a journal entry and start a new float.",
        options: (opts.data?.floatAccounts ?? []).filter((a) => !a.floatId || a.floatId === id).map((a) => ({ value: a.code, label: `${a.code} ${a.name}` })),
      });
      if (account) await run(`${pettyPath}/floats/${id}`, { accountCode: account }, "PATCH");
    } else if (how === "close") {
      if (await confirm({ title: "Close this float?", body: "Receipts can no longer be handed in on it. Record the cash given back first.", confirmLabel: "Close", danger: true })) await run(`${pettyPath}/floats/${id}`, { active: false }, "PATCH");
    }
  };

  const columns = useMemo<Column<Receipt>[]>(() => [
    { key: "date", label: "Date", render: (r) => r.spendDate, getValue: (r) => r.spendDate },
    { key: "no", label: "Receipt", render: (r) => r.receiptNo, getValue: (r) => r.receiptNo },
    { key: "by", label: "Handed in by", render: (r) => r.submitterName, getValue: (r) => r.submitterName },
    {
      key: "what", label: "For", getValue: (r) => r.vendorName ?? "",
      render: (r) => (
        <span>
          {[r.vendorName, r.lines.map((l) => l.description).filter(Boolean).join("; ")].filter(Boolean).join(" — ") || "—"}
          <span className="block text-xs text-ink-muted">
            {r.lines.map((l) => [DEPARTMENT[l.department], l.maintenanceIssueId ? "maintenance job" : null, l.projectId != null ? `project ${l.projectId}` : null].filter(Boolean).join(" · ")).join("; ")}
          </span>
        </span>
      ),
    },
    { key: "account", label: "Account", render: (r) => r.lines.map((l) => accountName(l.accountCode)).join("; "), getValue: (r) => r.lines[0]?.accountCode ?? "" },
    { key: "amount", label: "Amount", align: "right", render: (r) => <Money sen={r.amountSen} strong />, getValue: (r) => r.amountSen },
    { key: "files", label: "Receipt", render: (r) => <FileButtons files={r.files} open={(fid, mime) => financeReceiptFileUrl(r.id, fid, mime)} />, getValue: (r) => r.files.length },
    {
      key: "status", label: "Status", getValue: (r) => r.status,
      render: (r) => (
        <span>
          {RECEIPT_STATUS[r.status]}
          {r.rejectReason && <span className="block text-xs text-ink-muted">{r.rejectReason}</span>}
          {r.overLimit && <span className="block text-xs text-err">Project over its limit</span>}
        </span>
      ),
    },
    {
      key: "act", label: "", getValue: () => "",
      render: (r) => (
        <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
          {edit && r.status === "HANDED_IN" && <Button className="h-8" disabled={act.isPending} onClick={() => void check(r)}>Check</Button>}
          {edit && r.status === "HANDED_IN" && r.lines.length === 1 && <Button className="h-8" variant="secondary" disabled={act.isPending} onClick={() => void correct(r)}>Correct amount</Button>}
          {edit && r.status === "HANDED_IN" && <Button className="h-8" variant="secondary" disabled={act.isPending} onClick={() => void reject(r)}>Reject</Button>}
          {edit && r.status === "REJECTED" && <Button className="h-8" variant="secondary" disabled={act.isPending} onClick={() => void repaid(r)}>Repaid</Button>}
          {full && r.status === "REJECTED" && <Button className="h-8" variant="ghost" disabled={act.isPending} onClick={() => void writeOff(r)}>Write off</Button>}
        </span>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the actions read the latest options and permissions through closures
  ], [edit, full, act.isPending, opts.data]);

  const spent = receipts.filter((r) => r.status !== "REPLACED").reduce((n, r) => n + r.amountSen, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader eyebrow="Finance · Petty cash" title={f ? `${f.departmentName || "Petty cash"} — kept by ${f.keeperName ?? ""}` : "Petty cash"}
        description={f ? (f.accountCode ? `Booked to ${f.accountCode} ${f.accountName ?? ""}`.trim() : "No account chosen yet: receipts cannot be checked and the float cannot be topped up.") : undefined}
        back="/scm/petty-cash"
        actions={
          <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
            <Button variant="secondary" disabled={!receipts.length} onClick={() => void exportPettyCash(f?.departmentName ?? "float", month, receipts)}>Export to Excel</Button>
            {edit && <Button variant="secondary" onClick={() => void returned()}>Cash returned</Button>}
            {full && <Button variant="secondary" onClick={() => void changeFloat()}>Change float</Button>}
            {full && <Button disabled={!f || act.isPending || !f.accountCode} title={f && !f.accountCode ? "Choose this float's account first (Change float → The account)." : undefined} onClick={() => void topUp()}>Top up</Button>}
          </span>
        } />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
        <StatCard label="Float" value={f ? <Money sen={f.floatSen} /> : null} pending={!f} failed={q.isError} onRetry={() => void q.refetch()} />
        <StatCard label="Balance (cash the keeper should hold)" value={f ? <Money sen={f.balanceSen} strong /> : null} pending={!f} failed={q.isError}
          tone={f && f.balanceSen < 0 ? "error" : f?.low ? "warning" : "default"}
          subtitle={f ? (f.balanceSen < 0 ? "Below zero: the keeper's own money is in it" : f.low ? "Running low" : `Top-up now: RM ${fmtSenPlain(Math.max(0, f.floatSen - f.balanceSen))}`) : undefined} />
        <StatCard label={`Handed in, ${month}`} value={q.data ? <Money sen={spent} /> : null} pending={!q.data} failed={q.isError} subtitle={`${receipts.length} receipts`} />
        <StatCard label="Waiting for a check" value={q.data ? String(waiting.length) : null} pending={!q.data} failed={q.isError}
          subtitle={f?.lastTopUpOn ? `Last top-up ${f.lastTopUpOn}` : "No top-up yet"} />
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label className={styles.field} style={{ maxWidth: 200 }}>
          <span className={styles.fieldLabel}>Month</span>
          <input type="month" className={styles.fieldInput} value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
        {edit && waiting.length > 0 && <Button className="h-9" variant="secondary" disabled={act.isPending} onClick={() => void checkAll()}>Check all waiting</Button>}
      </div>
      {note && <div role="alert" className="text-err">{note}</div>}
      <DataTable<Receipt> tableId="conts-petty-float" columns={columns} rows={q.data ? receipts : null} loading={q.isLoading}
        error={q.isError ? "The receipts did not load." : null} emptyLabel="No receipts this month." getRowKey={(r) => r.id} />
    </div>
  );
}
