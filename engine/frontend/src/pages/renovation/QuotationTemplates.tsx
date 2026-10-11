// Package templates (e.g. "Skyline Embassy Type A Classic"): a ready set of
// sections, lines and payment terms that a new quotation is cloned from.

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, Save } from 'lucide-react';
import { PageHeader } from '../../components/Layout';
import { Button } from '../../components/Button';
import { useAuth } from '../../auth/AuthContext';
import { useDialog } from '../../hooks/useDialog';
import {
  instalmentsForSave, refusalOf, renoSend, sectionsForSave, useBrands, useRenoMutation, useTemplate, useTemplates, useTerms,
  type DocSection, type Instalment,
} from '../../lib/renovation/api';
import { PRINT_FORMAT_LIST, PRINT_FORMATS, type PrintFormat } from '../../lib/renovation/print-formats';
import { DocEditor } from './DocEditor';
import { InstalmentEditor, totalsOfSections, TotalsCard } from './DocParts';
import { Card, ErrorBanner, Field, fmtDate, inputCls, MoneyInput } from './shared';

export function QuotationTemplates() {
  const list = useTemplates();
  const navigate = useNavigate();
  const { can } = useAuth();
  const dialog = useDialog();
  const [error, setError] = useState<string | null>(null);
  const create = useRenoMutation((name: string) => renoSend<{ id: string }>('/templates', 'POST', { name }));
  const rows = list.data?.templates ?? [];
  return (
    <div className="space-y-4">
      <PageHeader back="/scm/renovation/quotations" eyebrow="Renovation" title="Package templates" description="Ready-made quotations a new quotation can start from."
        actions={can('scm.renovation.quote') ? <Button icon={<Plus size={15} />} onClick={async () => {
          const name = await dialog.prompt('Template name (e.g. Skyline Embassy Type A Classic)');
          if (!name) return;
          setError(null);
          try { const r = await create.mutateAsync(name); navigate(`/scm/renovation/templates/${r.id}`); } catch (e) { setError(refusalOf(e).message); }
        }}>New template</Button> : undefined} />
      <ErrorBanner error={error} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((t) => (
          <Link key={t.id} to={`/scm/renovation/templates/${t.id}`} className="rounded-xl border border-border bg-surface p-4 hover:border-primary">
            <div className="font-semibold text-ink">{t.name}</div>
            <div className="mt-1 text-[12.5px] text-ink-secondary">{t.description || PRINT_FORMATS[t.printFormat].label}</div>
            <div className="mt-2 text-[11.5px] text-ink-muted">Updated {fmtDate(t.updatedAt)}</div>
          </Link>
        ))}
        {!list.isLoading && rows.length === 0 && <div className="rounded-xl border border-dashed border-border p-6 text-center text-[13px] text-ink-muted md:col-span-2 xl:col-span-3">No package templates yet. Save a quotation as a template, or start one here.</div>}
      </div>
    </div>
  );
}

export function QuotationTemplateEditor() {
  const { id } = useParams();
  const t = useTemplate(id);
  const brands = useBrands();
  const terms = useTerms();
  const { can } = useAuth();
  const canEdit = can('scm.renovation.quote');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [brandId, setBrandId] = useState<number | null>(null);
  const [printFormat, setPrintFormat] = useState<PrintFormat>('AMOUNT');
  const [docDiscountSen, setDocDiscountSen] = useState(0);
  const [docDiscountLabel, setDocDiscountLabel] = useState('');
  const [sections, setSections] = useState<DocSection[]>([]);
  const [instalments, setInstalments] = useState<Instalment[]>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!t.data) return;
    setName(t.data.name); setDescription(t.data.description); setBrandId(t.data.brandId); setPrintFormat(t.data.printFormat);
    setDocDiscountSen(t.data.docDiscountSen); setDocDiscountLabel(t.data.docDiscountLabel); setSections(t.data.sections); setInstalments(t.data.instalments);
    setDirty(false);
  }, [t.data]);
  const save = useRenoMutation(() => renoSend(`/templates/${id}`, 'PUT', {
    name, description, brandId, printFormat, docDiscountSen, docDiscountLabel, sections: sectionsForSave(sections), instalments: instalmentsForSave(instalments),
  }));
  if (t.isLoading || !t.data) return <div className="p-8 text-center text-[13px] text-ink-muted">{t.error ? refusalOf(t.error).message : 'Loading template…'}</div>;
  const mark = () => setDirty(true);
  const totals = totalsOfSections(sections, docDiscountSen);
  return (
    <div className="space-y-4">
      <PageHeader back="/scm/renovation/templates" eyebrow="Package template" title={name || 'Template'}
        actions={canEdit ? <Button icon={<Save size={15} />} disabled={!dirty || save.isPending} onClick={async () => { setError(null); try { await save.mutateAsync(undefined); setDirty(false); } catch (e) { setError(refusalOf(e).message); } }}>{save.isPending ? 'Saving…' : 'Save'}</Button> : undefined} />
      <ErrorBanner error={error} onClose={() => setError(null)} />
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-4">
          <Card title="Template">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Name"><input className={inputCls} disabled={!canEdit} value={name} onChange={(e) => { setName(e.target.value); mark(); }} /></Field>
              <Field label="Letterhead"><select className={inputCls} disabled={!canEdit} value={brandId ?? ''} onChange={(e) => { setBrandId(e.target.value ? Number(e.target.value) : null); mark(); }}><option value="">— none —</option>{(brands.data?.brands ?? []).map((b) => <option key={b.brandId} value={b.brandId}>{b.name}</option>)}</select></Field>
              <Field label="Print format"><select className={inputCls} disabled={!canEdit} value={printFormat} onChange={(e) => { setPrintFormat(e.target.value as PrintFormat); mark(); }}>{PRINT_FORMAT_LIST.map((f) => <option key={f} value={f}>{PRINT_FORMATS[f].label}</option>)}</select></Field>
              <Field label="Description" className="sm:col-span-2 lg:col-span-3"><input className={inputCls} disabled={!canEdit} value={description} onChange={(e) => { setDescription(e.target.value); mark(); }} /></Field>
              <Field label="Document discount"><MoneyInput value={docDiscountSen} disabled={!canEdit} onChange={(v) => { setDocDiscountSen(v ?? 0); mark(); }} /></Field>
              <Field label="Discount label"><input className={inputCls} disabled={!canEdit} value={docDiscountLabel} onChange={(e) => { setDocDiscountLabel(e.target.value); mark(); }} /></Field>
            </div>
          </Card>
          <DocEditor sections={sections} disabled={!canEdit} onChange={(s) => { setSections(s); mark(); }} />
          <Card title="Payment terms"><InstalmentEditor rows={instalments} disabled={!canEdit} terms={terms.data?.templates ?? []} totalSen={totals.finalSen} onChange={(r) => { setInstalments(r); mark(); }} /></Card>
        </div>
        <div className="2xl:sticky 2xl:top-4 2xl:self-start"><TotalsCard sections={sections} docDiscountSen={docDiscountSen} /></div>
      </div>
    </div>
  );
}
