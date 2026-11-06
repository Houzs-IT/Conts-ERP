// The renovation sales order (the contract of one project): contract sums,
// lines (supplier and cost editable until a line is on a PO), progress billing
// by instalment, variation orders, the SO -> PO split and the PO lines a VO
// asked procurement to amend or cancel.
//
// One sales order, one page (owner, 3 Nov 2026): on a computer these are sections of the order's own page
// (SalesOrderDetail), and /scm/renovation/contracts/:docNo redirects there. The stand-alone page stays for the
// phone's renovation documents (mobile/MobileRenovationDocs.tsx).

import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FilePlus2, Printer, ReceiptText, ShoppingCart } from 'lucide-react';
import { PageHeader } from '../../components/Layout';
import { Button } from '../../components/Button';
import { ModalOverlay } from '../../components/scm-v2/DocumentRelationshipMapModal';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../hooks/useToast';
import { serviceConfirm } from '../../vendor/scm/lib/dialog-service';
import { useSuppliers } from '../../vendor/scm/lib/suppliers-queries';
import { STAGE_LABEL, RENO_STAGES, type StageKey } from '../../vendor/shared/renovation-stages';
import { qtyLabel } from '../../vendor/shared/renovation-money';
import {
  CONTRACT_NEXT_STATUS, contractPostingWarning, refusalOf, renoSend, useBrands, useContract, useContractPosting, usePoFlags, usePoSplit, useRenoMutation,
  type BillingInstalment, type ContractPosting, type ContractView, type DocLine,
} from '../../lib/renovation/api';
import { buildPrintDoc } from '../../lib/renovation/print-doc';
import { PrintDialog } from './PrintDialog';
import { ContractProjectCard } from './ContractProjectCard';
import { DocAttachments, LineFilesButton } from '../../components/doc-attachments/DocAttachments';
import { Card, ErrorBanner, Field, fmtDate, inputCls, MoneyInput, pctLabel, rm, Stat, StatusPill, todayIso } from './shared';
import { cn } from '../../lib/utils';

function lineQty(l: DocLine): string {
  const m = l.measureMilli ?? null;
  return qtyLabel({ qty: l.qty, measureMilli: m, measureUom: l.measureUom, uom: l.uom });
}

function BillDialog({ c, inst, onClose }: { c: ContractView; inst: BillingInstalment | null; onClose: () => void }) {
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState(inst?.amountSen ?? 0);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [einvoice, setEinvoice] = useState<string | null>(null);
  const qc = useQueryClient();
  const run = useRenoMutation((body: Record<string, unknown>) => renoSend<{ kind: string; invoiceNumber?: string; noteNumber?: string; amountSen: number; posting: { status: string; reason?: string }; einvoiceWarning?: string | null }>(
    `/sales-orders/${encodeURIComponent(c.docNo)}/instalments/${inst!.id}/bill`, 'POST', body));
  /* By id: billing refetches the contract, and a new copy of this instalment must not wipe the result just shown. */
  useEffect(() => { setAmount(inst?.amountSen ?? 0); setNote(null); setError(null); setResult(null); setEinvoice(null); }, [inst?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- amount is read only when another instalment opens
  if (!inst) return null;
  const negative = amount < 0;
  const submit = async (confirmCreditNote = false) => {
    setError(null);
    try {
      const r = await run.mutateAsync({ invoiceDate: date, expectedAmountSen: amount, confirmCreditNote });
      const doc = r.kind === 'INVOICE' ? `Sales invoice ${r.invoiceNumber}` : r.kind === 'CREDIT_NOTE' ? `Credit note ${r.noteNumber}` : 'Nothing to bill: instalment closed';
      const posted = r.posting.status === 'posted' || r.posting.status === 'already_posted' ? 'journal posted' : r.posting.status === 'not_needed' ? '' : `journal not posted yet (${r.posting.reason ?? r.posting.status})`;
      setNote(null);
      setEinvoice(r.einvoiceWarning ?? null);
      setResult([doc, rm(r.amountSen), posted].filter(Boolean).join(' · '));
    } catch (e) {
      const f = refusalOf(e);
      if (f.code === 'stale_amount' && typeof f.detail.amountSen === 'number') { void qc.invalidateQueries({ queryKey: ['reno'] }); setAmount(f.detail.amountSen); setNote('The amount changed (a variation order moved the contract sum). Check the new amount and bill again.'); return; }
      if (f.code === 'credit_note_needs_confirm' && typeof f.detail.amountSen === 'number') { setAmount(f.detail.amountSen); setNote(f.message); return; }
      setError(f.message);
    }
  };
  return (
    <ModalOverlay open onClose={onClose} title={`Bill ${inst.label || `instalment ${inst.seq}`}`} icon={<ReceiptText size={16} />}
      footer={result
        ? <div className="flex w-full justify-end"><Button onClick={onClose}>Done</Button></div>
        : (
          <div className="flex w-full justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            {negative
              ? <Button variant="danger" disabled={run.isPending} onClick={() => submit(true)}>{run.isPending ? 'Raising…' : `Raise credit note ${rm(-amount)}`}</Button>
              : <Button disabled={run.isPending} onClick={() => submit(false)}>{run.isPending ? 'Billing…' : amount === 0 ? 'Close instalment' : `Issue invoice ${rm(amount)}`}</Button>}
          </div>
        )}>
      <div className="space-y-3 text-[13px]">
        <div className="rounded-lg bg-surface-2 p-3">
          <div className="flex justify-between"><span className="text-ink-secondary">Cumulative</span><span className="font-semibold">{pctLabel(inst.cumBp)} of {rm(c.billing.revisedContractSen)}</span></div>
          <div className="flex justify-between"><span className="text-ink-secondary">Already billed</span><span className="tabular-nums">{rm(c.billing.billedSen)}</span></div>
          <div className="mt-1 flex justify-between border-t border-border-subtle pt-1 text-[15px] font-semibold"><span>This instalment</span><span className={cn('tabular-nums', negative && 'text-err')}>{rm(amount)}</span></div>
        </div>
        {negative && <div className="rounded bg-warning-bg px-3 py-2 text-warning-text">The contract is over-billed after a variation order: this instalment becomes a credit note to the customer.</div>}
        {note && <div className="rounded bg-warning-bg px-3 py-2 text-warning-text">{note}</div>}
        {!result && <Field label={negative ? 'Credit note date' : 'Invoice date'}><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>}
        {result && <div className="rounded bg-synced-bg px-3 py-2 font-semibold text-synced">{result}</div>}
        {einvoice && <div className="rounded bg-warning-bg px-3 py-2 text-warning-text">{einvoice}</div>}
        <ErrorBanner error={error} />
      </div>
    </ModalOverlay>
  );
}

/** Finance: a credit note that lowers the contract (a special discount, less work, a refund). Never more than is
    invoiced so far; later instalments are worked out on the lower contract. */
function CreditDialog({ c, open, onClose }: { c: ContractView; open: boolean; onClose: () => void }) {
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [einvoice, setEinvoice] = useState<string | null>(null);
  const run = useRenoMutation((body: Record<string, unknown>) => renoSend<{ noteNumber: string; amountSen: number; posting: { status: string; reason?: string }; einvoiceWarning?: string | null }>(
    `/sales-orders/${encodeURIComponent(c.docNo)}/credit`, 'POST', body));
  useEffect(() => { if (open) { setDate(todayIso()); setAmount(null); setReason(''); setError(null); setResult(null); setEinvoice(null); } }, [open]);
  if (!open) return null;
  const billed = c.billing.billedSen;
  const tooMuch = amount !== null && amount > billed;
  const submit = async () => {
    setError(null);
    try {
      const r = await run.mutateAsync({ amountSen: amount, reason, noteDate: date });
      const posted = r.posting.status === 'posted' || r.posting.status === 'already_posted' ? 'journal posted' : `journal not posted yet (${r.posting.reason ?? r.posting.status})`;
      setEinvoice(r.einvoiceWarning ?? null);
      setResult([`Credit note ${r.noteNumber}`, rm(r.amountSen), posted].join(' · '));
    } catch (e) { setError(refusalOf(e).message); }
  };
  return (
    <ModalOverlay open onClose={onClose} title="Credit note" icon={<ReceiptText size={16} />}
      footer={result
        ? <div className="flex w-full justify-end"><Button onClick={onClose}>Done</Button></div>
        : (
          <div className="flex w-full justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="danger" disabled={run.isPending || !amount || amount <= 0 || tooMuch || !reason.trim()} onClick={submit}>
              {run.isPending ? 'Raising…' : `Raise credit note${amount ? ` ${rm(amount)}` : ''}`}
            </Button>
          </div>
        )}>
      <div className="space-y-3 text-[13px]">
        <div className="rounded-lg bg-surface-2 p-3">
          <div className="flex justify-between"><span className="text-ink-secondary">Revised contract</span><span className="tabular-nums">{rm(c.billing.revisedContractSen)}</span></div>
          <div className="flex justify-between"><span className="text-ink-secondary">Invoiced so far (net)</span><span className="font-semibold tabular-nums">{rm(billed)}</span></div>
        </div>
        <p className="text-ink-secondary">The credit lowers revenue, what the customer owes and the contract. Later instalments are worked out on the lower contract.</p>
        {!result && (
          <>
            <Field label="Amount (RM)" hint={tooMuch ? `No more than ${rm(billed)}: only what is invoiced can be credited.` : undefined}>
              <MoneyInput nullable value={amount} onChange={setAmount} className={inputCls} ariaLabel="Credit amount" />
            </Field>
            <Field label="Reason"><input className={inputCls} value={reason} maxLength={200} placeholder="e.g. Special discount, deposit refund" onChange={(e) => setReason(e.target.value)} /></Field>
            <Field label="Credit note date"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </>
        )}
        {result && <div className="rounded bg-synced-bg px-3 py-2 font-semibold text-synced">{result}</div>}
        {einvoice && <div className="rounded bg-warning-bg px-3 py-2 text-warning-text">{einvoice}</div>}
        <ErrorBanner error={error} />
      </div>
    </ModalOverlay>
  );
}

function PoSplitCard({ c, canSplit }: { c: ContractView; canSplit: boolean }) {
  const [open, setOpen] = useState(false);
  const preview = usePoSplit(c.docNo, open);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Array<{ id: string; poNumber: string }> | null>(null);
  const raise = useRenoMutation(() => renoSend<{ created: Array<{ id: string; poNumber: string; totalSen: number }> }>(`/sales-orders/${encodeURIComponent(c.docNo)}/po-split`, 'POST', {}));
  const p = preview.data;
  return (
    <Card title="Purchase orders" actions={!open ? <Button variant="secondary" icon={<ShoppingCart size={15} />} onClick={() => setOpen(true)}>Plan POs</Button> : null}>
      {!open && <p className="text-[13px] text-ink-secondary">Lines group by their supplier: one PO each. Owner-supplied goods need no PO; their install labour still gets one.</p>}
      {open && preview.isLoading && <p className="text-[13px] text-ink-muted">Working out the POs…</p>}
      {open && p && (
        <div className="space-y-3">
          {p.groups.length === 0 && p.blocked.length === 0 && (p.unsupplied ?? []).length === 0 && <p className="text-[13px] text-ink-secondary">Nothing left to order.</p>}
          {p.groups.map((g) => (
            <div key={`${g.supplierId}:${g.categoryGroup ?? ''}:${g.warehouseId ?? ''}`} className="rounded-lg border border-border-subtle">
              <div className="flex justify-between bg-surface-2 px-3 py-1.5 text-[13px] font-semibold"><span>{g.supplierCode} · {g.supplierName}{g.categoryGroup ? ` · ${g.categoryGroup}` : ''}</span><span className="tabular-nums">{rm(g.totalSen)}</span></div>
              <ul className="divide-y divide-border-subtle text-[12.5px]">
                {g.lines.map((l) => <li key={l.lineId} className="flex justify-between gap-2 px-3 py-1"><span className="truncate">{l.description}{l.description2 ? <span className="text-ink-muted"> · {l.description2}</span> : null}</span><span className="shrink-0 tabular-nums text-ink-secondary">{l.qty} x {rm(l.unitCostSen)}</span></li>)}
              </ul>
            </div>
          ))}
          {p.blocked.length > 0 && (
            <div className="rounded-lg border border-err/30 bg-err-bg p-2.5 text-[12.5px] text-err">
              <div className="font-semibold">Pick a supplier first ({p.blocked.length}):</div>
              <ul className="list-disc pl-5">{p.blocked.map((l) => <li key={l.lineId}>{l.description}</li>)}</ul>
            </div>
          )}
          {(p.unsupplied ?? []).length > 0 && (
            <div className="rounded-lg border border-warning-text/30 bg-warning-bg p-2.5 text-[12.5px] text-warning-text">
              <div className="font-semibold">Not ordered: no supplier ({(p.unsupplied ?? []).length})</div>
              <ul className="list-disc pl-5">{(p.unsupplied ?? []).map((l) => <li key={l.lineId}>{l.description}</li>)}</ul>
              <div>Pick a supplier on the line (Edit), or leave it if it is bought another way.</div>
            </div>
          )}
          {(p.skipped.length > 0 || p.alreadyOrdered.length > 0) && (
            <details className="text-[12.5px] text-ink-secondary">
              <summary className="cursor-pointer font-semibold">{p.skipped.length} line(s) need no PO, {p.alreadyOrdered.length} already ordered</summary>
              <ul className="mt-1 list-disc pl-5">
                {p.skipped.map((l) => <li key={l.lineId}>{l.description}: {l.reason}</li>)}
                {p.alreadyOrdered.map((l) => <li key={l.lineId}>{l.description}: already on a PO</li>)}
              </ul>
            </details>
          )}
          <ErrorBanner error={error} />
          {done && (
            <div className="rounded bg-synced-bg px-3 py-2 text-[13px] font-semibold text-synced">
              Raised {done.map((po, i) => <span key={po.id}>{i > 0 && ', '}<Link className="underline" to={`/scm/purchase-orders/${po.id}`}>{po.poNumber}</Link></span>)}
            </div>
          )}
          {canSplit && p.groups.length > 0 && (
            <Button disabled={raise.isPending || p.blocked.length > 0} onClick={async () => {
              setError(null);
              try {
                const r = await raise.mutateAsync(undefined);
                setDone(r.created);
              } catch (e) { setError(refusalOf(e).message); }
            }}>{raise.isPending ? 'Raising…' : `Raise ${p.groups.length} PO${p.groups.length > 1 ? 's' : ''}`}</Button>
          )}
        </div>
      )}
    </Card>
  );
}

/** Finance: when the ledger does not carry the contract as it stands (a post after convert or a VO was refused),
    say so and offer to post it again. Nothing shows for anyone else, or when it is in step. */
function ContractPostingAction({ docNo }: { docNo: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const finance = can('scm.payment_voucher.post');
  const state = useContractPosting(docNo, finance);
  const run = useRenoMutation(() => renoSend<ContractPosting>(`/sales-orders/${encodeURIComponent(docNo)}/post-contract`, 'POST', {}));
  const s = state.data;
  if (!finance || !s || s.status === 'in_step' || s.status === 'before_ledger_start') return null;
  const post = async () => {
    try {
      const r = await run.mutateAsync(undefined);
      const warning = contractPostingWarning(r);
      if (warning) toast.warning(warning); else toast.success('Contract posted.');
    } catch (e) { toast.warning(contractPostingWarning({ status: 'post_failed', reason: refusalOf(e).message }) ?? refusalOf(e).message); }
  };
  const gap = !('contractSen' in s) ? `Not posted: ${s.reason}`
    : s.uncleared ? `Cancelled: ${rm(s.uncleared)} of advance not cleared`
    : `Ledger ${rm(s.postedSen)} of ${rm(s.contractSen)}`;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-warning-text">{gap}</span>
      <Button variant="secondary" className="h-8" disabled={run.isPending} onClick={post}>{run.isPending ? 'Posting…' : 'Post contract'}</Button>
    </div>
  );
}

/** The Bill step of one instalment, from the Payments card on the sales order page. */
export function InstalmentBillDialog({ docNo, instalmentId, onClose }: { docNo: string; instalmentId: string; onClose: () => void }) {
  const c = useContract(docNo);
  const inst = c.data?.billing.instalments.find((i) => i.id === instalmentId) ?? null;
  return c.data ? <BillDialog c={c.data} inst={inst} onClose={onClose} /> : null;
}

export function RenovationSalesOrder() {
  const { docNo } = useParams();
  return <ContractSections docNo={docNo} />;
}

/** The contract's own sections. `embedded`: inside the sales order's page, which already shows the customer, the
    project, the order's lines, its payments and its files; here come only the action row and what is the contract's. */
export function ContractSections({ docNo, embedded = false }: { docNo: string | undefined; embedded?: boolean }) {
  const c = useContract(docNo);
  const flags = usePoFlags(docNo);
  const brands = useBrands();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingInstalment | null>(null);
  const [crediting, setCrediting] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const run = useRenoMutation(async (fn: () => Promise<unknown>) => fn());
  /* An old contract link lands here with where it was going (Create PO: #po-split). */
  const { hash } = useLocation();
  const loaded = !!c.data;
  useEffect(() => {
    if (loaded && hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [loaded, hash]);
  if (c.isLoading || !c.data) return <div className="p-8 text-center text-[13px] text-ink-muted">{c.error ? refusalOf(c.error).message : 'Loading contract…'}</div>;
  const k = c.data;
  const live = ['RENO_CONFIRMED', 'RENO_IN_PROGRESS', 'RENO_COMPLETED'].includes(k.status);
  const brand = brands.data?.brands.find((b) => b.brandId === k.header.brandId);
  const b = k.billing;

  const setStatus = async (to: string, label: string, danger?: boolean) => {
    if (!(await serviceConfirm({ title: `${label}?`, danger }))) return;
    setError(null);
    try {
      const r = await run.mutateAsync(() => renoSend<{ status: string; posting?: ContractPosting }>(`/sales-orders/${encodeURIComponent(k.docNo)}/status`, 'POST', { status: to })) as { posting?: ContractPosting };
      const warning = contractPostingWarning(r.posting);
      if (warning) setError(warning);
    } catch (e) { setError(refusalOf(e).message); }
  };
  const newVo = async () => {
    setError(null);
    try {
      const r = await run.mutateAsync(() => renoSend<{ id: string }>(`/sales-orders/${encodeURIComponent(k.docNo)}/variation-orders`, 'POST', {})) as { id: string };
      navigate(`/scm/renovation/variation-orders/${r.id}`);
    } catch (e) { setError(refusalOf(e).message); }
  };
  const resolveFlag = async (id: string) => {
    setError(null);
    try { await run.mutateAsync(() => renoSend(`/po-flags/${id}/resolve`, 'POST', {})); } catch (e) { setError(refusalOf(e).message); }
  };

  const creditList = b.credits.length > 0 && (
          <div className="border-t border-border-subtle px-3 py-2 text-[12.5px]">
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">Credit notes on the contract · {rm(b.creditedSen)}</div>
            <ul className="divide-y divide-border-subtle">
              {b.credits.map((cr, i) => (
                <li key={cr.creditNoteId ?? i} className="flex items-start justify-between gap-3 py-1.5">
                  <span className="min-w-0">
                    <Link className="font-semibold text-primary" to="/scm/credit-notes">{cr.noteNumber ?? 'Credit note'}</Link>
                    <span className="text-ink-secondary"> · {cr.noteDate ? fmtDate(cr.noteDate) : ''}{cr.reason ? ` · ${cr.reason}` : ''}</span>
                    {cr.noteStatus === 'DRAFT' && <span className="ml-1 text-warning-text">(not posted yet)</span>}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-err">−{rm(cr.amountSen)}</span>
                </li>
              ))}
            </ul>
          </div>
        );

  const contractActions = can('scm.renovation.quote') && (CONTRACT_NEXT_STATUS[k.status] ?? []).map((n) => (
    <Button key={n.to} variant={n.danger ? 'danger' : 'secondary'} onClick={() => setStatus(n.to, n.label, n.danger)}>{n.label}</Button>
  ));

  return (
    <div id="contract" className="space-y-4">
      {embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-ink">Renovation contract</h2>
            {k.header.quoteDocNo && <p className="text-[12.5px] text-ink-secondary">From quotation {k.header.quoteDocNo}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={k.status} />
            <Button variant="secondary" icon={<Printer size={15} />} onClick={() => setPrintOpen(true)}>Contract PDF</Button>
            {contractActions}
          </div>
        </div>
      ) : (
        <PageHeader
          back="/scm/renovation/quotations"
          eyebrow={`Renovation contract${k.header.quoteDocNo ? ` · from ${k.header.quoteDocNo}` : ''}`}
          title={k.docNo}
          description={`${k.debtorName}${k.header.building ? ` · ${k.header.building} ${k.header.unitNo}` : ''} · ${fmtDate(k.soDate)}`}
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={k.status} />
              <Button variant="secondary" icon={<Printer size={15} />} onClick={() => setPrintOpen(true)}>Print</Button>
              {contractActions}
            </div>
          )}
        />
      )}
      <ErrorBanner error={error} onClose={() => setError(null)} />
      {(!embedded || k.projectId === null) && <ContractProjectCard docNo={k.docNo} projectId={k.projectId} canWrite={can('projects.write')} />}
      <div className={embedded ? "grid grid-cols-1 gap-2 sm:grid-cols-3" : "grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6"}>
        <Stat label="Original contract" value={rm(k.totals.originalContractSen)} />
        <Stat label="VOs and credit notes" value={rm(k.totals.voTotalSen)} tone={k.totals.voTotalSen ? 'warn' : 'muted'} />
        <Stat label="Revised contract" value={rm(k.totals.revisedContractSen)} />
        {!embedded && <>
          <Stat label="Billed" value={rm(b.billedSen)} />
          <Stat label="Received" value={rm(b.receivedSen)} tone="ok" />
          <Stat label="To bill" value={rm(b.revisedContractSen - b.billedSen)} />
        </>}
      </div>
      {embedded && (live && can('scm.renovation.bill') && can('scm.payment_voucher.post') && b.billedSen > 0 || b.credits.length > 0) && (
        <Card title="Credit notes" dense actions={<ContractPostingAction docNo={k.docNo} />}>
          {live && can('scm.renovation.bill') && can('scm.payment_voucher.post') && b.billedSen > 0 && (
            <div className="p-3"><Button variant="secondary" className="h-8" icon={<ReceiptText size={14} />} onClick={() => setCrediting(true)}>Credit note</Button></div>
          )}
          {creditList}
        </Card>
      )}
      {embedded && !(live && can('scm.renovation.bill') && can('scm.payment_voucher.post') && b.billedSen > 0) && b.credits.length === 0 && <ContractPostingAction docNo={k.docNo} />}
      {!embedded && <Card title="Progress billing" dense actions={(
        <div className="flex flex-wrap items-center gap-2">
          <ContractPostingAction docNo={k.docNo} />
          {live && can('scm.renovation.bill') && can('scm.payment_voucher.post') && b.billedSen > 0 && (
            <Button variant="secondary" className="h-8" icon={<ReceiptText size={14} />} onClick={() => setCrediting(true)}>Credit note</Button>
          )}
        </div>
      )}>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[720px] text-left text-[12.5px]">
            <thead className="bg-surface-2 text-[10.5px] uppercase tracking-wide text-ink-muted">
              <tr><th className="px-3 py-1.5">Instalment</th><th className="text-right">%</th><th>Stage</th><th className="text-right">Amount</th><th className="pl-4">Document</th><th className="text-right">Received</th><th className="px-3" /></tr>
            </thead>
            <tbody>
              {b.instalments.map((i) => (
                <tr key={i.id} className={cn('border-t border-border-subtle align-top', i.isNext && 'bg-primary-soft/40')}>
                  <td className="px-3 py-2"><div className="font-semibold">{i.label || `Instalment ${i.seq}`}</div><div className="max-w-[340px] text-[11.5px] text-ink-muted">{i.description}</div></td>
                  <td className="py-2 text-right tabular-nums">{pctLabel(i.pctBp)}<div className="text-[11px] text-ink-muted">cum. {pctLabel(i.cumBp)}</div></td>
                  <td className="py-2 pl-2 text-ink-secondary">{i.stageCode ? STAGE_LABEL[i.stageCode as StageKey] : '—'}</td>
                  <td className={cn('py-2 text-right font-semibold tabular-nums', i.amountSen < 0 && 'text-err', !i.bill && !i.isNext && 'font-normal text-ink-muted')}>{i.billedBeforeGoLive ? <span className="text-[11px]">Billed before go-live</span> : <>{rm(i.amountSen)}{!i.bill && !i.isNext ? <div className="text-[10.5px] font-normal">projected</div> : null}</>}</td>
                  <td className="py-2 pl-4">
                    {i.bill?.invoiceNumber && <Link className="font-semibold text-primary" to={`/scm/sales-invoices/${i.bill.salesInvoiceId}`}>{i.bill.invoiceNumber}</Link>}
                    {i.bill?.noteNumber && <Link className="font-semibold text-primary" to="/scm/credit-notes">{i.bill.noteNumber}</Link>}
                    {i.bill?.kind === 'ZERO' && <span className="text-ink-muted">closed, nothing to bill</span>}
                    {i.bill && <div className="text-[11px] text-ink-muted">{fmtDate(i.bill.invoiceDate)}</div>}
                  </td>
                  <td className="py-2 text-right tabular-nums">{i.bill?.kind === 'INVOICE' ? rm(i.bill.paidSen) : ''}</td>
                  <td className="px-3 py-2 text-right">{i.isNext && live && can('scm.renovation.bill') && <Button className="h-8" onClick={() => setBilling(i)}>Bill</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="divide-y divide-border-subtle md:hidden">
          {b.instalments.map((i) => (
            <li key={i.id} className={cn('px-3 py-2.5 text-[12.5px]', i.isNext && 'bg-primary-soft/40')}>
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold">{i.label || `Instalment ${i.seq}`} · {pctLabel(i.pctBp)}</span>
                <span className={cn('font-semibold tabular-nums', i.amountSen < 0 && 'text-err', !i.bill && !i.isNext && 'font-normal text-ink-muted')}>{i.billedBeforeGoLive ? 'Billed before go-live' : rm(i.amountSen)}</span>
              </div>
              <div className="text-[11.5px] text-ink-muted">{i.stageCode ? STAGE_LABEL[i.stageCode as StageKey] : 'No stage'} · cum. {pctLabel(i.cumBp)}{!i.bill && !i.isNext && !i.billedBeforeGoLive ? ' · projected' : ''}</div>
              {i.bill && <div className="mt-0.5 text-[12px]">{i.bill.invoiceNumber ?? i.bill.noteNumber ?? 'Closed, nothing to bill'} · {fmtDate(i.bill.invoiceDate)}{i.bill.kind === 'INVOICE' ? ` · received ${rm(i.bill.paidSen)}` : ''}</div>}
              {i.isNext && live && can('scm.renovation.bill') && <Button className="mt-2 h-8 w-full" onClick={() => setBilling(i)}>Bill this instalment</Button>}
            </li>
          ))}
        </ul>
        {creditList}
      </Card>}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Variation orders" actions={live && can('scm.renovation.quote') ? <Button variant="secondary" icon={<FilePlus2 size={15} />} onClick={newVo}>New VO</Button> : null}>
          {k.variationOrders.length === 0 && <p className="text-[13px] text-ink-secondary">No variation orders.</p>}
          <ul className="divide-y divide-border-subtle">
            {k.variationOrders.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 py-2 text-[13px]">
                <span><Link className="font-semibold text-primary" to={`/scm/renovation/variation-orders/${v.id}`}>{v.voNo}</Link> <span className="text-ink-secondary">{v.title}</span></span>
                <span className="flex items-center gap-2"><span className={cn('tabular-nums', v.netSen < 0 && 'text-err')}>{rm(v.netSen)}</span><StatusPill status={v.status} /></span>
              </li>
            ))}
          </ul>
        </Card>
        <div id="po-split" className="scroll-mt-48"><PoSplitCard c={k} canSplit={live && can('scm.renovation.po_split')} /></div>
      </div>
      {(flags.data?.flags.length ?? 0) > 0 && (
        <Card title={`PO lines to amend or cancel (${flags.data!.flags.filter((f) => f.status === 'OPEN').length} open)`}>
          <ul className="divide-y divide-border-subtle text-[13px]">
            {flags.data!.flags.map((f) => (
              <li key={f.id} className={cn('flex flex-wrap items-center justify-between gap-2 py-2', f.status === 'RESOLVED' && 'text-ink-muted')}>
                <span><span className={cn('mr-2 rounded px-1.5 py-0.5 text-[11px] font-semibold', f.action === 'CANCEL' ? 'bg-err-bg text-err' : 'bg-warning-bg text-warning-text')}>{f.action === 'CANCEL' ? 'Cancel line' : `Amend to qty ${f.newQty}`}</span>
                  <Link className="font-semibold text-primary" to={`/scm/purchase-orders/${f.purchaseOrderId}`}>{f.poNumber}</Link> · {f.note}</span>
                {f.status === 'OPEN' && can('scm.renovation.po_split') ? <Button variant="secondary" className="h-8" onClick={() => resolveFlag(f.id)}>Done</Button> : <span className="text-[12px]">{f.status === 'RESOLVED' ? 'done' : ''}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {!embedded && <DocAttachments docType="sales_order" docId={k.docNo} canEdit={k.status !== 'CANCELLED'} />}
      <BillDialog c={k} inst={billing} onClose={() => setBilling(null)} />
      <CreditDialog c={k} open={crediting} onClose={() => setCrediting(false)} />
      <PrintDialog open={printOpen} onClose={() => setPrintOpen(false)} title="sales order" docNo={k.docNo} brandName={brand?.name} defaultFormat={k.header.printFormat}
        rows={[{ label: "Customer", value: k.header.customerName || k.debtorName || "-" }]}
        build={(format) => buildPrintDoc({ kind: 'SALES_ORDER', docNo: k.docNo, format, brand, header: { ...k.header, customerName: k.header.customerName || k.debtorName, docDate: k.header.docDate ?? k.soDate /* eslint-disable-line @typescript-eslint/no-unnecessary-condition -- doc_date may be null on older SOs; fall back to the SO date */ }, sections: k.sections, instalments: k.instalments })} />
    </div>
  );
}
