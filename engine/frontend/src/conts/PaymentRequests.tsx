// Conts only (not part of Houzs's code): /scm/payment-requests — what staff ask finance to pay: a supplier, against a PO
// or not, or a deposit (SOP 3.2, 3.5; design docs/superpowers/specs/2026-10-28-payment-requests-petty-cash-design.md
// §4.6). Waiting requests come first, oldest first. Finance makes the voucher (it then goes through the usual check
// and approval), rejects with a reason, closes one paid short, or links a typed-in payee to a supplier. Or makes the
// request's AP invoice (chew, 15 Nov 2026): the request is then paid on the Payment voucher page, against the bill; a
// deposit's bill is the quotation, replaced by the formal invoice when it comes.
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
import { FileButtons, Money, useChooseBank, usePettyOptions } from "./ClaimsParts";
import { useLineDepartmentLabel } from "./SubDepartmentSelect";
import styles from "../pages/scm-v2/SalesOrderDetail.module.css";

const lineSummaryWith = (label: (l: PaymentRequest["lines"][number]) => string) => (r: PaymentRequest) =>
  r.lines.map((l) => [label(l), l.accountCode, l.description].filter(Boolean).join(" · ")).join("; ");

export function PaymentRequests() {
  const [status, setStatus] = useState("SUBMITTED");
  const q = usePaymentRequests(status);
  /* Each line's sub-department (SOP 1.1), "No unit" on a team's line without one. */
  const lineSummary = lineSummaryWith(useLineDepartmentLabel());
  const opts = usePettyOptions();
  const act = useFinanceAction();
  const prompt = usePrompt();
  const choose = useChoice();
  const chooseBank = useChooseBank();
  const navigate = useNavigate();
  const { can } = useAuth();
  const full = can("scm.payment_voucher.approve");
  const edit = can("scm.payment_voucher.write");
  const [note, setNote] = useState<string | null>(null);

  const run = async (path: string, body: unknown, method: "POST" | "PATCH" = "POST") => {
    setNote(null);
    try { return await act.mutateAsync({ path, body, method }); } catch (e) { setNote(e instanceof Error ? e.message : "Not saved."); return null; }
  };
  const makeApInvoice = async (r: PaymentRequest) => {
    /* A deposit is paid on a quotation; a payment may be on the formal invoice or on a quotation (SOP 3.8). */
    const provisional = r.type === "DEPOSIT" ? true : await choose({
      title: `${r.requestNo}: what is the paper?`,
      options: [{ value: "invoice", label: "The formal invoice" }, { value: "quotation", label: "A quotation (no formal invoice yet)" }],
    }).then((v) => (v == null ? null : v === "quotation"));
    if (provisional == null) return;
    let debitAccountCode: string | undefined;
    if (r.lines.some((l) => !l.accountCode)) {
      const picked = await choose({
        title: `Which expense account for ${r.requestNo}?`,
        options: (opts.data?.expenseAccounts ?? []).map((a) => ({ value: a.code, label: `${a.code} ${a.name}` })),
      });
      if (!picked) return;
      debitAccountCode = picked;
    }
    const made = await run(`${requestsPath}/${r.id}/ap-invoice`, { debitAccountCode, provisional });
    if (made?.apInvoiceId) navigate(`/scm/ap-invoices?open=${encodeURIComponent(String(made.apInvoiceId))}`);
  };
  const makeVoucher = async (r: PaymentRequest) => {
    const bank = await chooseBank(opts.data?.banks ?? [], `Pay ${r.requestNo} from which bank?`);
    if (!bank) return;
    const made = await run(`${requestsPath}/${r.id}/voucher`, { bankAccountCode: bank });
    if (made?.pvId) navigate(`/scm/payment-vouchers/${String(made.pvId)}`);
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
  const linkSupplier = async (r: PaymentRequest) => {
    const term = await prompt({ title: `Which supplier is ${r.payeeName}?`, placeholder: "Type part of the name or code", confirmLabel: "Search" });
    if (!term?.trim()) return;
    const found = await api.get<{ suppliers: { id: string; code: string; name: string }[] }>(`/api/claims/suppliers?q=${encodeURIComponent(term.trim())}`).catch((e: unknown) => { setNote(e instanceof Error ? e.message : "The suppliers could not be searched."); return null; });
    if (!found) return;
    if (found.suppliers.length === 0) { setNote(`No supplier matches "${term.trim()}". Add the supplier first.`); return; }
    const id = await choose({ title: "Link to this supplier", options: found.suppliers.slice(0, 12).map((s) => ({ value: s.id, label: `${s.code} ${s.name}` })) });
    if (id) await run(`${requestsPath}/${r.id}/supplier`, { supplierId: id }, "PATCH");
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
        const open = r.status === "SUBMITTED" || r.status === "PART_PAID";
        /* The AP invoice: a payment while nothing pays it yet; a deposit while open or once paid (its quotation). */
        /* Shown also before the payee is linked (chew, 16 Nov 2026: "我也没有看到 make ap invoice"), but only made once it
           is a supplier on the list: an AP invoice is a supplier's bill. */
        const canBill = edit && !r.apInvoice && (r.type === "DEPOSIT" ? open || r.status === "PAID" : open && r.vouchers.every((v) => v.status === "CANCELLED"));
        const billButton = canBill && (
          <Button className="h-8" variant="secondary" disabled={act.isPending || !r.supplierId} title={!r.supplierId ? "Link the payee to a supplier first." : undefined}
            onClick={() => void makeApInvoice(r)}>Make AP invoice</Button>
        );
        if (!open) return billButton || null;
        /* Paid through its AP invoice: on the Payment voucher page, against the bill. */
        if (r.apInvoice) return <span className="text-xs text-ink-muted">Pay {r.apInvoice.invoiceNumber} on Payment vouchers</span>;
        const drafting = r.vouchers.some((v) => v.status === "DRAFT");
        return (
          <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
            {billButton}
            {full && !drafting && <Button className="h-8" disabled={act.isPending || (r.payeeToCheck && !r.supplierId)} title={r.payeeToCheck && !r.supplierId ? "Link the payee to a supplier first." : undefined} onClick={() => void makeVoucher(r)}>Make voucher</Button>}
            {edit && r.payeeToCheck && <Button className="h-8" variant="secondary" disabled={act.isPending} onClick={() => void linkSupplier(r)}>Link supplier</Button>}
            {edit && r.status === "SUBMITTED" && r.vouchers.length === 0 && <Button className="h-8" variant="secondary" disabled={act.isPending} onClick={() => void reject(r)}>Reject</Button>}
            {full && r.status === "PART_PAID" && <Button className="h-8" variant="secondary" disabled={act.isPending} onClick={() => void close(r)}>Close</Button>}
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
      <DataTable<PaymentRequest>
        tableId="conts-payment-requests"
        columns={columns}
        rows={q.data ? q.data.requests : null}
        loading={q.isLoading}
        error={q.isError ? "The requests did not load." : null}
        emptyLabel="No requests."
        getRowKey={(r) => r.id}
      />
    </div>
  );
}
