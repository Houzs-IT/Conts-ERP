// Conts only (not part of Houzs's code): /scm/payment-requests — what staff ask finance to pay: a supplier, against a PO
// or not, or a deposit (SOP 3.2, 3.5; design docs/superpowers/specs/2026-10-28-payment-requests-petty-cash-design.md
// §4.6). Waiting requests come first, oldest first. Two ways to pay (chew, 16 Nov 2026):
//   Make voucher     opens the New voucher form filled in from one request or several ticked (any payees), where
//                    finance chooses each line's account; each line remembers the request it pays;
//   Make AP invoice  opens the New AP invoice form filled in, one per request (a deposit's is its quotation), where
//                    finance chooses the supplier (a payee typed in) and the accounts; paid on the Payment voucher page.
// Finance also rejects with a reason, or closes one paid short.
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "../components/Layout";
import { Button } from "../components/Button";
import { DataTable, type Column } from "../components/DataTable";
import { usePrompt } from "../vendor/scm/components/PromptDialog";
import { useAuth } from "../auth/AuthContext";
import { REQUEST_STATUS, requestFileUrl, requestStatusNote, requestsPath, useFinanceAction, usePaymentRequests, type PaymentRequest } from "./claimsQueries";
import { FileButtons, Money, usePettyOptions } from "./ClaimsParts";
import { useLineDepartmentLabel } from "./SubDepartmentSelect";
import type { ClaimsPrefill } from "../pages/scm-v2/PaymentVoucherNew";
import type { RequestForBill } from "../pages/scm-v2/ApInvoices";
import styles from "../pages/scm-v2/SalesOrderDetail.module.css";

const lineSummaryWith = (label: (l: PaymentRequest["lines"][number]) => string) => (r: PaymentRequest) =>
  r.lines.map((l) => [label(l), l.accountCode, l.description].filter(Boolean).join(" · ")).join("; ");

const OPEN = (r: PaymentRequest) => r.status === "SUBMITTED" || r.status === "PART_PAID";
/** Make voucher: open, not paid through an AP invoice, no voucher being prepared. */
const canVoucher = (r: PaymentRequest) => OPEN(r) && !r.apInvoice && !r.vouchers.some((v) => v.status === "DRAFT");
/** Make AP invoice: a payment while nothing pays it yet; a deposit while open or once paid (its quotation). */
const canBill = (r: PaymentRequest) => !r.apInvoice && (r.type === "DEPOSIT" ? OPEN(r) || r.status === "PAID" : OPEN(r) && r.vouchers.every((v) => v.status === "CANCELLED"));
/** The New voucher form's lines, payee and notes from these requests (chew, 16 Nov 2026). */
const voucherPrefill = (rs: PaymentRequest[]): ClaimsPrefill => {
  const payees = [...new Set(rs.map((r) => r.payeeName))];
  return {
    payeeName: payees.length === 1 ? payees[0]! : `Various (${payees.length})`,
    notes: rs.map((r) => `${r.requestNo} ${r.payeeName}${r.type === "DEPOSIT" ? " (deposit)" : ""}${r.note ? ` — ${r.note}` : ""}`).join("\n"),
    sources: rs.map((r) => r.requestNo),
    lines: rs.flatMap((r) => r.lines.map((l) => ({
      description: [payees.length > 1 ? r.payeeName : null, l.description ?? r.requestNo].filter(Boolean).join(" · "), amountSen: l.amountSen,
      department: l.department, unitId: l.unitId, projectId: l.projectId, subDepartmentId: l.subDepartmentId ?? null, paymentRequestId: r.id,
    }))),
  };
};
/** The New AP invoice form's requests, one bill each. */
const billsPrefill = (rs: PaymentRequest[]): RequestForBill[] => rs.map((r) => ({
  id: r.id, requestNo: r.requestNo, type: r.type, supplierId: r.supplierId, payeeName: r.payeeName, wantedOn: r.wantedOn, note: r.note,
  lines: r.lines.map((l) => ({ id: l.id, description: l.description, amountSen: l.amountSen, department: l.department, projectId: l.projectId, unitId: l.unitId, subDepartmentId: l.subDepartmentId ?? null })),
}));

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
  const navigate = useNavigate();
  const { can } = useAuth();
  const full = can("scm.payment_voucher.approve");
  const edit = can("scm.payment_voucher.write");
  const [note, setNote] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const rows = q.data ? q.data.requests : null;
  const tickedRows = (rows ?? []).filter((r) => ticked.has(r.id));

  const run = async (path: string, body: unknown, method: "POST" | "PATCH" = "POST") => {
    setNote(null);
    try { return await act.mutateAsync({ path, body, method }); } catch (e) { setNote(e instanceof Error ? e.message : "Not saved."); return null; }
  };
  /* Paid exactly as the forms say: the accounts (and a payee's supplier) are chosen there (chew, 16 Nov 2026). */
  const openVoucher = (rs: PaymentRequest[]) => { setTicked(new Set()); navigate("/scm/payment-vouchers/new", { state: { claimsPrefill: voucherPrefill(rs) } }); };
  const openBills = (rs: PaymentRequest[]) => { setTicked(new Set()); navigate("/scm/ap-invoices", { state: { fromRequests: billsPrefill(rs) } }); };
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
              ? <Button className={slotBtn} variant="secondary" disabled={act.isPending} onClick={() => openBills([r])}>Make AP invoice</Button>
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
          {edit && <Button className="h-8" variant="secondary" disabled={act.isPending} onClick={() => openBills(tickedRows)}>Make AP invoices</Button>}
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
    </div>
  );
}
