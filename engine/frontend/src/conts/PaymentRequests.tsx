// Conts only (not part of Houzs's code): /scm/payment-requests — what staff ask finance to pay: a supplier, against a PO
// or not, or a deposit (SOP 3.2, 3.5; design docs/superpowers/specs/2026-10-28-payment-requests-petty-cash-design.md
// §4.6). Waiting requests come first, oldest first. Two ways to pay (chew, 16 Nov 2026):
//   Make voucher     an ordinary voucher, each line on the account finance chooses; one request, or several ticked
//                    (any payees, staff claims too on Petty cash) on one voucher (conts/combined-voucher.ts);
//   Make AP invoice  one bill per request (a deposit's is its quotation), paid on the Payment voucher page; a payee
//                    not on the list is linked to a supplier first, there and then.
// Finance also rejects with a reason, or closes one paid short.
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "../components/Layout";
import { Button } from "../components/Button";
import { DataTable, type Column } from "../components/DataTable";
import { usePrompt } from "../vendor/scm/components/PromptDialog";
import { useChoice } from "../vendor/scm/components/ChoiceDialog";
import { useAuth } from "../auth/AuthContext";
import { api } from "../api/client";
import { REQUEST_STATUS, requestFileUrl, requestStatusNote, requestsPath, useFinanceAction, usePaymentRequests, type PaymentRequest } from "./claimsQueries";
import { FileButtons, Money, usePettyOptions } from "./ClaimsParts";
import { useLineDepartmentLabel } from "./SubDepartmentSelect";
import { PayDialog, type PayLine, type PaySubmit } from "./PayDialog";
import styles from "../pages/scm-v2/SalesOrderDetail.module.css";

const lineSummaryWith = (label: (l: PaymentRequest["lines"][number]) => string) => (r: PaymentRequest) =>
  r.lines.map((l) => [label(l), l.accountCode, l.description].filter(Boolean).join(" · ")).join("; ");

const OPEN = (r: PaymentRequest) => r.status === "SUBMITTED" || r.status === "PART_PAID";
/** Make voucher: open, not paid through an AP invoice, no voucher being prepared. */
const canVoucher = (r: PaymentRequest) => OPEN(r) && !r.apInvoice && !r.vouchers.some((v) => v.status === "DRAFT");
/** Make AP invoice: a payment while nothing pays it yet; a deposit while open or once paid (its quotation). */
const canBill = (r: PaymentRequest) => !r.apInvoice && (r.type === "DEPOSIT" ? OPEN(r) || r.status === "PAID" : OPEN(r) && r.vouchers.every((v) => v.status === "CANCELLED"));
/** A request's lines as the dialog shows them. */
const payLines = (rs: PaymentRequest[]): PayLine[] => rs.flatMap((r) => r.lines.map((l, i) => ({
  key: l.id ?? `${r.id}:${i}`, source: r.requestNo, payee: r.payeeName, description: l.description ?? "", amountSen: l.amountSen, accountCode: l.accountCode,
})));
/** The chosen accounts of these requests' lines only. */
const accountsOf = (rs: PaymentRequest[], all: Record<string, string>) =>
  Object.fromEntries(rs.flatMap((r) => r.lines.map((l) => l.id)).filter((k): k is string => !!k && !!all[k]).map((k) => [k, all[k]!]));

/* The row's buttons in fixed places and widths, so every row lines up (chew, 16 Nov 2026). */
const actionGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(3, 128px)", gap: 6, alignItems: "center" };
const slotBtn = "h-8 w-full justify-center";

export function PaymentRequests() {
  const [status, setStatus] = useState("SUBMITTED");
  const q = usePaymentRequests(status);
  /* Each line's sub-department (SOP 1.1), "No unit" on a team's line without one. */
  const lineSummary = lineSummaryWith(useLineDepartmentLabel());
  const opts = usePettyOptions();
  const act = useFinanceAction();
  const prompt = usePrompt();
  const choose = useChoice();
  const navigate = useNavigate();
  const { can } = useAuth();
  const full = can("scm.payment_voucher.approve");
  const edit = can("scm.payment_voucher.write");
  const [note, setNote] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<{ mode: "voucher" | "bill"; requests: PaymentRequest[] } | null>(null);
  const rows = q.data ? q.data.requests : null;
  const tickedRows = (rows ?? []).filter((r) => ticked.has(r.id));

  const run = async (path: string, body: unknown, method: "POST" | "PATCH" = "POST") => {
    setNote(null);
    try { return await act.mutateAsync({ path, body, method }); } catch (e) { setNote(e instanceof Error ? e.message : "Not saved."); return null; }
  };
  /** A payee typed in, linked to a supplier on the list; true once linked. */
  const linkSupplier = async (r: PaymentRequest): Promise<boolean> => {
    const term = await prompt({ title: `Which supplier is ${r.payeeName}? (${r.requestNo})`, placeholder: "Type part of the name or code", confirmLabel: "Search" });
    if (!term?.trim()) return false;
    const found = await api.get<{ suppliers: { id: string; code: string; name: string }[] }>(`/api/claims/suppliers?q=${encodeURIComponent(term.trim())}`).catch((e: unknown) => { setNote(e instanceof Error ? e.message : "The suppliers could not be searched."); return null; });
    if (!found) return false;
    if (found.suppliers.length === 0) { setNote(`No supplier matches "${term.trim()}". Add the supplier first.`); return false; }
    const id = await choose({ title: "Link to this supplier", options: found.suppliers.slice(0, 12).map((s) => ({ value: s.id, label: `${s.code} ${s.name}` })) });
    if (!id) return false;
    return (await run(`${requestsPath}/${r.id}/supplier`, { supplierId: id }, "PATCH")) != null;
  };
  const openVoucher = (rs: PaymentRequest[]) => { setNote(null); setDialog({ mode: "voucher", requests: rs }); };
  const openBills = async (rs: PaymentRequest[]) => {
    setNote(null);
    /* An AP invoice is a supplier's bill: a payee not on the list is linked first, one by one. */
    for (const r of rs) if (!r.supplierId && !(await linkSupplier(r))) return;
    setDialog({ mode: "bill", requests: rs });
  };
  const submit = async (v: PaySubmit) => {
    if (!dialog) return;
    const rs = dialog.requests;
    if (dialog.mode === "voucher") {
      const made = await run("/accounting/vouchers/from-claims", { requestIds: rs.map((r) => r.id), bankAccountCode: v.bankAccountCode, accounts: accountsOf(rs, v.accounts) });
      if (!made?.pvId) return;
      setDialog(null); setTicked(new Set());
      navigate(`/scm/payment-vouchers/${String(made.pvId)}`);
      return;
    }
    const made: string[] = [];
    for (const r of rs) {
      const res = await run(`${requestsPath}/${r.id}/ap-invoice`, { accounts: accountsOf([r], v.accounts), provisional: r.type === "DEPOSIT" ? true : v.provisional });
      if (!res?.apInvoiceId) { if (made.length) setNote((why) => `${made.length} AP invoice(s) made; stopped at ${r.requestNo}: ${why ?? "not saved"}`); break; }
      made.push(String(res.apInvoiceId));
    }
    if (made.length === 0) return;
    setDialog(null); setTicked(new Set());
    navigate(made.length === 1 ? `/scm/ap-invoices?open=${encodeURIComponent(made[0]!)}` : "/scm/ap-invoices");
  };
  const reject = async (r: PaymentRequest) => {
    const reason = await prompt({ title: `Reject ${r.requestNo}?`, body: `${r.requesterName} asked to pay ${r.payeeName}.`, placeholder: "Why", multiline: true, confirmLabel: "Reject",
      validate: (v) => (v.trim() ? null : "Say why, so the person knows.") });
    if (reason != null) await run(`${requestsPath}/${r.id}/reject`, { reason });
  };
  const close = async (r: PaymentRequest) => {
    const reason = await prompt({ title: `Close ${r.requestNo} as paid?`, body: "What is still owed will not be paid.", placeholder: "Why it is closed short", multiline: true, confirmLabel: "Close",
      validate: (v) => (v.trim() ? null : "Say why.") });
    if (reason != null) await run(`${requestsPath}/${r.id}/close`, { reason });
  };

  const columns = useMemo<Column<PaymentRequest>[]>(() => [
    { key: "no", label: "Request", render: (r) => <span style={{ fontWeight: 600 }}>{r.requestNo}</span>, getValue: (r) => r.requestNo },
    { key: "on", label: "Asked on", render: (r) => r.createdAt.slice(0, 10), getValue: (r) => r.createdAt },
    { key: "by", label: "By", render: (r) => r.requesterName, getValue: (r) => r.requesterName },
    {
      key: "payee", label: "Pay", getValue: (r) => r.payeeName,
      render: (r) => (
        <span>
          {r.payeeName}
          {r.type === "DEPOSIT" && <span className="ml-1 text-xs text-ink-muted">(deposit)</span>}
          {r.payeeToCheck && <span className="ml-1 text-xs text-err">to be checked</span>}
        </span>
      ),
    },
    { key: "what", label: "For", render: lineSummary, getValue: lineSummary },
    { key: "amount", label: "Amount", align: "right", render: (r) => <Money sen={r.amountSen} strong />, getValue: (r) => r.amountSen },
    { key: "wanted", label: "Wanted by", render: (r) => r.wantedOn ?? "—", getValue: (r) => r.wantedOn ?? "" },
    { key: "files", label: "Documents", render: (r) => <FileButtons files={r.files} open={(f, mime) => requestFileUrl(r.id, f, mime)} />, getValue: (r) => r.files.length },
    {
      key: "status", label: "Status", getValue: (r) => r.status,
      render: (r) => (
        <span>
          {REQUEST_STATUS[r.status]}
          {requestStatusNote(r) && <span className="block text-xs text-ink-muted">{requestStatusNote(r)}</span>}
          {r.vouchers.filter((v) => v.status !== "CANCELLED").map((v) => (
            <Link key={v.id} className="block text-xs underline" to={`/scm/payment-vouchers/${v.id}`}>{v.pvNumber}</Link>
          ))}
          {r.apInvoice && (
            <Link className="block text-xs underline" to={`/scm/ap-invoices?open=${encodeURIComponent(r.apInvoice.id)}`}>
              {r.apInvoice.invoiceNumber}{r.apInvoice.provisional ? " (quotation)" : ""}
            </Link>
          )}
          {r.parentRequestNo && <span className="block text-xs text-ink-muted">Balance of {r.parentRequestNo}</span>}
          {r.askedAmountSen != null && r.askedAmountSen !== r.amountSen && (
            <span className="block text-xs text-ink-muted">Asked <Money sen={r.askedAmountSen} />; now as the invoice</span>
          )}
        </span>
      ),
    },
    {
      key: "act", label: "", getValue: () => "",
      render: (r) => {
        /* Paid through its AP invoice: on the Payment voucher page, against the bill. */
        if (r.apInvoice && OPEN(r)) return <span className="text-xs text-ink-muted">Pay {r.apInvoice.invoiceNumber} on Payment vouchers</span>;
        const voucher = full && canVoucher(r), bill = edit && canBill(r);
        const rejectable = edit && r.status === "SUBMITTED" && r.vouchers.length === 0 && !r.apInvoice;
        const closable = full && r.status === "PART_PAID";
        if (!voucher && !bill && !rejectable && !closable) return null;
        const third = rejectable
          ? <Button className={slotBtn} variant="secondary" disabled={act.isPending} onClick={() => void reject(r)}>Reject</Button>
          : closable ? <Button className={slotBtn} variant="secondary" disabled={act.isPending} onClick={() => void close(r)}>Close</Button> : <span />;
        return (
          <span style={actionGrid}>
            {voucher ? <Button className={slotBtn} disabled={act.isPending} onClick={() => openVoucher([r])}>Make voucher</Button> : <span />}
            {bill
              ? <Button className={slotBtn} variant="secondary" disabled={act.isPending} title={!r.supplierId ? "Choose the supplier first, then the AP invoice is made." : undefined}
                  onClick={() => void openBills([r])}>Make AP invoice</Button>
              : <span />}
            {third}
          </span>
        );
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the actions read the latest options and permissions through closures
  ], [full, edit, act.isPending, opts.data]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader eyebrow="Finance" title="Payment requests" description="Staff ask finance to pay a supplier, against a PO or not, or to pay a deposit. Make the voucher, then check and approve it as usual." />
      <label className={styles.field} style={{ maxWidth: 220 }}>
        <span className={styles.fieldLabel}>Show</span>
        <select className={styles.fieldInput} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="SUBMITTED">Waiting for payment</option>
          <option value="PART_PAID">Part paid</option>
          <option value="PAID">Paid</option>
          <option value="REJECTED">Rejected</option>
          <option value="CLOSED">Closed</option>
          <option value="WITHDRAWN">Withdrawn</option>
          <option value="">All</option>
        </select>
      </label>
      {note && <div role="alert" className="text-err">{note}</div>}
      {/* Ticked: one voucher for them all, or an AP invoice each (chew, 16 Nov 2026). Finance checks what is ticked; the
          engine still refuses, by name, one already being paid or paid through an AP invoice. */}
      {tickedRows.length > 0 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600 }}>{tickedRows.length} ticked · <Money sen={tickedRows.reduce((n, r) => n + r.amountSen, 0)} /></span>
          {full && <Button className="h-8" disabled={act.isPending} onClick={() => openVoucher(tickedRows)}>Make one voucher</Button>}
          {edit && <Button className="h-8" variant="secondary" disabled={act.isPending} onClick={() => void openBills(tickedRows)}>Make AP invoices</Button>}
          <Button className="h-8" variant="ghost" onClick={() => setTicked(new Set())}>Clear</Button>
        </div>
      )}
      <DataTable<PaymentRequest>
        tableId="conts-payment-requests"
        columns={columns}
        rows={rows}
        loading={q.isLoading}
        error={q.isError ? "The requests did not load." : null}
        emptyLabel="No requests."
        getRowKey={(r) => r.id}
        selection={{
          selectedIds: ticked,
          onToggle: (id: string) => setTicked((t) => { const n = new Set(t); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
          onToggleAll: (keys: string[], all: boolean) => setTicked(all ? new Set() : new Set(keys)),
          rowLabel: (r: PaymentRequest) => `Tick ${r.requestNo}`,
        }}
      />
      {dialog && (
        <PayDialog
          mode={dialog.mode}
          title={dialog.mode === "voucher"
            ? `Make voucher — ${dialog.requests.length === 1 ? dialog.requests[0]!.requestNo : `${dialog.requests.length} requests`}`
            : `Make AP invoice${dialog.requests.length > 1 ? "s" : ""} — ${dialog.requests.length === 1 ? dialog.requests[0]!.requestNo : `${dialog.requests.length} requests`}`}
          lines={payLines(dialog.requests)}
          accounts={opts.data?.expenseAccounts ?? []}
          banks={opts.data?.banks ?? []}
          allQuotation={dialog.requests.every((r) => r.type === "DEPOSIT")}
          busy={act.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(v) => void submit(v)}
        />
      )}
    </div>
  );
}
