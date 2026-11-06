/* What a saved quotation has that a sales order does not, around the sales order's page: its status steps, revisions,
   print, and the print details and payment terms under the lines (owner, 6 Nov 2026). */

import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Copy, FileCheck2, Printer, Save, Send } from 'lucide-react';
import { Button } from '../../components/Button';
import { DocAttachments } from '../../components/doc-attachments/DocAttachments';
import { useDialog } from '../../hooks/useDialog';
import { useToast } from '../../hooks/useToast';
import {
  contractPostingWarning, refusalOf, renoSend, useBrands, useRenoMutation, useTerms,
  type ContractPosting, type DocHeader, type DocSection, type Instalment, type QuotationView,
} from '../../lib/renovation/api';
import { buildPrintDoc } from '../../lib/renovation/print-doc';
import { serviceConfirm } from '../../vendor/scm/lib/dialog-service';
import { HeaderForm, InstalmentEditor, totalsOfSections, TotalsCard } from '../renovation/DocParts';
import { PrintDialog } from '../renovation/PrintDialog';
import { Card, ErrorBanner, StatusPill, todayIso } from '../renovation/shared';

export function QuotationActions({ view, canQuote, editable, sections, header, instalments, brandId, onSave, saving }: {
  view: QuotationView;
  canQuote: boolean;
  editable: boolean;
  sections: DocSection[];
  header: DocHeader;
  instalments: Instalment[];
  brandId: number | null;
  /** Saves the form and gives the new version, null when it could not save. */
  onSave: () => Promise<number | null>;
  saving: boolean;
}) {
  const { quotation, revision, revisions } = view;
  const navigate = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const brands = useBrands();
  const [, setParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const run = useRenoMutation(async (fn: () => Promise<unknown>) => fn());
  const busy = run.isPending || saving;
  const current = canQuote && !quotation.lockedAt && revision.revNo === quotation.currentRev;

  /* A step acts on what the screen shows, so the form saves first. */
  const savedVersion = async () => (editable ? onSave() : quotation.version);
  const act = async (fn: (version: number) => Promise<unknown>) => {
    setError(null);
    const version = await savedVersion();
    if (version === null) return null;
    try { return await run.mutateAsync(() => fn(version)); } catch (e) { setError(refusalOf(e).message); return null; }
  };
  const status = async (to: string, confirm?: string) => {
    if (confirm && !(await serviceConfirm({ title: confirm }))) return;
    /* Sending freezes the lines, and convert refuses a priced line with no product: say so while it can still be fixed. */
    const noProduct = to === 'SENT' && quotation.status === 'DRAFT' ? sections.flatMap((s) => s.lines).filter((l) => l.kind === 'ITEM' && !l.itemCode).length : 0;
    if (noProduct) { setError(`${noProduct} priced line${noProduct === 1 ? ' has' : 's have'} no product picked. Pick one first (RN- for generic works).`); return; }
    await act((version) => renoSend(`/quotations/${quotation.id}/status`, 'POST', { status: to, version }));
  };
  const newRevision = async () => {
    if (!(await serviceConfirm({ title: `Start revision R${quotation.currentRev + 1}?`, body: `${revision.docNo} is frozen as sent; the new revision is a copy you can edit.` }))) return;
    await act((version) => renoSend(`/quotations/${quotation.id}/revisions`, 'POST', { version }));
    setParams({}, { replace: true });
  };
  const convert = async () => {
    if (!(await serviceConfirm({ title: 'Convert to the sales order?', body: `Every line of ${revision.docNo} becomes the contract of this project, and the quotation locks.`, confirmLabel: 'Convert' }))) return;
    const r = await act((version) => renoSend<{ docNo: string; posting?: ContractPosting }>(`/quotations/${quotation.id}/convert`, 'POST', { version, soDate: todayIso() })) as { docNo: string; posting?: ContractPosting } | null;
    if (!r) return;
    const warning = contractPostingWarning(r.posting);
    if (warning) toast.warning(warning);
    navigate(`/scm/renovation/contracts/${encodeURIComponent(r.docNo)}`);
  };
  const saveAsTemplate = async () => {
    const name = await dialog.prompt('Name for the package template (e.g. Skyline Embassy Type A Classic)');
    if (name) await act(() => renoSend(`/quotations/${quotation.id}/save-as-template`, 'POST', { name, revNo: revision.revNo }));
  };
  const brand = brands.data?.brands.find((b) => b.brandId === brandId);

  return (
    <>
      <StatusPill status={quotation.status} />
      {revisions.length > 1 && (
        <select aria-label="Revision" className="h-9 rounded-md border border-border bg-surface px-2 text-[13px]" value={revision.revNo}
          onChange={(e) => setParams(Number(e.target.value) === quotation.currentRev ? {} : { rev: e.target.value })}>
          {revisions.map((r) => <option key={r.revNo} value={r.revNo}>{r.docNo}{r.frozenAt ? ' (frozen)' : ''}</option>)}
        </select>
      )}
      <Button variant="secondary" icon={<Printer size={15} />} onClick={() => setPrintOpen(true)}>Print PDF</Button>
      {current && <Button variant="ghost" icon={<Copy size={15} />} onClick={saveAsTemplate}>Save as package template</Button>}
      {current && quotation.status === 'DRAFT' && <Button variant="secondary" icon={<Send size={15} />} disabled={busy} onClick={() => status('SENT')}>Mark sent</Button>}
      {current && quotation.status === 'SENT' && <Button variant="secondary" icon={<FileCheck2 size={15} />} disabled={busy} onClick={() => status('ACCEPTED', `Mark ${revision.docNo} accepted by the customer?`)}>Accepted</Button>}
      {current && (quotation.status === 'DRAFT' || quotation.status === 'SENT') && <Button variant="ghost" disabled={busy} onClick={() => status('REJECTED', 'Mark this quotation rejected?')}>Rejected</Button>}
      {current && quotation.status === 'ACCEPTED' && <Button variant="ghost" disabled={busy} onClick={() => status('SENT')}>Undo accept</Button>}
      {current && quotation.status !== 'ACCEPTED' && quotation.status !== 'DRAFT' && <Button variant="secondary" disabled={busy} onClick={newRevision}>New revision R{quotation.currentRev + 1}</Button>}
      {current && quotation.status === 'ACCEPTED' && <Button disabled={busy} onClick={convert}>Convert to sales order</Button>}
      {editable && <Button icon={<Save size={15} />} disabled={busy} onClick={() => { void onSave(); }}>{saving ? 'Saving…' : 'Save'}</Button>}
      {error && <div className="basis-full"><ErrorBanner error={error} onClose={() => setError(null)} /></div>}
      <PrintDialog open={printOpen} onClose={() => setPrintOpen(false)} title="quotation" docNo={revision.docNo} brandName={brand?.name} defaultFormat={header.printFormat}
        build={(format) => buildPrintDoc({ kind: 'QUOTATION', docNo: revision.docNo, format, brand, header, sections, instalments })} />
    </>
  );
}

export function QuotationNotices({ view, editable }: { view: QuotationView; editable: boolean }) {
  const { quotation, revision } = view;
  if (quotation.convertedSoDocNo) {
    return (
      <div className="rounded-lg border border-synced/30 bg-synced-bg px-3 py-2 text-[13px] text-synced">
        Converted to sales order <Link className="font-semibold underline" to={`/scm/renovation/contracts/${encodeURIComponent(quotation.convertedSoDocNo)}`}>{quotation.convertedSoDocNo}</Link>. This quotation is locked.
      </div>
    );
  }
  if (editable || revision.revNo !== quotation.currentRev || quotation.status === 'DRAFT') return null;
  return <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px] text-ink-secondary">This revision is {quotation.status.toLowerCase()}; start a new revision to change it.</div>;
}

/** Under the lines: print details, payment terms, files and the totals as the quotation prints them. */
export function QuotationCards({ view, canQuote, editable, sections, header, onHeader, instalments, onInstalments, brandId }: {
  view: QuotationView;
  canQuote: boolean;
  editable: boolean;
  sections: DocSection[];
  header: DocHeader;
  onHeader: (patch: Partial<DocHeader>) => void;
  instalments: Instalment[];
  onInstalments: (rows: Instalment[]) => void;
  brandId: number | null;
}) {
  const terms = useTerms();
  const totals = totalsOfSections(sections, header.docDiscountSen);
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_300px]">
      <div className="min-w-0 space-y-3">
        <Card title="Quotation details">
          <HeaderForm header={header} disabled={!editable} brands={[]} brandId={brandId} partyElsewhere onChange={onHeader} />
        </Card>
        <Card title="Payment terms">
          <InstalmentEditor rows={instalments} disabled={!editable} terms={(terms.data?.templates ?? []).filter((t) => t.brandId == null || t.brandId === brandId)}
            totalSen={totals.finalSen} onChange={onInstalments} />
        </Card>
        <DocAttachments docType="quotation" docId={view.quotation.id} canEdit={canQuote} />
      </div>
      <div><TotalsCard sections={sections} docDiscountSen={header.docDiscountSen} /></div>
    </div>
  );
}
