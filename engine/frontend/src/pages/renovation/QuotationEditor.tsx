// One renovation quotation: header, sections and lines, payment terms, totals.
// Only the newest revision of a draft is editable; Send freezes it for the
// customer, a new revision (R2, R3 ...) reopens a copy, Accept marks the
// revision the customer took, Convert turns it into the sales order.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Copy, FileCheck2, Printer, Save, Send } from 'lucide-react';
import { PageHeader } from '../../components/Layout';
import { Button } from '../../components/Button';
import { useAuth } from '../../auth/AuthContext';
import { serviceConfirm } from '../../vendor/scm/lib/dialog-service';
import { useDialog } from '../../hooks/useDialog';
import {
  instalmentsForSave, refusalOf, renoSend, sectionsForSave, useBrands, useQuotation, useRenoMutation, useTerms,
  type DocHeader, type DocSection, type Instalment,
} from '../../lib/renovation/api';
import { buildPrintDoc } from '../../lib/renovation/print-doc';
import { DocEditor, type RoomLayout } from './DocEditor';
import { useQuery } from '@tanstack/react-query';
import { soInfoApi, useSoInfoLists } from '../projects/renovation/customerPropertyApi';
import { HeaderForm, InstalmentEditor, totalsOfSections, TotalsCard } from './DocParts';
import { QuotationCustomerCard } from './QuotationCustomerCard';
import { PrintDialog } from './PrintDialog';
import { Card, ErrorBanner, fmtDate, StatusPill, todayIso } from './shared';

export function QuotationEditor() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const rev = params.get('rev') ? Number(params.get('rev')) : undefined;
  const q = useQuotation(id, rev);
  const brands = useBrands();
  const terms = useTerms();
  const navigate = useNavigate();
  const { can } = useAuth();
  const dialog = useDialog();
  const canQuote = can('scm.renovation.quote');

  const [header, setHeader] = useState<DocHeader | null>(null);
  const [sections, setSections] = useState<DocSection[]>([]);
  const [instalments, setInstalments] = useState<Instalment[]>([]);
  const [brandId, setBrandId] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  /* What keeps the customer + property block from saving (an invalid sq ft), [] when fine. */
  const [partyProblems, setPartyProblems] = useState<string[]>([]);

  useEffect(() => {
    if (!q.data) return;
    setHeader(q.data.revision.header);
    setSections(q.data.revision.sections);
    setInstalments(q.data.revision.instalments);
    setBrandId(q.data.quotation.brandId);
    setDirty(false);
    setPartyProblems([]);
  }, [q.data]);

  /* Generate rooms from layout (owner, 14 Oct 2026): the quotation's own layout (mig 0116),
     else its project's (the project masters the property; mig 0112). No button before 0112. */
  const roomsOn = useSoInfoLists().data?.ready === true;
  const projectId = q.data?.quotation.projectId ?? null;
  const proj = useQuery({
    queryKey: ['reno', 'so-info', 'project', projectId],
    queryFn: () => soInfoApi.project(projectId!),
    enabled: roomsOn && projectId != null,
    staleTime: 30_000,
  });
  const ownLayout = header?.bedrooms != null && header.bathrooms != null
    ? { label: header.layoutLabel || `${header.bedrooms} bed ${header.bathrooms} bath`, bedrooms: header.bedrooms, bathrooms: header.bathrooms } : null;
  const roomLayout: RoomLayout | undefined = !roomsOn ? undefined
    : ownLayout ? ownLayout
    : projectId == null ? { missing: 'Link the quotation to a project with a layout first.' }
    : proj.data?.project.bedrooms != null && proj.data.project.bathrooms != null
      ? { label: proj.data.project.layoutLabel || `${proj.data.project.bedrooms} bed ${proj.data.project.bathrooms} bath`, bedrooms: proj.data.project.bedrooms, bathrooms: proj.data.project.bathrooms }
      : { missing: proj.isLoading ? 'Reading the project layout...' : "Choose the project's layout first (on the project or its sales order)." };

  const editable = Boolean(q.data?.editable) && canQuote;
  const totals = useMemo(() => totalsOfSections(sections, header?.docDiscountSen ?? 0), [sections, header?.docDiscountSen]);
  const run = useRenoMutation(async (fn: () => Promise<unknown>) => fn());
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await run.mutateAsync(fn); } catch (e) { setError(refusalOf(e).message); throw e; }
  };

  if (q.isLoading || !header || !q.data) {
    return <div className="p-8 text-center text-[13px] text-ink-muted">{q.error ? refusalOf(q.error).message : 'Loading quotation…'}</div>;
  }
  const { quotation, revision, revisions } = q.data;
  const version = quotation.version;

  const save = () => (partyProblems.length ? Promise.resolve(setError(partyProblems.join(' '))) : act(() => renoSend(`/quotations/${quotation.id}`, 'PUT', {
    version, header: { ...header, brandId }, sections: sectionsForSave(sections), instalments: instalmentsForSave(instalments),
  })).then(() => setDirty(false)).catch(() => undefined));
  const partyHere = q.data.propertyReady === true;
  const status = async (to: string, confirm?: string) => {
    if (confirm && !(await serviceConfirm({ title: confirm }))) return;
    if (dirty) { setError('Save your changes first.'); return; }
    await act(() => renoSend(`/quotations/${quotation.id}/status`, 'POST', { status: to, version })).catch(() => undefined);
  };
  const newRevision = async () => {
    if (!(await serviceConfirm({ title: `Start revision R${quotation.currentRev + 1}?`, body: `${revision.docNo} is frozen as sent; the new revision is a copy you can edit.` }))) return;
    await act(() => renoSend(`/quotations/${quotation.id}/revisions`, 'POST', { version })).then(() => setParams({}, { replace: true })).catch(() => undefined);
  };
  const convert = async () => {
    if (!(await serviceConfirm({ title: 'Convert to the sales order?', body: `Every line of ${revision.docNo} becomes the contract of this project, and the quotation locks.`, confirmLabel: 'Convert' }))) return;
    setError(null);
    try {
      const r = await run.mutateAsync(() => renoSend<{ docNo: string }>(`/quotations/${quotation.id}/convert`, 'POST', { version, soDate: todayIso() })) as { docNo: string };
      navigate(`/scm/renovation/contracts/${encodeURIComponent(r.docNo)}`);
    } catch (e) { setError(refusalOf(e).message); }
  };
  const saveAsTemplate = async () => {
    const name = await dialog.prompt('Name for the package template (e.g. Skyline Embassy Type A Classic)');
    if (!name) return;
    await act(() => renoSend('/quotations/' + quotation.id + '/save-as-template', 'POST', { name, revNo: revision.revNo })).catch(() => undefined);
  };
  const brand = brands.data?.brands.find((b) => b.brandId === brandId);

  return (
    <div className="space-y-4 pb-24">
      <PageHeader
        back="/scm/renovation/quotations"
        eyebrow={`Quotation · ${quotation.projectName ?? (quotation.projectId ? `project #${quotation.projectId}` : "no project yet")}`}
        title={revision.docNo}
        description={`${header.customerName || 'No customer yet'}${header.building ? ` · ${header.building} ${header.unitNo}` : ''} · ${fmtDate(header.docDate)}`}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={quotation.status} />
            {revisions.length > 1 && (
              <select aria-label="Revision" className="h-9 rounded-md border border-border bg-surface px-2 text-[13px]" value={revision.revNo}
                onChange={(e) => setParams(Number(e.target.value) === quotation.currentRev ? {} : { rev: e.target.value })}>
                {revisions.map((r) => <option key={r.revNo} value={r.revNo}>{r.docNo}{r.frozenAt ? ' (frozen)' : ''}</option>)}
              </select>
            )}
            <Button variant="secondary" icon={<Printer size={15} />} onClick={() => setPrintOpen(true)}>Print</Button>
            {editable && <Button icon={<Save size={15} />} disabled={!dirty || run.isPending} onClick={save}>{run.isPending ? 'Saving…' : 'Save'}</Button>}
          </div>
        )}
      />
      <ErrorBanner error={error} onClose={() => setError(null)} />
      {quotation.convertedSoDocNo && (
        <div className="rounded-lg border border-synced/30 bg-synced-bg px-3 py-2 text-[13px] text-synced">
          Converted to sales order <Link className="font-semibold underline" to={`/scm/renovation/contracts/${encodeURIComponent(quotation.convertedSoDocNo)}`}>{quotation.convertedSoDocNo}</Link>. This quotation is locked.
        </div>
      )}
      {!editable && !quotation.convertedSoDocNo && revision.revNo === quotation.currentRev && quotation.status !== 'DRAFT' && (
        <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px] text-ink-secondary">This revision is {quotation.status.toLowerCase()}; start a new revision to change it.</div>
      )}
      {canQuote && !quotation.lockedAt && revision.revNo === quotation.currentRev && (
        <div className="flex flex-wrap gap-2">
          {quotation.status === 'DRAFT' && <Button variant="secondary" icon={<Send size={15} />} onClick={() => status('SENT')}>Mark sent</Button>}
          {quotation.status === 'SENT' && <Button variant="secondary" icon={<FileCheck2 size={15} />} onClick={() => status('ACCEPTED', `Mark ${revision.docNo} accepted by the customer?`)}>Accepted</Button>}
          {(quotation.status === 'DRAFT' || quotation.status === 'SENT') && <Button variant="ghost" onClick={() => status('REJECTED', 'Mark this quotation rejected?')}>Rejected</Button>}
          {quotation.status === 'ACCEPTED' && <Button variant="ghost" onClick={() => status('SENT')}>Undo accept</Button>}
          {quotation.status !== 'ACCEPTED' && quotation.status !== 'DRAFT' && <Button variant="secondary" onClick={newRevision}>New revision R{quotation.currentRev + 1}</Button>}
          {quotation.status === 'ACCEPTED' && <Button onClick={convert}>Convert to sales order</Button>}
          <Button variant="ghost" icon={<Copy size={15} />} onClick={saveAsTemplate}>Save as package template</Button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-4">
          {partyHere && (
            <Card title="Customer and property">
              <QuotationCustomerCard header={header} projectId={quotation.projectId} disabled={!editable}
                resetKey={`${revision.id}:${version}`}
                onChange={(p, problems) => { setHeader((h) => (h ? { ...h, ...p } : h)); setPartyProblems(problems); setDirty(true); }} />
            </Card>
          )}
          <Card title="Header">
            <HeaderForm header={header} disabled={!editable} brands={brands.data?.brands ?? []} brandId={brandId} partyElsewhere={partyHere}
              onBrand={(b) => { setBrandId(b); setDirty(true); }} onChange={(p) => { setHeader({ ...header, ...p }); setDirty(true); }} />
          </Card>
          <DocEditor sections={sections} disabled={!editable} roomLayout={roomLayout} onChange={(s) => { setSections(s); setDirty(true); }} />
          <Card title="Payment terms">
            <InstalmentEditor rows={instalments} disabled={!editable} terms={terms.data?.templates ?? []} totalSen={totals.finalSen}
              onChange={(r) => { setInstalments(r); setDirty(true); }} />
          </Card>
        </div>
        <div className="space-y-4 2xl:sticky 2xl:top-4 2xl:self-start">
          <TotalsCard sections={sections} docDiscountSen={header.docDiscountSen} />
        </div>
      </div>
      {editable && dirty && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 px-4 py-2.5 shadow-lg backdrop-blur md:left-auto md:right-6 md:bottom-6 md:rounded-xl md:border">
          <div className="flex items-center justify-between gap-3"><span className="text-[13px] text-ink-secondary">Unsaved changes</span><Button icon={<Save size={15} />} disabled={run.isPending} onClick={save}>{run.isPending ? 'Saving…' : 'Save'}</Button></div>
        </div>
      )}
      <PrintDialog open={printOpen} onClose={() => setPrintOpen(false)} title="quotation" docNo={revision.docNo} defaultFormat={header.printFormat}
        build={(format) => buildPrintDoc({ kind: 'QUOTATION', docNo: revision.docNo, format, brand, header, sections, instalments })} />
    </div>
  );
}
