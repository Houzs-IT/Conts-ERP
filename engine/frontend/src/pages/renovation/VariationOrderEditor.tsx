// A variation order on a renovation contract: lines it adds, contract lines it
// omits (whole, or part of the quantity), printed for the customer's signature.
// Approving applies it to the contract: the next unbilled instalment catches
// up the difference, and PO lines that bought omitted work are flagged.

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, Printer, Save, Send } from 'lucide-react';
import { PageHeader } from '../../components/Layout';
import { Button } from '../../components/Button';
import { ModalOverlay } from '../../components/scm-v2/DocumentRelationshipMapModal';
import { useAuth } from '../../auth/AuthContext';
import { serviceConfirm } from '../../vendor/scm/lib/dialog-service';
import { lineAmounts, qtyLabel } from '../../vendor/shared/renovation-money';
import { refusalOf, renoSend, sectionsForSave, useBrands, useContract, useRenoMutation, useVo, type DocLine, type DocSection } from '../../lib/renovation/api';
import { buildPrintDoc } from '../../lib/renovation/print-doc';
import { amountsOf, blankSection, DocEditor } from './DocEditor';
import { PrintDialog } from './PrintDialog';
import { Card, ErrorBanner, Field, inputCls, rm, StatusPill, todayIso } from './shared';
import { cn } from '../../lib/utils';

interface OmitPick { lineId: string; omitQty: number | null }

function omitAmount(l: DocLine, omitQty: number | null): number {
  const base = { kind: l.kind, qty: l.qty, measureMilli: l.measureMilli ?? null, measureUom: l.measureUom, uom: l.uom, unitPriceSen: l.unitPriceSen, discountBp: l.discountBp, amountOverrideSen: l.amountOverrideSen, isFoc: l.isFoc };
  const full = lineAmounts(base).netSen;
  if (omitQty === null || omitQty >= l.qty || l.measureMilli) return -full;
  return -(full - lineAmounts({ ...base, qty: l.qty - omitQty, amountOverrideSen: null }).netSen);
}

export function VariationOrderEditor() {
  const { id } = useParams();
  const vo = useVo(id);
  const contract = useContract(vo.data?.soDocNo);
  const brands = useBrands();
  const { can } = useAuth();
  const [title, setTitle] = useState('');
  const [docDate, setDocDate] = useState(todayIso());
  const [adds, setAdds] = useState<DocSection[]>([]);
  const [omits, setOmits] = useState<OmitPick[]>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [signedName, setSignedName] = useState('');
  const [printOpen, setPrintOpen] = useState(false);
  const run = useRenoMutation(async (fn: () => Promise<unknown>) => fn());

  useEffect(() => {
    if (!vo.data) return;
    setTitle(vo.data.title);
    setDocDate(vo.data.docDate);
    const addSections = vo.data.sections
      .map((s) => ({ ...s, lines: s.lines.filter((l) => l.voChange !== 'OMIT') }))
      .filter((s) => s.lines.length > 0);
    setAdds(addSections.length ? addSections : vo.data.status === 'DRAFT' ? [blankSection('ADD ON :')] : []);
    setOmits(vo.data.sections.flatMap((s) => s.lines.filter((l) => l.voChange === 'OMIT' && l.omitTargetLineId).map((l) => ({ lineId: l.omitTargetLineId!, omitQty: l.omitQty ?? null }))));
    setSignedName(vo.data.signedName ?? '');
    setDirty(false);
  }, [vo.data]);

  const targets = useMemo(() => (contract.data?.sections ?? []).flatMap((s) => (s.lumpSumSen !== null ? [] : s.lines
    .filter((l) => (l.kind === 'ITEM' || l.kind === 'CHILD') && !l.omittedByVoId && !l.soItemCancelled)
    .map((l) => ({ section: s.heading, line: l })))), [contract.data]);

  if (vo.isLoading || !vo.data) return <div className="p-8 text-center text-[13px] text-ink-muted">{vo.error ? refusalOf(vo.error).message : 'Loading variation order…'}</div>;
  const v = vo.data;
  const editable = v.status === 'DRAFT' && can('scm.renovation.quote');
  const addSen = adds.reduce((s, sec) => s + sec.lines.reduce((t, l) => t + amountsOf(l).netSen, 0), 0);
  const omitSen = v.status === 'APPROVED' ? v.totals.omitSen : omits.reduce((s, o) => {
    const t = targets.find((x) => x.line.id === o.lineId);
    return s + (t ? omitAmount(t.line, o.omitQty) : 0);
  }, 0);
  const netSen = v.status === 'APPROVED' ? v.totals.netSen : addSen + omitSen;

  const bodySections = (): unknown[] => {
    const add = sectionsForSave(adds.filter((s) => s.lines.length > 0)) as Array<{ lines: unknown[] }>;
    const omitLines = omits.map((o) => ({ kind: 'ITEM', voChange: 'OMIT', omitTargetLineId: o.lineId, omitQty: o.omitQty, description: '' }));
    return omitLines.length ? [...add, { heading: 'OMIT', bandColor: null, lumpSumSen: null, pageBreakBefore: false, lines: omitLines }] : add;
  };
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await run.mutateAsync(fn); return true; } catch (e) { setError(refusalOf(e).message); return false; }
  };
  const save = () => act(() => renoSend(`/variation-orders/${v.id}`, 'PUT', { version: v.version, title, docDate, sections: bodySections() })).then((ok) => ok && setDirty(false));
  const setStatus = async (to: string, confirm?: string) => {
    if (confirm && !(await serviceConfirm({ title: confirm, danger: to === 'CANCELLED' }))) return;
    if (dirty) { setError('Save your changes first.'); return; }
    await act(() => renoSend(`/variation-orders/${v.id}/status`, 'POST', { status: to, version: v.version }));
  };
  const approve = async () => {
    if (await act(() => renoSend(`/variation-orders/${v.id}/approve`, 'POST', { version: v.version, signedName: signedName || null }))) setApproveOpen(false);
  };
  const toggleOmit = (lineId: string, on: boolean) => { setOmits(on ? [...omits, { lineId, omitQty: null }] : omits.filter((o) => o.lineId !== lineId)); setDirty(true); };
  const brand = brands.data?.brands.find((b) => b.brandId === contract.data?.header.brandId);
  const printSections: DocSection[] = [
    ...adds,
    ...(omits.length ? [{
      heading: 'OMIT', bandColor: '#f5c6e6', lumpSumSen: null, pageBreakBefore: false,
      lines: omits.flatMap((o) => {
        const t = targets.find((x) => x.line.id === o.lineId)?.line ?? v.sections.flatMap((s) => s.lines).find((l) => l.omitTargetLineId === o.lineId);
        if (!t) return [];
        return [{ ...t, kind: 'ITEM' as const, parentId: null, qty: o.omitQty ?? t.qty, voChange: 'OMIT' as const, netSen: omitAmount(t, o.omitQty) }];
      }),
    }] : []),
  ];

  return (
    <div className="space-y-4 pb-20">
      <PageHeader
        back={`/scm/renovation/contracts/${encodeURIComponent(v.soDocNo)}`}
        eyebrow="Variation order"
        eyebrowMeta={<Link className="text-primary" to={`/scm/renovation/contracts/${encodeURIComponent(v.soDocNo)}`}>{v.soDocNo}</Link>}
        title={v.voNo}
        description={v.title || 'Add and omit lines on the contract'}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={v.status} />
            <Button variant="secondary" icon={<Printer size={15} />} onClick={() => setPrintOpen(true)}>Print</Button>
            {editable && <Button icon={<Save size={15} />} disabled={!dirty || run.isPending} onClick={save}>Save</Button>}
          </div>
        )}
      />
      <ErrorBanner error={error} onClose={() => setError(null)} />
      {v.status !== 'APPROVED' && v.status !== 'CANCELLED' && can('scm.renovation.quote') && (
        <div className="flex flex-wrap gap-2">
          {v.status === 'DRAFT' && <Button variant="secondary" icon={<Send size={15} />} onClick={() => setStatus('SENT')}>Mark sent for signature</Button>}
          {v.status === 'SENT' && <Button variant="ghost" onClick={() => setStatus('DRAFT')}>Back to draft</Button>}
          {can('scm.renovation.vo.apply') && <Button icon={<CheckCircle2 size={15} />} onClick={() => (dirty ? setError('Save your changes first.') : setApproveOpen(true))}>Approve and apply</Button>}
          <Button variant="ghost" onClick={() => setStatus('CANCELLED', 'Cancel this variation order?')}>Cancel VO</Button>
        </div>
      )}
      {v.status === 'APPROVED' && <div className="rounded-lg border border-synced/30 bg-synced-bg px-3 py-2 text-[13px] text-synced">Approved{v.signedName ? `, signed by ${v.signedName}` : ''}. The contract and its next instalment include it.</div>}
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-4">
          <Card title="Details">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_200px]">
              <Field label="Title"><input className={inputCls} disabled={!editable} value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} placeholder="e.g. Add wall skim, drop study table" /></Field>
              <Field label="Date"><input type="date" className={inputCls} disabled={!editable} value={docDate} onChange={(e) => { setDocDate(e.target.value); setDirty(true); }} /></Field>
            </div>
          </Card>
          <div>
            <h2 className="mb-2 text-[13.5px] font-semibold text-ink">Add</h2>
            <DocEditor sections={adds} disabled={!editable} allowLumpSum={false} onChange={(s) => { setAdds(s); setDirty(true); }} />
          </div>
          <Card title="Omit from the contract" dense>
            {v.status === 'APPROVED' ? (
              <ul className="divide-y divide-border-subtle text-[12.5px]">
                {v.sections.flatMap((s) => s.lines.filter((l) => l.voChange === 'OMIT')).map((l) => (
                  <li key={l.id} className="flex justify-between px-3 py-1.5"><span>{l.description} <span className="text-ink-muted">x {l.qty}</span></span><span className="tabular-nums text-err">{rm(l.netSen ?? 0)}</span></li>
                ))}
              </ul>
            ) : (
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full min-w-[560px] text-left text-[12.5px]">
                  <thead className="sticky top-0 bg-surface-2 text-[10.5px] uppercase tracking-wide text-ink-muted"><tr><th className="w-10 px-3 py-1.5" /><th>Contract line</th><th className="text-center">Qty</th><th className="w-[90px] text-center">Omit qty</th><th className="px-3 text-right">Amount</th></tr></thead>
                  <tbody>
                    {targets.map(({ section, line }) => {
                      const pick = omits.find((o) => o.lineId === line.id);
                      return (
                        <tr key={line.id} className={cn('border-t border-border-subtle', pick && 'bg-err-bg/50')}>
                          <td className="px-3"><input type="checkbox" aria-label="Omit this line" disabled={!editable} checked={Boolean(pick)} onChange={(e) => toggleOmit(line.id!, e.target.checked)} /></td>
                          <td className="py-1.5"><span className={line.kind === 'ITEM' ? 'font-semibold' : 'pl-3'}>{line.description}</span> <span className="text-[11px] text-ink-muted">{section}</span></td>
                          <td className="text-center tabular-nums">{qtyLabel({ qty: line.qty, measureMilli: line.measureMilli ?? null, measureUom: line.measureUom, uom: line.uom })}</td>
                          <td className="text-center">
                            {pick && line.qty > 1 && !line.measureMilli && (
                              <input aria-label="Omit qty" inputMode="numeric" disabled={!editable} className="h-7 w-16 rounded border border-border text-center" value={pick.omitQty ?? line.qty}
                                onChange={(e) => { const n = Math.max(1, Math.min(line.qty, Math.trunc(Number(e.target.value) || 1))); setOmits(omits.map((o) => (o.lineId === line.id ? { ...o, omitQty: n >= line.qty ? null : n } : o))); setDirty(true); }} />
                            )}
                          </td>
                          <td className="px-3 text-right tabular-nums">{pick ? <span className="text-err">{rm(omitAmount(line, pick.omitQty))}</span> : rm(line.netSen ?? 0)}</td>
                        </tr>
                      );
                    })}
                    {targets.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-ink-muted">{contract.isLoading ? 'Loading contract lines…' : 'No contract line can be omitted.'}</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
        <div className="2xl:sticky 2xl:top-4 2xl:self-start">
          <Card title="Variation">
            <dl className="space-y-1.5 text-[13px]">
              <div className="flex justify-between"><dt className="text-ink-secondary">Added</dt><dd className="tabular-nums">{rm(addSen)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-secondary">Omitted</dt><dd className="tabular-nums text-err">{rm(omitSen)}</dd></div>
              <div className="flex justify-between border-t border-border-subtle pt-1.5 text-[15px] font-semibold"><dt>Net change</dt><dd className={cn('tabular-nums', netSen < 0 && 'text-err')}>{rm(netSen)}</dd></div>
              {contract.data && <div className="flex justify-between text-ink-secondary"><dt>Contract after</dt><dd className="tabular-nums">{rm(contract.data.totals.revisedContractSen + (v.status === 'APPROVED' ? 0 : netSen))}</dd></div>}
              {netSen < 0 && v.status !== 'APPROVED' && <p className="rounded bg-warning-bg px-2 py-1 text-[12px] text-warning-text">A net reduction lowers the next instalment; if more was already billed, that instalment becomes a credit note.</p>}
            </dl>
          </Card>
        </div>
      </div>
      <ModalOverlay open={approveOpen} onClose={() => setApproveOpen(false)} title={`Approve ${v.voNo}`} icon={<CheckCircle2 size={16} />}
        footer={<div className="flex w-full justify-end gap-2"><Button variant="secondary" onClick={() => setApproveOpen(false)}>Cancel</Button><Button disabled={run.isPending} onClick={approve}>{run.isPending ? 'Applying…' : 'Approve and apply'}</Button></div>}>
        <div className="space-y-3 text-[13px]">
          <p>The contract changes by <span className="font-semibold">{rm(netSen)}</span>. Added lines join the contract; omitted lines are cancelled or reduced, and their PO lines are flagged for procurement.</p>
          <Field label="Signed by (customer)"><input className={inputCls} value={signedName} onChange={(e) => setSignedName(e.target.value)} placeholder="Name on the signed VO" /></Field>
          <ErrorBanner error={error} />
        </div>
      </ModalOverlay>
      <PrintDialog open={printOpen} onClose={() => setPrintOpen(false)} title="variation order" docNo={v.voNo} defaultFormat={contract.data?.header.printFormat ?? 'AMOUNT'}
        build={(format) => buildPrintDoc({
          kind: 'VARIATION_ORDER', docNo: v.voNo, format, brand, reference: `Contract ${v.soDocNo}`,
          header: { ...(contract.data?.header ?? {}), customerName: contract.data?.header.customerName || contract.data?.debtorName || '', docDate: docDate, lastAmended: null, docDiscountSen: 0, promoLines: [] },
          sections: printSections,
        })} />
    </div>
  );
}
