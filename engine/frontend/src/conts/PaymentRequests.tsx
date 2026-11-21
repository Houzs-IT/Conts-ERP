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
  SUBMITTED: ["HANDED_IN", "CHECKED"], PROCEEDED: ["CHECKED"], PART_PAID: [], PAID: ["PAID_BACK"], REJECTED: ["REJECTED"], CLOSED: ["WRITTEN_OFF"], WITHDRAWN: [],
};
/** Finance has taken it on (chew, 20 Nov 2026): a voucher (not cancelled) or an AP invoice is on the request, or a
 *  voucher pays the claim back. "Waiting for payment" lists only what nobody has started; these go under "Voucher
 *  made" until paid. The person who asked still sees it waiting on My claims. */
const proceeded = (r: Row) => (r.kind === "request" ? !!r.q.apInvoice || r.q.vouchers.some((v) => v.status !== "CANCELLED") : !!r.c.paybackPvId);
/** The engine's status for a "Show" choice: "Voucher made" is part of what is still waiting. */
const serverStatus = (s: string) => (s === "PROCEEDED" ? "SUBMITTED" : s);

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
  const q = usePaymentRequests(serverStatus(status));
  const claimsQ = useFinanceReceipts("");
  /* Each line's sub-department (SOP 1.1), "No unit" on a team's line without one. */
  const deptLabel = useLineDepartmentLabel();
  const lineSummary = (ls: Line[]) => ls.map((l) => [deptLabel(l), l.accountCode, l.description].filter(Boolean).join(" · ")).join("; ");
  /* The units (or jobs, projects) the lines are for, each once: a column of its own (chew, 20 Nov 2026). */
  const unitsOf = (r: Row) => [...new Set((r.kind === "request" ? r.q.lines : r.c.lines).map((l) => l.targetLabel).filter((x): x is string => !!x))].join(", ");
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
    const every: Row[] = [...q.data.requests.map((x) => ({ kind: "request" as const, id: x.id, q: x })), ...claims.map((c) => ({ kind: "claim" as const, id: `claim:${c.id}`, c }))];
    const all = status === "SUBMITTED" ? every.filter((r) => !proceeded(r)) : status === "PROCEEDED" ? every.filter(proceeded) : every;
    const isUtility = (r: Row) => r.kind === "request" && r.q.fromBills;
    const mine = all.filter((r) => (tab === "utilities" ? isUtility(r) && (!utilKind || (r.kind === "request" && utilKindOf(r.q) === utilKind)) : !isUtility(r)));
    /* Utilities: the soonest due first. Otherwise waiting first, oldest first; the rest newest first. */
    if (tab === "utilities") return mine.sort((a, b) => (a.kind === "request" ? a.q.wantedOn ?? "9999" : "9999").localeCompare(b.kind === "request" ? b.q.wantedOn ?? "9999" : "9999"));
    return mine.sort((a, b) => Number(waiting(b)) - Number(waiting(a)) || (waiting(a) ? askedOn(a).localeCompare(askedOn(b)) : askedOn(b).localeCompare(askedOn(a))));
  }, [q.data, claimsQ.data, status, tab, utilKind]);
  /* A request counts on the tabs as the list shows it. */
  const shownNow = (x: PaymentRequest) => (status === "SUBMITTED" ? !proceeded({ kind: "request", id: x.id, q: x }) : status === "PROCEEDED" ? proceeded({ kind: "request", id: x.id, q: x }) : true);
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
    { key: "unit", label: "Unit", getValue: unitsOf, render: (r) => {
      const back = r.kind === "request" ? (r.q.recoveries ?? []).reduce((n, x) => n + x.amountSen, 0) : 0;
      return (
        <span>
          {unitsOf(r) || <span className="text-ink-muted">—</span>}
          {back > 0 && <span className="block text-xs text-ink-muted">Owner pays back <Money sen={back} /></span>}
        </span>
      );
    } },
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
        ? <FileButtons compact files={r.q.files} open={(f, mime) => requestFileUrl(r.q.id, f, mime)} />
        : <FileButtons compact files={r.c.files} open={(f, mime) => financeReceiptFileUrl(r.c.id, f, mime)} />),
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
        /* A cancelled voucher does not count (the engine's live()): PRQ-2611-025 kept its cancelled draft and could not be rejected. */
        const rejectable = edit && x.status === "SUBMITTED" && x.vouchers.every((v) => v.status === "CANCELLED") && !x.apInvoice;
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
          <option value="PROCEEDED">Voucher made, not paid yet</option>
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
          { value: "utilities", label: "Utility bills", count: (q.data?.requests ?? []).filter((x) => x.fromBills && shownNow(x)).length || undefined },
        ]}
      />
      {tab === "utilities" && (
        <TabStrip<UtilKind | "">
          value={utilKind}
          onChange={(k) => { setUtilKind(k); setTicked(new Set()); }}
          options={[{ value: "" as const, label: "All" }, ...UTIL_KINDS.map(([k, label]) => ({
            value: k, label, count: (q.data?.requests ?? []).filter((x) => x.fromBills && shownNow(x) && utilKindOf(x) === k).length || undefined,
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
          {r.q.lines.some((l) => l.unitId && !l.maintenanceIssueId) && field("Owner pays back", <OwnerRecovery q={r.q} />)}
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

/** What each unit's owner pays back on a request (chew, 20 Nov 2026), set by the person asking or here by finance until it
 *  is paid; once PAID the owner is charged as O2 on their statement (migration 0352), and a charge made is changed there. */
function OwnerRecovery({ q }: { q: PaymentRequest }) {
  const { can } = useAuth();
  const act = useFinanceAction();
  const prompt = usePrompt();
  const [note, setNote] = useState<string | null>(null);
  /* A maintenance job's line goes to the owner through the job's Who pays, never here as well (chew, 21 Nov 2026). */
  const mine = q.lines.filter((l) => l.unitId && !l.maintenanceIssueId);
  const units = [...new Map(mine.map((l) => [l.unitId!, { label: l.targetLabel ?? l.unitId!, sen: 0 }])).entries()];
  for (const l of mine) { const u = units.find(([id]) => id === l.unitId); if (u) u[1].sen += l.amountSen; }
  const open = ["SUBMITTED", "PART_PAID", "WITHDRAWN", "REJECTED"].includes(q.status) && can("scm.payment_voucher.write");
  const set = async (unitId: string, label: string, max: number, now: number | null) => {
    const typed = await prompt({ title: `What does the owner of ${label} pay back?`, body: `Up to ${(max / 100).toFixed(2)}. Leave it empty for nothing.`,
      placeholder: "RM", defaultValue: now != null ? (now / 100).toFixed(2) : (max / 100).toFixed(2), confirmLabel: "Save",
      validate: (v) => { const t = v.trim(); if (!t) return null; const n = Math.round(Number(t.replace(/,/g, "")) * 100); return Number.isFinite(n) && n > 0 && n <= max ? null : `More than 0.00 and no more than ${(max / 100).toFixed(2)}.`; } });
    if (typed == null) return;
    const t = typed.trim();
    setNote(null);
    try { await act.mutateAsync({ path: `${requestsPath}/${q.id}/recoveries`, method: "PUT", body: { unitId, amountSen: t ? Math.round(Number(t.replace(/,/g, "")) * 100) : null } }); }
    catch (e) { setNote(e instanceof Error ? e.message : "Not saved."); }
  };
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {units.map(([unitId, u]) => {
        const rec = (q.recoveries ?? []).find((x) => x.unitId === unitId);
        return (
          <span key={unitId} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>{u.label}:</span>
            {rec ? <strong><Money sen={rec.amountSen} /></strong> : <span className="text-ink-muted">nothing</span>}
            {rec?.charged && <span className="text-xs text-ink-muted">charged to the owner (O2)</span>}
            {rec && !rec.charged && <span className="text-xs text-ink-muted">charged to the owner once paid</span>}
            {open && !rec?.charged && <Button variant="secondary" className="h-7" disabled={act.isPending} onClick={() => void set(unitId, u.label, u.sen, rec?.amountSen ?? null)}>{rec ? "Change" : "Owner pays back"}</Button>}
          </span>
        );
      })}
      {note && <span className="text-xs text-err">{note}</span>}
    </span>
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
      {r ? <RowDetail r={r} lineText={(l) => [deptLabel(l), l.targetLabel, l.accountCode, l.description].filter(Boolean).join(" · ")} />
        : <div className="text-ink-muted">{loading ? "Loading…" : "This request was not found."}</div>}
    </div>
  );
}
