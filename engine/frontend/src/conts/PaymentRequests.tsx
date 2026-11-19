// Conts only (not part of Houzs's code): /scm/payment-requests — everything staff ask finance to pay, in one list (chew,
// 16 Nov 2026: "也是付款啊，只是付的人是员工罢了"):
//   a payment request  pay a supplier, against a PO or not, or a deposit (SOP 3.2, 3.5; design
//                      docs/superpowers/specs/2026-10-28-payment-requests-petty-cash-design.md §4.6);
//   a staff claim      a person's own spending with no float behind it, paid back by transfer (Claim to me).
// Waiting ones come first, oldest first. Two ways to pay:
//   Make voucher     opens the New voucher form filled in from one or several ticked (any payees, requests and claims
//                    together), where finance chooses each line's account (a claim's comes from its check); each line
//                    remembers what it pays;
//   Make AP invoice  (requests only) opens the New AP invoice form filled in, one per request (a deposit's is its
//                    quotation), where finance chooses the supplier and the accounts; paid on the Payment voucher page.
// Finance also checks a claim (its accounts), rejects with a reason, or closes a request paid short.
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "../components/Layout";
import { Button } from "../components/Button";
import { DataTable, type Column } from "../components/DataTable";
import { TabStrip } from "../components/TabStrip";
import { usePrompt } from "../vendor/scm/components/PromptDialog";
import { useChoice } from "../vendor/scm/components/ChoiceDialog";
import { useAuth } from "../auth/AuthContext";
import {
  REQUEST_STATUS, RECEIPT_STATUS, financeReceiptFileUrl, pettyPath, requestFileUrl, requestStatusNote, requestsPath, useFinanceAction, useFinanceReceipts,
  usePaymentRequests, type PaymentRequest, type Receipt,
} from "./claimsQueries";
import { FileButtons, Money, usePettyOptions } from "./ClaimsParts";
import { useLineDepartmentLabel } from "./SubDepartmentSelect";
import type { ClaimsPrefill } from "../pages/scm-v2/PaymentVoucherNew";
import type { RequestForBill } from "../pages/scm-v2/ApInvoices";
import styles from "../pages/scm-v2/SalesOrderDetail.module.css";

/** One row: a payment request, or a staff claim paid back by finance. */
type Row = { kind: "request"; id: string; q: PaymentRequest } | { kind: "claim"; id: string; c: Receipt };
type Line = PaymentRequest["lines"][number];

const OPEN = (r: PaymentRequest) => r.status === "SUBMITTED" || r.status === "PART_PAID";
/** Make voucher: open, not paid through an AP invoice, no voucher being prepared. */
const canVoucher = (r: PaymentRequest) => OPEN(r) && !r.apInvoice && !r.vouchers.some((v) => v.status === "DRAFT");
/** Make AP invoice: a payment while nothing pays it yet; a deposit while open or once paid (its quotation). Never a
 *  utility request: those are paid by voucher against their accrual (chew, 16 Nov 2026). */
const canBill = (r: PaymentRequest) => !r.fromBills && !r.apInvoice && (r.type === "DEPOSIT" ? OPEN(r) || r.status === "PAID" : OPEN(r) && r.vouchers.every((v) => v.status === "CANCELLED"));
/** A claim paid back now: checked, no voucher on it yet. */
const claimPayable = (c: Receipt) => c.status === "CHECKED" && !c.paybackPvId;

/* The claims shown under each "Show" choice, beside the requests of that status. */
const CLAIMS_SHOWN: Record<string, Receipt["status"][]> = {
  SUBMITTED: ["HANDED_IN", "CHECKED"], PART_PAID: [], PAID: ["PAID_BACK"], REJECTED: ["REJECTED"], CLOSED: ["WRITTEN_OFF"], WITHDRAWN: [],
};

type UtilKind = "electricity" | "water" | "internet" | "sewerage";
const UTIL_KINDS: [UtilKind, string][] = [["electricity", "Electricity"], ["water", "Water"], ["internet", "Wifi"], ["sewerage", "Indah Water"]];
/** A utility request's kind, from its lines ("Electricity 2026-11 …", "Indah Water …"); one request is one provider. */
const utilKindOf = (r: PaymentRequest): UtilKind | null => {
  const d = r.lines.map((l) => l.description ?? "").join(" ");
  return /indah water/i.test(d) ? "sewerage" : /^\s*electricity/im.test(d) ? "electricity" : /^\s*water/im.test(d) ? "water" : /^\s*internet/im.test(d) ? "internet" : null;
};
const no = (r: Row) => (r.kind === "request" ? r.q.requestNo : r.c.receiptNo);
const askedOn = (r: Row) => (r.kind === "request" ? r.q.createdAt.slice(0, 10) : r.c.spendDate);
const by = (r: Row) => (r.kind === "request" ? r.q.requesterName : r.c.submitterName);
const payee = (r: Row) => (r.kind === "request" ? r.q.payeeName : r.c.submitterName);
const amount = (r: Row) => (r.kind === "request" ? r.q.amountSen : r.c.amountSen);
const waiting = (r: Row) => (r.kind === "request" ? OPEN(r.q) : r.c.status === "HANDED_IN" || r.c.status === "CHECKED");

/* A utility request made before its lines carried their accrual account: the account from the line's kind, as the
   engine now sets it (conts/utility-bill-routes.ts UTILITY_ACCRUAL; chew, 16 Nov 2026). */
const UTILITY_ACCRUAL: Array<[RegExp, string]> = [[/^Electricity\b/, "420-0010"], [/^Water\b/, "420-0020"], [/^Internet\b/, "420-0030"], [/^Indah Water\b/, "420-0040"]];
const accountOf = (r: PaymentRequest, l: Line): string | null =>
  l.accountCode ?? (r.fromBills ? UTILITY_ACCRUAL.find(([kind]) => kind.test(l.description ?? ""))?.[1] ?? null : null);

/** The New voucher form's lines, payee and notes from these requests and claims (chew, 16 Nov 2026). */
const voucherPrefill = (rows: Row[]): ClaimsPrefill => {
  const payees = [...new Set(rows.map(payee))];
  const many = payees.length > 1;
  return {
    payeeName: many ? `Various (${payees.length})` : payees[0]!,
    notes: rows.map((r) => (r.kind === "request"
      ? `${r.q.requestNo} ${r.q.payeeName}${r.q.type === "DEPOSIT" ? " (deposit)" : ""}${r.q.note ? ` — ${r.q.note}` : ""}`
      : `${r.c.receiptNo} ${r.c.submitterName}${r.c.bank ? ` — ${r.c.bank.bankName} ${r.c.bank.accountNo}${r.c.bank.accountName ? ` (${r.c.bank.accountName})` : ""}` : ""}`)).join("\n"),
    sources: rows.map(no),
    lines: rows.flatMap((r): ClaimsPrefill["lines"] => (r.kind === "request"
      ? r.q.lines.map((l) => ({
        description: [many ? r.q.payeeName : null, l.description ?? r.q.requestNo].filter(Boolean).join(" · "), amountSen: l.amountSen,
        department: l.department, unitId: l.unitId, projectId: l.projectId, subDepartmentId: l.subDepartmentId ?? null, accountCode: accountOf(r.q, l), paymentRequestId: r.q.id,
      }))
      : r.c.lines.map((l) => ({
        description: [many ? r.c.submitterName : null, l.description ?? r.c.vendorName ?? `Receipt ${r.c.receiptNo}`].filter(Boolean).join(" · "), amountSen: l.amountSen,
        department: l.department, unitId: l.unitId, projectId: l.projectId, subDepartmentId: l.subDepartmentId ?? null, accountCode: l.accountCode, staffReceiptId: r.c.id,
      })))),
  };
};
/** The New AP invoice form's requests, one bill each. */
const billsPrefill = (rs: PaymentRequest[]): RequestForBill[] => rs.map((r) => ({
  id: r.id, requestNo: r.requestNo, type: r.type, supplierId: r.supplierId, payeeName: r.payeeName, wantedOn: r.wantedOn, note: r.note,
  lines: r.lines.map((l) => ({ id: l.id, description: l.description, amountSen: l.amountSen, department: l.department, projectId: l.projectId, unitId: l.unitId, subDepartmentId: l.subDepartmentId ?? null })),
  files: r.files,
}));

/* The row's buttons in fixed places and widths, so every row lines up (chew, 16 Nov 2026). */
const actionGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(3, 128px)", gap: 6, alignItems: "center" };
const slotBtn = "h-8 w-full justify-center";

export function PaymentRequests() {
  const [status, setStatus] = useState("SUBMITTED");
  /* Utility bills on a tab of their own (chew, 18 Nov 2026): they are paid against their accrual, by due date. */
  const [tab, setTab] = useState<"other" | "utilities">("other");
  /* Within utilities, by kind (chew, 18 Nov 2026): electricity, water, wifi, Indah Water. */
  const [utilKind, setUtilKind] = useState<UtilKind | "">("");
  const q = usePaymentRequests(status);
  const claimsQ = useFinanceReceipts("");
  /* Each line's sub-department (SOP 1.1), "No unit" on a team's line without one. */
  const deptLabel = useLineDepartmentLabel();
  const lineSummary = (ls: Line[]) => ls.map((l) => [deptLabel(l), l.accountCode, l.description].filter(Boolean).join(" · ")).join("; ");
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

  const rows = useMemo<Row[] | null>(() => {
    if (!q.data) return null;
    const shown = status ? CLAIMS_SHOWN[status] ?? [] : null;
    const claims = (claimsQ.data?.receipts ?? []).filter((c) => (shown ? shown.includes(c.status) : c.status !== "REPLACED"));
    const all: Row[] = [...q.data.requests.map((x) => ({ kind: "request" as const, id: x.id, q: x })), ...claims.map((c) => ({ kind: "claim" as const, id: `claim:${c.id}`, c }))];
    const isUtility = (r: Row) => r.kind === "request" && r.q.fromBills;
    const mine = all.filter((r) => (tab === "utilities" ? isUtility(r) && (!utilKind || (r.kind === "request" && utilKindOf(r.q) === utilKind)) : !isUtility(r)));
    /* Utilities: the soonest due first. Otherwise waiting first, oldest first; the rest newest first. */
    if (tab === "utilities") return mine.sort((a, b) => (a.kind === "request" ? a.q.wantedOn ?? "9999" : "9999").localeCompare(b.kind === "request" ? b.q.wantedOn ?? "9999" : "9999"));
    return mine.sort((a, b) => Number(waiting(b)) - Number(waiting(a)) || (waiting(a) ? askedOn(a).localeCompare(askedOn(b)) : askedOn(b).localeCompare(askedOn(a))));
  }, [q.data, claimsQ.data, status, tab, utilKind]);
  const tickedRows = (rows ?? []).filter((r) => ticked.has(r.id));
  const tickedRequests = tickedRows.flatMap((r) => (r.kind === "request" ? [r.q] : []));

  const run = async (path: string, body: unknown, method: "POST" | "PATCH" = "POST") => {
    setNote(null);
    try { return await act.mutateAsync({ path, body, method }); } catch (e) { setNote(e instanceof Error ? e.message : "Not saved."); return null; }
  };
  /* Paid exactly as the forms say: the accounts (and a payee's supplier) are chosen there (chew, 16 Nov 2026). */
  const openVoucher = (rs: Row[]) => { setTicked(new Set()); navigate("/scm/payment-vouchers/new", { state: { claimsPrefill: voucherPrefill(rs) } }); };
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
  /* A claim is checked first: what each line was for, its account (as on Petty cash). */
  const checkClaim = async (c: Receipt) => {
    const accounts = opts.data?.expenseAccounts ?? [];
    const lines = [];
    for (const l of c.lines) {
      const code = l.accountCode ?? await choose({ title: `What was ${l.description ?? c.vendorName ?? "this"} for?`, body: <Money sen={l.amountSen} />, options: accounts.map((a) => ({ value: a.code, label: `${a.code} ${a.name}` })) });
      if (!code) return;
      lines.push({ ...l, accountCode: code });
    }
    await run(`${pettyPath}/receipts/check`, { items: [{ id: c.id, lines }] });
  };
  const rejectClaim = async (c: Receipt) => {
    const reason = await prompt({ title: `Reject ${c.receiptNo}?`, placeholder: "Why", multiline: true, confirmLabel: "Reject", validate: (v) => (v.trim() ? null : "Say why, so the person knows.") });
    if (reason != null) await run(`${pettyPath}/receipts/${c.id}/reject`, { reason });
  };

  const columns = useMemo<Column<Row>[]>(() => [
    { key: "no", label: "Request", render: (r) => <span style={{ fontWeight: 600 }}>{no(r)}</span>, getValue: no },
    { key: "on", label: "Asked on", render: askedOn, getValue: askedOn },
    { key: "by", label: "By", render: by, getValue: by },
    {
      key: "payee", label: "Pay", getValue: payee,
      render: (r) => (r.kind === "request" ? (
        <span>
          {r.q.payeeName}
          {r.q.type === "DEPOSIT" && <span className="ml-1 text-xs text-ink-muted">(deposit)</span>}
          {r.q.payeeToCheck && <span className="ml-1 text-xs text-err">to be checked</span>}
        </span>
      ) : (
        <span>
          {r.c.submitterName} <span className="text-xs text-ink-muted">(claim)</span>
          {r.c.bank ? <span className="block text-xs text-ink-muted">{r.c.bank.bankName} {r.c.bank.accountNo}{r.c.bank.differsFromSaved ? " · not the saved account" : ""}</span>
            : <span className="block text-xs text-err">No bank details</span>}
        </span>
      )),
    },
    {
      key: "what", label: "For",
      render: (r) => (r.kind === "request" ? lineSummary(r.q.lines) : [r.c.vendorName, lineSummary(r.c.lines)].filter(Boolean).join(" — ")),
      getValue: (r) => (r.kind === "request" ? lineSummary(r.q.lines) : r.c.vendorName ?? ""),
    },
    { key: "amount", label: "Amount", align: "right", render: (r) => <Money sen={amount(r)} strong />, getValue: amount },
    { key: "wanted", label: tab === "utilities" ? "Due" : "Wanted by", render: (r) => (r.kind === "request" ? r.q.wantedOn ?? "—" : "—"), getValue: (r) => (r.kind === "request" ? r.q.wantedOn ?? "" : "") },
    {
      key: "files", label: "Documents", getValue: (r) => (r.kind === "request" ? r.q.files.length : r.c.files.length),
      render: (r) => (r.kind === "request"
        ? <FileButtons files={r.q.files} open={(f, mime) => requestFileUrl(r.q.id, f, mime)} />
        : <FileButtons files={r.c.files} open={(f, mime) => financeReceiptFileUrl(r.c.id, f, mime)} />),
    },
    {
      key: "status", label: "Status", getValue: (r) => (r.kind === "request" ? r.q.status : r.c.status),
      render: (r) => (r.kind === "request" ? (
        <span>
          {REQUEST_STATUS[r.q.status]}
          {requestStatusNote(r.q) && <span className="block text-xs text-ink-muted">{requestStatusNote(r.q)}</span>}
          {r.q.vouchers.filter((v) => v.status !== "CANCELLED").map((v) => (
            <Link key={v.id} className="block text-xs underline" to={`/scm/payment-vouchers/${v.id}`}>{v.pvNumber}</Link>
          ))}
          {r.q.apInvoice && (
            <Link className="block text-xs underline" to={`/scm/ap-invoices?open=${encodeURIComponent(r.q.apInvoice.id)}`}>
              {r.q.apInvoice.invoiceNumber}{r.q.apInvoice.provisional ? " (quotation)" : ""}
            </Link>
          )}
          {r.q.parentRequestNo && <span className="block text-xs text-ink-muted">Balance of {r.q.parentRequestNo}</span>}
          {r.q.askedAmountSen != null && r.q.askedAmountSen !== r.q.amountSen && (
            <span className="block text-xs text-ink-muted">Asked <Money sen={r.q.askedAmountSen} />; now as the invoice</span>
          )}
        </span>
      ) : (
        <span>
          {RECEIPT_STATUS[r.c.status]}
          {r.c.rejectReason && <span className="block text-xs text-ink-muted">{r.c.rejectReason}</span>}
          {r.c.overLimit && <span className="block text-xs text-err">Project over its limit</span>}
          {r.c.paybackPvId && <Link className="block text-xs underline" to={`/scm/payment-vouchers/${r.c.paybackPvId}`}>Voucher</Link>}
        </span>
      )),
    },
    {
      key: "act", label: "", getValue: () => "",
      render: (r) => {
        if (r.kind === "claim") {
          const c = r.c;
          const voucher = full && claimPayable(c), checkable = edit && c.status === "HANDED_IN";
          if (!voucher && !checkable) return null;
          return (
            <span style={actionGrid}>
              {voucher ? <Button className={slotBtn} disabled={act.isPending} onClick={() => openVoucher([r])}>Make voucher</Button> : <span />}
              {checkable ? <Button className={slotBtn} variant="secondary" disabled={act.isPending} onClick={() => void checkClaim(c)}>Check</Button> : <span />}
              {checkable ? <Button className={slotBtn} variant="secondary" disabled={act.isPending} onClick={() => void rejectClaim(c)}>Reject</Button> : <span />}
            </span>
          );
        }
        const x = r.q;
        /* Paid through its AP invoice: on the Payment voucher page, against the bill. */
        if (x.apInvoice && OPEN(x)) return <span className="text-xs text-ink-muted">Pay {x.apInvoice.invoiceNumber} on Payment vouchers</span>;
        const voucher = full && canVoucher(x), bill = edit && canBill(x);
        const rejectable = edit && x.status === "SUBMITTED" && x.vouchers.length === 0 && !x.apInvoice;
        const closable = full && x.status === "PART_PAID";
        if (!voucher && !bill && !rejectable && !closable) return null;
        const third = rejectable
          ? <Button className={slotBtn} variant="secondary" disabled={act.isPending} onClick={() => void reject(x)}>Reject</Button>
          : closable ? <Button className={slotBtn} variant="secondary" disabled={act.isPending} onClick={() => void close(x)}>Close</Button> : <span />;
        return (
          <span style={actionGrid}>
            {voucher ? <Button className={slotBtn} disabled={act.isPending} onClick={() => openVoucher([r])}>Make voucher</Button> : <span />}
            {bill ? <Button className={slotBtn} variant="secondary" disabled={act.isPending} onClick={() => openBills([x])}>Make AP invoice</Button> : <span />}
            {third}
          </span>
        );
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the actions read the latest options and permissions through closures
  ], [full, edit, act.isPending, opts.data, deptLabel, tab]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader eyebrow="Finance" title="Payment requests" description="What staff ask finance to pay: a supplier, a deposit, or their own spending paid back (claims). Make the voucher, then check and approve it as usual." />
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
      <TabStrip<"other" | "utilities">
        value={tab}
        onChange={(t) => { setTab(t); setTicked(new Set()); }}
        options={[
          { value: "other", label: "Requests & claims" },
          { value: "utilities", label: "Utility bills", count: (q.data?.requests ?? []).filter((x) => x.fromBills).length || undefined },
        ]}
      />
      {tab === "utilities" && (
        <TabStrip<UtilKind | "">
          value={utilKind}
          onChange={(k) => { setUtilKind(k); setTicked(new Set()); }}
          options={[{ value: "" as const, label: "All" }, ...UTIL_KINDS.map(([k, label]) => ({
            value: k, label, count: (q.data?.requests ?? []).filter((x) => x.fromBills && utilKindOf(x) === k).length || undefined,
          }))]}
        />
      )}
      {note && <div role="alert" className="text-err">{note}</div>}
      {/* Ticked: one voucher for them all (requests and claims together), or an AP invoice per request (chew, 16 Nov
          2026). Finance checks what is ticked; the engine still refuses, by name, one already being paid. */}
      {tickedRows.length > 0 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600 }}>{tickedRows.length} ticked · <Money sen={tickedRows.reduce((n, r) => n + amount(r), 0)} /></span>
          {full && <Button className="h-8" disabled={act.isPending} onClick={() => openVoucher(tickedRows)}>Make one voucher</Button>}
          {edit && (
            <Button className="h-8" variant="secondary" disabled={act.isPending || tickedRequests.length !== tickedRows.length || tickedRequests.some((r) => r.fromBills)}
              title={tickedRequests.length !== tickedRows.length ? "A claim is paid back by voucher, not an AP invoice: untick the claims."
                : tickedRequests.some((r) => r.fromBills) ? "Utility bills are paid by voucher against their accrual: untick them." : undefined}
              onClick={() => openBills(tickedRequests)}>Make AP invoices</Button>
          )}
          <Button className="h-8" variant="ghost" onClick={() => setTicked(new Set())}>Clear</Button>
        </div>
      )}
      <DataTable<Row>
        tableId="conts-payment-requests"
        columns={columns}
        rows={rows}
        loading={q.isLoading}
        error={q.isError ? "The requests did not load." : claimsQ.isError ? "The claims did not load." : null}
        emptyLabel="No requests."
        getRowKey={(r) => r.id}
        onRowDoubleClick={(r: Row) => navigate(r.kind === "request" ? `/scm/payment-requests/r/${r.q.id}` : `/scm/payment-requests/c/${r.c.id}`)}
        selection={{
          selectedIds: ticked,
          onToggle: (id: string) => setTicked((t) => { const n = new Set(t); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
          onToggleAll: (keys: string[], all: boolean) => setTicked(all ? new Set() : new Set(keys)),
          rowLabel: (r: Row) => `Tick ${no(r)}`,
        }}
      />
    </div>
  );
}

/** One request or claim in full: who, what for, each line, its files and vouchers. */
function RowDetail({ r, lineText }: { r: Row; lineText: (l: Line) => string }) {
  const field = (label: string, value: ReactNode) => (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, fontSize: 13 }}>
      <span className="text-ink-muted">{label}</span><span>{value ?? "—"}</span>
    </div>
  );
  const lines = r.kind === "request" ? r.q.lines : r.c.lines;
  return (
    <section className="rounded-lg border border-line bg-surface" style={{ display: "flex", flexDirection: "column", gap: 12, padding: 20, maxWidth: 820 }}>
      {r.kind === "request" ? (
        <>
          {field("Status", <>{REQUEST_STATUS[r.q.status]}{requestStatusNote(r.q) && <span className="block text-xs text-ink-muted">{requestStatusNote(r.q)}</span>}</>)}
          {field("Asked on", askedOn(r))}
          {field("By", r.q.requesterName)}
          {field("Pay", <>{r.q.payeeName}{r.q.type === "DEPOSIT" ? " (deposit)" : ""}{r.q.payeeToCheck ? <span className="ml-1 text-xs text-err">to be checked</span> : null}</>)}
          {field(r.q.fromBills ? "Due" : "Wanted by", r.q.wantedOn)}
          {field("Amount", <Money sen={r.q.amountSen} />)}
          {field("Note", r.q.note)}
          {r.q.apInvoice && field("AP invoice", r.q.apInvoice.invoiceNumber)}
          {r.q.vouchers.length > 0 && field("Vouchers", r.q.vouchers.map((v) => (
            <Link key={v.id} className="block underline" to={`/scm/payment-vouchers/${v.id}`}>{v.pvNumber} ({v.status.toLowerCase()})</Link>
          )))}
        </>
      ) : (
        <>
          {field("Status", RECEIPT_STATUS[r.c.status])}
          {field("Spent on", r.c.spendDate)}
          {field("By", r.c.submitterName)}
          {field("Shop", r.c.vendorName)}
          {field("Bank", r.c.bank ? `${r.c.bank.bankName} ${r.c.bank.accountNo}` : <span className="text-err">No bank details</span>)}
          {field("Amount", <Money sen={r.c.amountSen} />)}
          {field("Note", r.c.note)}
        </>
      )}
      <div>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Lines ({lines.length})</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id ?? i} style={{ borderTop: "1px solid var(--line)" }}>
                <td style={{ padding: "6px 4px" }}>{lineText(l)}</td>
                <td style={{ padding: "6px 4px", textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}><Money sen={l.amountSen} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Documents</div>
        {r.kind === "request"
          ? <FileButtons files={r.q.files} open={(f, mime) => requestFileUrl(r.q.id, f, mime)} />
          : <FileButtons files={r.c.files} open={(f, mime) => financeReceiptFileUrl(r.c.id, f, mime)} />}
      </div>
    </section>
  );
}

/** A request or claim on its own page (chew, 19 Nov 2026: double-click a row to see what was handed in; no pop-out). */
export function PaymentRequestDetail() {
  const { kind, id } = useParams<{ kind: string; id: string }>();
  const q = usePaymentRequests("");
  const claimsQ = useFinanceReceipts("");
  const deptLabel = useLineDepartmentLabel();
  const r: Row | null = kind === "c"
    ? (() => { const c = claimsQ.data?.receipts.find((x) => x.id === id); return c ? { kind: "claim" as const, id: `claim:${c.id}`, c } : null; })()
    : (() => { const x = q.data?.requests.find((y) => y.id === id); return x ? { kind: "request" as const, id: x.id, q: x } : null; })();
  const loading = kind === "c" ? claimsQ.isLoading : q.isLoading;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader back="/scm/payment-requests" eyebrow="Finance" title={r ? no(r) : kind === "c" ? "Claim" : "Payment request"} />
      {r ? <RowDetail r={r} lineText={(l) => [deptLabel(l), l.accountCode, l.description].filter(Boolean).join(" · ")} />
        : <div className="text-ink-muted">{loading ? "Loading…" : "This request was not found."}</div>}
    </div>
  );
}
