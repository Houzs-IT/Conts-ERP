// The renovation sales order (the contract of one project): contract sums,
// lines (supplier and cost editable until a line is on a PO), progress billing
// by instalment, variation orders, the SO -> PO split and the PO lines a VO
// asked procurement to amend or cancel.

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FilePlus2, Printer, ReceiptText, ShoppingCart } from 'lucide-react';
import { PageHeader } from '../../components/Layout';
import { Button } from '../../components/Button';
import { ModalOverlay } from '../../components/scm-v2/DocumentRelationshipMapModal';
import { useAuth } from '../../auth/AuthContext';
import { serviceConfirm } from '../../vendor/scm/lib/dialog-service';
import { useSuppliers } from '../../vendor/scm/lib/suppliers-queries';
import { STAGE_LABEL, RENO_STAGES, type StageKey } from '../../vendor/shared/renovation-stages';
import { qtyLabel } from '../../vendor/shared/renovation-money';
import {
  refusalOf, renoSend, useBrands, useContract, usePoFlags, usePoSplit, useRenoMutation,
  type BillingInstalment, type ContractView, type DocLine,
} from '../../lib/renovation/api';
import { buildPrintDoc } from '../../lib/renovation/print-doc';
import { PrintDialog } from './PrintDialog';
import { Card, ErrorBanner, Field, fmtDate, inputCls, MoneyInput, pctLabel, rm, Stat, StatusPill, todayIso } from './shared';
import { cn } from '../../lib/utils';

const NEXT_STATUS: Record<string, Array<{ to: string; label: string; danger?: boolean }>> = {
  RENO_CONFIRMED: [{ to: 'RENO_IN_PROGRESS', label: 'Works started' }, { to: 'CANCELLED', label: 'Cancel contract', danger: true }],
  RENO_IN_PROGRESS: [{ to: 'RENO_COMPLETED', label: 'Works completed' }],
  RENO_COMPLETED: [{ to: 'CLOSED', label: 'Close contract' }],
};

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
  const qc = useQueryClient();
  const run = useRenoMutation((body: Record<string, unknown>) => renoSend<{ kind: string; invoiceNumber?: string; noteNumber?: string; amountSen: number; posting: { status: string; reason?: string } }>(
    `/sales-orders/${encodeURIComponent(c.docNo)}/instalments/${inst!.id}/bill`, 'POST', body));
  useEffect(() => { setAmount(inst?.amountSen ?? 0); setNote(null); setError(null); setResult(null); }, [inst]);
  if (!inst) return null;
  const negative = amount < 0;
  const submit = async (confirmCreditNote = false) => {
    setError(null);
    try {
      const r = await run.mutateAsync({ invoiceDate: date, expectedAmountSen: amount, confirmCreditNote });
      const doc = r.kind === 'INVOICE' ? `Sales invoice ${r.invoiceNumber}` : r.kind === 'CREDIT_NOTE' ? `Credit note ${r.noteNumber}` : 'Nothing to bill: instalment closed';
      const posted = r.posting.status === 'posted' || r.posting.status === 'already_posted' ? 'journal posted' : r.posting.status === 'not_needed' ? '' : `journal not posted yet (${r.posting.reason ?? r.posting.status})`;
      setNote(null);
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
        <ErrorBanner error={error} />
      </div>
    </ModalOverlay>
  );
}

function PoSplitCard({ c, canSplit }: { c: ContractView; canSplit: boolean }) {
  const [open, setOpen] = useState(false);
  const preview = usePoSplit(c.docNo, open);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const raise = useRenoMutation(() => renoSend<{ created: Array<{ id: string; poNumber: string; totalSen: number }> }>(`/sales-orders/${encodeURIComponent(c.docNo)}/po-split`, 'POST', {}));
  const p = preview.data;
  return (
    <Card title="Purchase orders (SO -> PO)" actions={!open ? <Button variant="secondary" icon={<ShoppingCart size={15} />} onClick={() => setOpen(true)}>Plan POs</Button> : null}>
      {!open && <p className="text-[13px] text-ink-secondary">Lines group by their supplier: one PO each. Owner-supplied goods need no PO; their install labour still gets one.</p>}
      {open && preview.isLoading && <p className="text-[13px] text-ink-muted">Working out the POs…</p>}
      {open && p && (
        <div className="space-y-3">
          {p.groups.length === 0 && <p className="text-[13px] text-ink-secondary">Nothing left to order.</p>}
          {p.groups.map((g) => (
            <div key={g.supplierId} className="rounded-lg border border-border-subtle">
              <div className="flex justify-between bg-surface-2 px-3 py-1.5 text-[13px] font-semibold"><span>{g.supplierCode} · {g.supplierName}</span><span className="tabular-nums">{rm(g.totalSen)}</span></div>
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
          {done && <div className="rounded bg-synced-bg px-3 py-2 text-[13px] font-semibold text-synced">{done}</div>}
          {canSplit && p.groups.length > 0 && (
            <Button disabled={raise.isPending || p.blocked.length > 0} onClick={async () => {
              setError(null);
              try {
                const r = await raise.mutateAsync(undefined);
                setDone(`Raised ${r.created.map((x) => x.poNumber).join(', ')}`);
              } catch (e) { setError(refusalOf(e).message); }
            }}>{raise.isPending ? 'Raising…' : `Raise ${p.groups.length} PO${p.groups.length > 1 ? 's' : ''}`}</Button>
          )}
        </div>
      )}
    </Card>
  );
}

function LinesCard({ c, canEdit }: { c: ContractView; canEdit: boolean }) {
  const sq = useSuppliers({ status: 'ACTIVE' });
  const suppliers = sq.data ?? [];
  const [edits, setEdits] = useState<Record<string, { supplierId?: string | null; unitCostSen?: number; stageCode?: string | null }>>({});
  const [error, setError] = useState<string | null>(null);
  const save = useRenoMutation(() => renoSend(`/sales-orders/${encodeURIComponent(c.docNo)}`, 'PATCH', {
    version: c.header.version, lines: Object.entries(edits).map(([id, e]) => ({ id, ...e })),
  }));
  const supplierName = useMemo(() => new Map(suppliers.map((s) => [s.id, `${s.code} · ${s.name}`])), [suppliers]);
  const editing = Object.keys(edits).length > 0;
  return (
    <Card title="Contract lines" dense actions={editing && canEdit ? (
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => setEdits({})}>Discard</Button>
        <Button disabled={save.isPending} onClick={async () => { setError(null); try { await save.mutateAsync(undefined); setEdits({}); } catch (e) { setError(refusalOf(e).message); } }}>{save.isPending ? 'Saving…' : 'Save lines'}</Button>
      </div>
    ) : null}>
      {error && <div className="p-3"><ErrorBanner error={error} /></div>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-[12.5px]">
          <thead className="bg-surface-2 text-[10.5px] uppercase tracking-wide text-ink-muted">
            <tr><th className="px-3 py-1.5">Description</th><th className="text-center">Qty</th><th className="text-right">Amount</th><th className="pl-4">Supplier</th><th className="text-right">Unit cost</th><th className="pl-3 pr-3">Stage</th></tr>
          </thead>
          <tbody>
            {c.sections.map((s, si) => (
              <SectionRows key={si} section={s} canEdit={canEdit} edits={edits} setEdits={setEdits} suppliers={suppliers} supplierName={supplierName} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SectionRows({ section, canEdit, edits, setEdits, suppliers, supplierName }: {
  section: ContractView['sections'][number]; canEdit: boolean; edits: Record<string, { supplierId?: string | null; unitCostSen?: number; stageCode?: string | null }>;
  setEdits: (f: (e: Record<string, { supplierId?: string | null; unitCostSen?: number; stageCode?: string | null }>) => Record<string, { supplierId?: string | null; unitCostSen?: number; stageCode?: string | null }>) => void;
  suppliers: Array<{ id: string; code: string; name: string }>; supplierName: Map<string, string>;
}) {
  return (
    <>
      <tr style={section.bandColor ? { background: `${section.bandColor}55` } : undefined} className="border-t border-border-subtle">
        <td colSpan={6} className="px-3 py-1.5 font-semibold uppercase">
          {section.heading || 'Section'}
          {section.voId && <span className="ml-2 rounded bg-primary-soft px-1.5 py-0.5 text-[10.5px] font-semibold normal-case text-primary-ink">added by VO</span>}
          {section.lumpSumSen !== null && <span className="float-right tabular-nums">{rm(section.lumpSumSen)}</span>}
        </td>
      </tr>
      {section.lines.map((l) => {
        const priced = l.kind === 'ITEM' || l.kind === 'CHILD';
        const gone = Boolean(l.omittedByVoId || l.soItemCancelled);
        const e = l.id ? edits[l.id] : undefined;
        const set = (p: { supplierId?: string | null; unitCostSen?: number; stageCode?: string | null }) => l.id && setEdits((x) => ({ ...x, [l.id!]: { ...x[l.id!], ...p } }));
        return (
          <tr key={l.id} className={cn('border-t border-border-subtle', gone && 'text-ink-muted line-through')}>
            <td className={cn('px-3 py-1', l.kind !== 'ITEM' && 'pl-7', l.kind === 'ITEM' && 'font-semibold')}>{l.description}{l.room ? <span className="font-normal text-ink-muted"> @ {l.room}</span> : null}{l.itemCode ? <span className="ml-1 text-[11px] font-normal text-ink-muted">{l.itemCode}</span> : null}{l.supplyByOwner && <span className="ml-1 text-[11px] font-normal text-warning-text">supply by owner</span>}</td>
            <td className="text-center tabular-nums">{priced ? lineQty(l) : ''}</td>
            <td className="whitespace-nowrap pl-2 text-right tabular-nums">{priced && section.lumpSumSen === null ? (l.isFoc ? 'FOC' : rm(l.netSen ?? 0)) : ''}</td>
            <td className="pl-4">
              {priced && !gone && (canEdit
                ? <select aria-label="Supplier" className="h-8 w-full max-w-[220px] rounded border border-border bg-surface px-1 text-[12px]" value={e?.supplierId !== undefined ? (e.supplierId ?? '') : (l.supplierId ?? '')} onChange={(ev) => set({ supplierId: ev.target.value || null })}>
                    <option value="">— none —</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
                  </select>
                : <span className="text-ink-secondary">{l.supplierId ? supplierName.get(l.supplierId) ?? '—' : '—'}</span>)}
            </td>
            <td className="w-[110px] text-right">{priced && !gone && (canEdit ? <MoneyInput className="h-8 w-full rounded border border-border px-1 text-right text-[12px]" value={e?.unitCostSen ?? l.unitCostSen} onChange={(v) => set({ unitCostSen: v ?? 0 })} /> : <span className="tabular-nums">{rm(l.unitCostSen)}</span>)}</td>
            <td className="pl-3 pr-3">
              {priced && !gone && (canEdit
                ? <select aria-label="Stage" className="h-8 w-full max-w-[180px] rounded border border-border bg-surface px-1 text-[12px]" value={e?.stageCode !== undefined ? (e.stageCode ?? '') : (l.stageCode ?? '')} onChange={(ev) => set({ stageCode: ev.target.value || null })}>
                    <option value="">From product</option>
                    {RENO_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                  </select>
                : <span className="text-ink-secondary">{l.stageCode ? STAGE_LABEL[l.stageCode as StageKey] : 'From product'}</span>)}
            </td>
          </tr>
        );
      })}
    </>
  );
}

export function RenovationSalesOrder() {
  const { docNo } = useParams();
  const c = useContract(docNo);
  const flags = usePoFlags(docNo);
  const brands = useBrands();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingInstalment | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const run = useRenoMutation(async (fn: () => Promise<unknown>) => fn());
  if (c.isLoading || !c.data) return <div className="p-8 text-center text-[13px] text-ink-muted">{c.error ? refusalOf(c.error).message : 'Loading contract…'}</div>;
  const k = c.data;
  const live = ['RENO_CONFIRMED', 'RENO_IN_PROGRESS', 'RENO_COMPLETED'].includes(k.status);
  const brand = brands.data?.brands.find((b) => b.brandId === k.header.brandId);
  const b = k.billing;

  const setStatus = async (to: string, label: string, danger?: boolean) => {
    if (!(await serviceConfirm({ title: `${label}?`, danger }))) return;
    setError(null);
    try { await run.mutateAsync(() => renoSend(`/sales-orders/${encodeURIComponent(k.docNo)}/status`, 'POST', { status: to })); } catch (e) { setError(refusalOf(e).message); }
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

  return (
    <div className="space-y-4">
      <PageHeader
        back="/scm/renovation/quotations"
        eyebrow={`Renovation contract${k.header.quoteDocNo ? ` · from ${k.header.quoteDocNo}` : ''}`}
        title={k.docNo}
        description={`${k.debtorName}${k.header.building ? ` · ${k.header.building} ${k.header.unitNo}` : ''} · ${fmtDate(k.soDate)}`}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={k.status} />
            <Button variant="secondary" icon={<Printer size={15} />} onClick={() => setPrintOpen(true)}>Print</Button>
            {can('scm.renovation.quote') && (NEXT_STATUS[k.status] ?? []).map((n) => (
              <Button key={n.to} variant={n.danger ? 'danger' : 'secondary'} onClick={() => setStatus(n.to, n.label, n.danger)}>{n.label}</Button>
            ))}
          </div>
        )}
      />
      <ErrorBanner error={error} onClose={() => setError(null)} />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Original contract" value={rm(k.totals.originalContractSen)} />
        <Stat label="Variation orders" value={rm(k.totals.voTotalSen)} tone={k.totals.voTotalSen ? 'warn' : 'muted'} />
        <Stat label="Revised contract" value={rm(k.totals.revisedContractSen)} />
        <Stat label="Billed" value={rm(b.billedSen)} />
        <Stat label="Received" value={rm(b.receivedSen)} tone="ok" />
        <Stat label="To bill" value={rm(b.revisedContractSen - b.billedSen)} />
      </div>
      <Card title="Progress billing" dense>
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
                  <td className={cn('py-2 text-right font-semibold tabular-nums', i.amountSen < 0 && 'text-err', !i.bill && !i.isNext && 'font-normal text-ink-muted')}>{rm(i.amountSen)}{!i.bill && !i.isNext ? <div className="text-[10.5px] font-normal">projected</div> : null}</td>
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
                <span className={cn('font-semibold tabular-nums', i.amountSen < 0 && 'text-err', !i.bill && !i.isNext && 'font-normal text-ink-muted')}>{rm(i.amountSen)}</span>
              </div>
              <div className="text-[11.5px] text-ink-muted">{i.stageCode ? STAGE_LABEL[i.stageCode as StageKey] : 'No stage'} · cum. {pctLabel(i.cumBp)}{!i.bill && !i.isNext ? ' · projected' : ''}</div>
              {i.bill && <div className="mt-0.5 text-[12px]">{i.bill.invoiceNumber ?? i.bill.noteNumber ?? 'Closed, nothing to bill'} · {fmtDate(i.bill.invoiceDate)}{i.bill.kind === 'INVOICE' ? ` · received ${rm(i.bill.paidSen)}` : ''}</div>}
              {i.isNext && live && can('scm.renovation.bill') && <Button className="mt-2 h-8 w-full" onClick={() => setBilling(i)}>Bill this instalment</Button>}
            </li>
          ))}
        </ul>
      </Card>
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
        <PoSplitCard c={k} canSplit={live && can('scm.renovation.po_split')} />
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
      <LinesCard c={k} canEdit={live && can('scm.renovation.po_split')} />
      <BillDialog c={k} inst={billing} onClose={() => setBilling(null)} />
      <PrintDialog open={printOpen} onClose={() => setPrintOpen(false)} title="sales order" docNo={k.docNo} defaultFormat={k.header.printFormat}
        build={(format) => buildPrintDoc({ kind: 'SALES_ORDER', docNo: k.docNo, format, brand, header: { ...k.header, customerName: k.header.customerName || k.debtorName, docDate: k.header.docDate ?? k.soDate }, sections: k.sections, instalments: k.instalments })} />
    </div>
  );
}
