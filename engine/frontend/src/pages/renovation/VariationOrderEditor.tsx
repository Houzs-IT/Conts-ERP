// A variation order on a renovation contract: lines it adds, contract lines it
// omits (whole, or part of the quantity), printed for the customer's signature.
// Approving applies it to the contract: the next unbilled instalment catches
// up the difference, and PO lines that bought omitted work are flagged.

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Package, Printer, Save, Send } from 'lucide-react';
import { QuotationSoPrint } from '../scm-v2/renovationQuotationPrint';
import { PageHeader } from '../../components/Layout';
import { Button } from '../../components/Button';
import { ModalOverlay } from '../../components/scm-v2/DocumentRelationshipMapModal';
import { useAuth } from '../../auth/AuthContext';
import { serviceConfirm } from '../../vendor/scm/lib/dialog-service';
import { lineAmounts, qtyLabel } from '../../vendor/shared/renovation-money';
import { contractPostingWarning, refusalOf, renoSend, sectionsForSave, useBrands, useContract, useRenoMutation, useVo, type ContractPosting, type DocHeader, type DocLine, type DocSection } from '../../lib/renovation/api';
import { useToast } from '../../hooks/useToast';
import { amountsOf, blankSection, DocEditor } from './DocEditor';
import { DocAttachments } from '../../components/doc-attachments/DocAttachments';
import { Card, ErrorBanner, Field, inputCls, rm, StatusPill, todayIso } from './shared';
import { cn } from '../../lib/utils';
import { useRenovationDraft } from '../../lib/renovation/renovationFormDraft';
import { RenovationDraftBanner } from './renovationDraftBanner';
import { loadTemplateSections } from './fromTemplate';
import { usePackages } from '../../lib/renovation/renovationPackagesApi';
import { PackageConfirmDialog, PackagePickerDialog, type PackageAdd } from './renovationPackagePick';
import { PkgMark } from './renovationPackageParts';
import { withPackageAdd } from './renovationPackageAdd';
import type { VoEdits } from '../../lib/renovation/api';
import { ACTION_BUTTON, VoRoomEditor } from './VoRoomEditor';
import { EMPTY_EDITS, isPreRoomDraft, packageAdds, roomsOf, totalsOf } from './voRoomModel';

/* Packages (owner, 20 Nov 2026): a package or kit picked in the product search or with From package opens its confirm
   dialog; the ticked lines join the Add part as additions, each remembering the package. A kit with no area goes into
   the area the user is in. The banner says what came from each package; Change picks reopens the dialog, Remove these
   lines takes them all out. None of it is printed. */
interface ConfirmOpen { packageId: string; defaultArea: string; sectionIndex: number | null; lineIndex: number | null; replace: boolean }

/* 16px on phones so iOS does not zoom into the field; cn only joins classes, so the size is swapped, not added. */
const PHONE_INPUT = inputCls.replace('text-[13px]', 'text-[16px] lg:text-[13px]');

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
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [docDate, setDocDate] = useState(todayIso());
  const [adds, setAdds] = useState<DocSection[]>([]);
  const [omits, setOmits] = useState<OmitPick[]>([]);
  /* Room editor (owner, 23 Nov 2026): a new draft, or one saved from it, changes contract lines in place. A VO built in
     the Add and Omit layout, and any approved or cancelled VO, keeps that layout. */
  const [edits, setEdits] = useState<VoEdits>(EMPTY_EDITS);
  const roomMode = Boolean(vo.data && vo.data.status !== 'APPROVED' && vo.data.status !== 'CANCELLED'
    && (vo.data.edits || (vo.data.status === 'DRAFT' && vo.data.sections.length === 0)));
  const [dirty, setDirty] = useState(false);
  /* Saved, and the server's copy is on its way: the form stays shut until it lands, or the refetch would replace what was typed meanwhile. */
  const [settling, setSettling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [signedName, setSignedName] = useState('');
  const [printOpen, setPrintOpen] = useState(false);
  const run = useRenoMutation(async (fn: () => Promise<unknown>) => fn());
  const [params, setParams] = useSearchParams();
  const packages = usePackages();
  const pkgById = useMemo(() => new Map((packages.data?.packages ?? []).map((x) => [x.id, x])), [packages.data]);
  const packageCodes = useMemo(() => Object.fromEntries([...pkgById.values()].map((x) => [x.id, x.code])), [pkgById]);
  const [confirm, setConfirm] = useState<ConfirmOpen | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const addPackage = (a: PackageAdd) => {
    if (!confirm) return;
    const kind = pkgById.get(a.packageId)?.kind ?? 'PACKAGE';
    if (roomMode) {
      const r = packageAdds(edits, a.sections, a.packageId, confirm.defaultArea, confirm.replace);
      setEdits(r.edits);
      if (r.skipped) toast.warning(`${r.skipped} line(s) of ${a.code} have no product, or are measured, free or discounted, so they were left out.`);
    } else {
      setAdds((cur) => withPackageAdd(cur, a, kind, confirm, confirm.replace));
    }
    setTitle((cur) => (cur.trim() ? cur : `From package ${a.code}`));
    setDirty(true);
    setConfirm(null);
    toast.success(`${a.code} added. Check the lines, then save.`);
  };
  const lastArea = (): string => (roomMode ? edits.adds[edits.adds.length - 1]?.room ?? '' : [...adds].reverse().find((s) => s.heading.trim())?.heading ?? '');
  /* An old From template link (?template=) still works: the template's sections go into the Add part. */
  const addTemplate = async (templateId: string): Promise<void> => {
    if (!templateId) return;
    try {
      const t = await loadTemplateSections(templateId);
      if (roomMode) {
        const r = packageAdds(edits, t.sections, null, '', false);
        setEdits(r.edits);
        if (r.skipped) toast.warning(`${r.skipped} line(s) of ${t.name} have no product, or are measured, free or discounted, so they were left out.`);
      }
      else setAdds((cur) => [...cur.filter((s) => s.lines.some((l) => l.itemCode || l.description.trim())), ...t.sections]);
      setTitle((cur) => cur.trim() ? cur : `From package template ${t.name}`);
      setDirty(true);
      toast.success(`${t.name} added. Check the lines, then save.`);
    } catch (e) { setError(refusalOf(e).message); }
  };

  useEffect(() => {
    if (!vo.data) return;
    setTitle(vo.data.title);
    setDocDate(vo.data.docDate);
    const addSections = vo.data.sections
      .map((s) => ({ ...s, lines: s.lines.filter((l) => l.voChange !== 'OMIT') }))
      .filter((s) => s.lines.length > 0);
    setAdds(addSections.length ? addSections : vo.data.status === 'DRAFT' ? [blankSection('ADD ON :')] : []);
    setOmits(vo.data.sections.flatMap((s) => s.lines.filter((l) => l.voChange === 'OMIT' && l.omitTargetLineId).map((l) => ({ lineId: l.omitTargetLineId!, omitQty: l.omitQty ?? null }))));
    setEdits(vo.data.edits ?? EMPTY_EDITS);
    setSignedName(vo.data.signedName ?? '');
    setDirty(false);
    setSettling(false);
  }, [vo.data]);
  const fromPackage = params.get('package');
  useEffect(() => {
    if (!fromPackage || !vo.data || vo.data.status !== 'DRAFT') return;
    setParams((p) => { const n = new URLSearchParams(p); n.delete('package'); return n; }, { replace: true });
    setConfirm({ packageId: fromPackage, defaultArea: '', sectionIndex: null, lineIndex: null, replace: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the VO has loaded
  }, [fromPackage, vo.data?.id]);
  const fromTemplate = params.get('template');
  useEffect(() => {
    if (!fromTemplate || !vo.data || vo.data.status !== 'DRAFT') return;
    setParams((p) => { const n = new URLSearchParams(p); n.delete('template'); return n; }, { replace: true });
    void addTemplate(fromTemplate);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the VO has loaded
  }, [fromTemplate, vo.data?.id]);

  const draftValue = useMemo(() => ({ title, docDate, adds, omits, edits }), [title, docDate, adds, omits, edits]);
  const draft = useRenovationDraft(
    vo.data?.status === 'DRAFT' && can('scm.renovation.quote') ? `vo:${vo.data.id}` : null,
    draftValue, dirty, vo.data?.version ?? null,
  );
  const restoreDraft = () => {
    /* Drafts kept in the browser before the room editor have no `edits`. */
    const offeredDraft: (Omit<typeof draftValue, 'edits'> & { edits?: VoEdits }) | undefined = draft.offered?.v;
    /* Never restore an old Add and Omit draft into the room layout. */
    if (offeredDraft && roomMode && isPreRoomDraft(offeredDraft)) {
      setError('That unsaved draft was made in the old Add and Omit layout and cannot be opened here. Make the changes again below.');
    } else if (offeredDraft) {
      setTitle(offeredDraft.title); setDocDate(offeredDraft.docDate); setAdds(offeredDraft.adds); setOmits(offeredDraft.omits);
      setEdits(offeredDraft.edits ?? EMPTY_EDITS); setDirty(true);
    }
    draft.answer(true);
  };

  const targets = useMemo(() => (contract.data?.sections ?? []).flatMap((s) => (s.lumpSumSen !== null ? [] : s.lines
    .filter((l) => (l.kind === 'ITEM' || l.kind === 'CHILD') && !l.omittedByVoId && !l.soItemCancelled)
    .map((l) => ({ section: s.heading, line: l })))), [contract.data]);

  if (vo.isLoading || !vo.data) return <div className="p-8 text-center text-[13px] text-ink-muted">{vo.error ? refusalOf(vo.error).message : 'Loading variation order…'}</div>;
  const v = vo.data;
  const editable = v.status === 'DRAFT' && can('scm.renovation.quote');
  const locked = !editable || run.isPending || (settling && vo.isFetching);
  const filesEditable = v.status !== 'CANCELLED' && can('scm.renovation.quote');
  /* Saved: the server's own add and omit lines (a changed line can be an omit plus an add). Unsaved: the editor's estimate. */
  const roomTotals = !roomMode ? null : dirty && contract.data ? totalsOf(roomsOf(contract.data.sections, edits)) : { addSen: v.totals.addSen, omitSen: v.totals.omitSen };
  const addSen = roomTotals ? roomTotals.addSen : adds.reduce((s, sec) => s + sec.lines.reduce((t, l) => t + amountsOf(l).netSen, 0), 0);
  const omitSen = roomTotals ? roomTotals.omitSen : v.status === 'APPROVED' ? v.totals.omitSen : omits.reduce((s, o) => {
    const t = targets.find((x) => x.line.id === o.lineId);
    return s + (t ? omitAmount(t.line, o.omitQty) : 0);
  }, 0);
  const netSen = v.status === 'APPROVED' ? v.totals.netSen : addSen + omitSen;

  const packageGroups = [...new Set(adds.flatMap((s) => s.lines.map((l) => l.fromPackageId).filter((x): x is string => Boolean(x))))].map((pid) => {
    const ls = adds.flatMap((s) => s.lines.filter((l) => l.fromPackageId === pid && (l.kind === 'ITEM' || l.kind === 'CHILD')));
    const row = pkgById.get(pid);
    return { id: pid, code: row?.code ?? null, name: row?.name ?? '', n: ls.length, m: row?.lines ?? 0, sen: ls.reduce((t, l) => t + amountsOf(l).netSen, 0),
      area: adds.find((s) => s.lines.some((l) => l.fromPackageId === pid))?.heading ?? '' };
  });
  const removePackage = (pid: string) => {
    setAdds(adds.map((s) => ({ ...s, lines: s.lines.filter((l) => l.fromPackageId !== pid) })).filter((s) => s.lines.length > 0));
    setDirty(true);
  };
  const bodySections = (): unknown[] => {
    /* The form opens with an empty line to type in: a VO that only omits must not be refused for it. */
    const typed = adds.map((s) => ({ ...s, lines: s.lines.filter((l) => l.kind !== 'ITEM' || l.itemCode || l.description.trim() || amountsOf(l).netSen !== 0) })).filter((s) => s.lines.length > 0);
    const add = sectionsForSave(typed) as Array<{ lines: unknown[] }>;
    const omitLines = omits.map((o) => ({ kind: 'ITEM', voChange: 'OMIT', omitTargetLineId: o.lineId, omitQty: o.omitQty, description: '' }));
    return omitLines.length ? [...add, { heading: 'OMIT', bandColor: null, lumpSumSen: null, pageBreakBefore: false, lines: omitLines }] : add;
  };
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await run.mutateAsync(fn); return true; } catch (e) { setError(refusalOf(e).message); return false; }
  };
  const save = () => act(() => (roomMode
    ? renoSend(`/variation-orders/${v.id}/edits`, 'PUT', { version: v.version, title, docDate, edits })
    : renoSend(`/variation-orders/${v.id}`, 'PUT', { version: v.version, title, docDate, sections: bodySections() }))).then((ok) => { if (ok) { setDirty(false); setSettling(true); draft.clear(); } });
  const openPrint = () => (roomMode && dirty ? setError('Save your changes first, then print.') : setPrintOpen(true));
  const setStatus = async (to: string, confirm?: string) => {
    if (confirm && !(await serviceConfirm({ title: confirm, danger: to === 'CANCELLED' }))) return;
    if (dirty) { setError('Save your changes first.'); return; }
    await act(() => renoSend(`/variation-orders/${v.id}/status`, 'POST', { status: to, version: v.version }));
  };
  const approve = async () => {
    let posting: ContractPosting | undefined;
    const ok = await act(async () => {
      const r = await renoSend<{ posting?: ContractPosting }>(`/variation-orders/${v.id}/approve`, 'POST', { version: v.version, signedName: signedName || null });
      posting = r.posting;
    });
    if (!ok) return;
    setApproveOpen(false);
    const warning = contractPostingWarning(posting);
    if (warning) toast.warning(warning);
  };
  const toggleOmit = (lineId: string, on: boolean) => { setOmits(on ? [...omits, { lineId, omitQty: null }] : omits.filter((o) => o.lineId !== lineId)); setDirty(true); };
  const brand = brands.data?.brands.find((b) => b.brandId === contract.data?.header.brandId);
  /* Room mode prints the add and omit lines the server rebuilt from the saved edits. */
  const printSections: DocSection[] = roomMode ? v.sections : [
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
            <Button variant="secondary" icon={<Printer size={15} />} onClick={openPrint}>Print</Button>
            {editable && <Button icon={<Save size={15} />} disabled={!dirty || run.isPending} onClick={save}>Save</Button>}
          </div>
        )}
      />
      <ErrorBanner error={error} onClose={() => setError(null)} />
      {draft.offered && <RenovationDraftBanner savedAt={draft.offered.ts} stale={draft.stale} onRestore={restoreDraft} onDiscard={() => draft.answer(false)} />}
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
              <Field label="Title"><input className={PHONE_INPUT} disabled={locked} value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} placeholder="e.g. Add wall skim, drop study table" /></Field>
              <Field label="Date"><input type="date" className={PHONE_INPUT} disabled={locked} value={docDate} onChange={(e) => { setDocDate(e.target.value); setDirty(true); }} /></Field>
            </div>
          </Card>
          {roomMode && (
            <div>
              {editable && (
                <div className="mb-2 flex justify-end">
                  <button type="button" className={ACTION_BUTTON} onClick={() => setPickerOpen(true)}><Package size={14} />From package</button>
                </div>
              )}
              <VoRoomEditor sections={contract.data?.sections ?? null} edits={edits} disabled={locked}
                contractError={contract.error ? refusalOf(contract.error).message : null} onRetry={() => void contract.refetch()} specs={v.lineSpecs ?? {}}
                onChange={(next) => { setEdits(next); setDirty(true); }} />
              <PackagePickerDialog open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={(h) => { setPickerOpen(false); setConfirm({ packageId: h.id, defaultArea: lastArea(), sectionIndex: null, lineIndex: null, replace: false }); }} />
              <PackageConfirmDialog packageId={confirm?.packageId ?? null} defaultArea={confirm?.defaultArea ?? ''} onClose={() => setConfirm(null)} onAdd={addPackage} />
            </div>
          )}
          {!roomMode && <>
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[13.5px] font-semibold text-ink">Add</h2>
              {editable && <Button variant="secondary" className="h-8" icon={<Package size={14} />} onClick={() => setPickerOpen(true)}>From package</Button>}
            </div>
            {packageGroups.map((g) => (
              <div key={g.id} className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-[#e7b7d3] bg-[#fbe7f2]/60 px-3 py-2 text-[13px] text-ink">
                <PkgMark code={g.code} />
                <span><b>{g.code ?? 'Package'}</b>{g.name ? ` ${g.name}` : ''} added: {g.n}{g.m ? ` of ${g.m}` : ''} line{g.n === 1 ? '' : 's'}, {rm(g.sen)}</span>
                <span className="flex-1" />
                {editable && <Button variant="secondary" className="h-7 px-2 text-[12px]" onClick={() => setConfirm({ packageId: g.id, defaultArea: g.area, sectionIndex: null, lineIndex: null, replace: true })}>Change picks</Button>}
                {editable && <Button variant="secondary" className="h-7 px-2 text-[12px]" onClick={() => removePackage(g.id)}>Remove these lines</Button>}
              </div>
            ))}
            <DocEditor sections={adds} disabled={locked} allowLumpSum={false} onChange={(s) => { setAdds(s); setDirty(true); }}
              files={{ docType: 'variation_order', docId: v.id, canEdit: filesEditable }} packageCodes={packageCodes}
              onPickPackage={editable ? (h, si, li) => setConfirm({ packageId: h.id, defaultArea: adds[si]?.heading ?? '', sectionIndex: si, lineIndex: li, replace: false }) : undefined} />
            <PackagePickerDialog open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={(h) => { setPickerOpen(false); setConfirm({ packageId: h.id, defaultArea: lastArea(), sectionIndex: null, lineIndex: null, replace: false }); }} />
            <PackageConfirmDialog packageId={confirm?.packageId ?? null} defaultArea={confirm?.defaultArea ?? ''} onClose={() => setConfirm(null)} onAdd={addPackage}
              initial={confirm?.replace ? adds.map((s) => ({ ...s, lines: s.lines.filter((l) => l.fromPackageId === confirm.packageId) })).filter((s) => s.lines.length > 0) : undefined} />
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
                          <td className="px-3"><input type="checkbox" aria-label="Omit this line" disabled={locked} checked={Boolean(pick)} onChange={(e) => toggleOmit(line.id!, e.target.checked)} /></td>
                          <td className="py-1.5"><span className={line.kind === 'ITEM' ? 'font-semibold' : 'pl-3'}>{line.description}</span> <span className="text-[11px] text-ink-muted">{section}</span></td>
                          <td className="text-center tabular-nums">{qtyLabel({ qty: line.qty, measureMilli: line.measureMilli ?? null, measureUom: line.measureUom, uom: line.uom })}</td>
                          <td className="text-center">
                            {pick && line.qty > 1 && !line.measureMilli && (
                              <input aria-label="Omit qty" inputMode="numeric" disabled={locked} className="h-7 w-16 rounded border border-border text-center" value={pick.omitQty ?? line.qty}
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
          </>}
          <DocAttachments docType="variation_order" docId={v.id} canEdit={filesEditable} />
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
          <Field label="Signed by (customer)"><input className={PHONE_INPUT} value={signedName} onChange={(e) => setSignedName(e.target.value)} placeholder="Name on the signed VO" /></Field>
          <ErrorBanner error={error} />
        </div>
      </ModalOverlay>
      <QuotationSoPrint kind="VARIATION_ORDER" open={printOpen} onClose={() => setPrintOpen(false)} docNo={v.voNo} status={v.status} reference={v.soDocNo}
        header={{ ...(contract.data?.header ?? ({} as DocHeader)), customerName: contract.data?.header.customerName || contract.data?.debtorName || '', docDate, lastAmended: null, docDiscountSen: 0, promoLines: [] }}
        sections={printSections} instalments={[]} brand={brand} />
    </div>
  );
}
