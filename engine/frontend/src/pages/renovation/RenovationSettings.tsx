// Payment-term templates (customer instalments and PO payment schedules) and
// the brand letterheads printed on renovation documents.

import { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/Layout';
import { Button } from '../../components/Button';
import { useAuth } from '../../auth/AuthContext';
import { RENO_STAGES, STAGE_LABEL } from '../../vendor/shared/renovation-stages';
import { refusalOf, renoSend, useBrands, useRenoMutation, useTerms, type BrandProfile, type TermTemplate } from '../../lib/renovation/api';
import { Card, ErrorBanner, Field, inputCls, PercentInput, pctLabel } from './shared';
import { cn } from '../../lib/utils';

type TermLine = TermTemplate['lines'][number];
const PAYABLE: Array<{ value: string; label: string }> = [
  { value: 'ON_CONFIRM', label: 'when the PO is confirmed' }, { value: 'ON_RECEIPT', label: 'when fully received' },
  { value: 'ON_HANDOVER', label: 'after handover' }, { value: 'MANUAL', label: 'when released by hand' },
];

function TermEditor({ tpl, onDone, canEdit }: { tpl: TermTemplate; onDone: () => void; canEdit: boolean }) {
  const [name, setName] = useState(tpl.name);
  const [isDefault, setIsDefault] = useState(tpl.isDefault);
  const [lines, setLines] = useState<TermLine[]>(tpl.lines);
  const [error, setError] = useState<string | null>(null);
  const save = useRenoMutation(() => renoSend(tpl.id ? `/terms/${tpl.id}` : '/terms', tpl.id ? 'PUT' : 'POST', { kind: tpl.kind, name, isDefault, active: true, lines }));
  const sum = lines.reduce((s, l) => s + l.pctBp, 0);
  const set = (i: number, p: Partial<TermLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Name" className="min-w-[220px] flex-1"><input className={inputCls} disabled={!canEdit} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <label className="flex items-center gap-1.5 pb-2 text-[12.5px]"><input type="checkbox" disabled={!canEdit} checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /> Default</label>
      </div>
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-[120px_80px_1fr_190px_190px_32px]">
          <input aria-label="Label" className={inputCls} disabled={!canEdit} value={l.label} onChange={(e) => set(i, { label: e.target.value })} />
          <PercentInput ariaLabel="Percent" value={l.pctBp} disabled={!canEdit} onChange={(bp) => set(i, { pctBp: bp })} />
          <input aria-label="Description" className={cn(inputCls, 'col-span-2 md:col-span-1')} disabled={!canEdit} value={l.description} onChange={(e) => set(i, { description: e.target.value })} />
          {tpl.kind === 'CUSTOMER' ? (
            <>
              <select aria-label="Stage" className={inputCls} disabled={!canEdit} value={l.stageCode ?? ''} onChange={(e) => set(i, { stageCode: e.target.value || null })}>
                <option value="">No stage</option>{RENO_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
              </select>
              <select aria-label="Trigger" className={inputCls} disabled={!canEdit} value={l.trigger} onChange={(e) => set(i, { trigger: e.target.value })}>
                <option value="so_confirmed">when the SO is confirmed</option><option value="stage_start">when the stage starts</option><option value="stage_done">when the stage is done</option>
              </select>
            </>
          ) : (
            <select aria-label="Payable on" className={cn(inputCls, 'md:col-span-2')} disabled={!canEdit} value={l.payableOn ?? 'MANUAL'} onChange={(e) => set(i, { payableOn: e.target.value })}>
              {PAYABLE.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          )}
          {canEdit && <button type="button" aria-label="Remove" onClick={() => setLines(lines.filter((_, j) => j !== i).map((x, j) => ({ ...x, seq: j + 1 })))} className="rounded p-1.5 text-ink-muted hover:text-err"><Trash2 size={15} /></button>}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        {canEdit && <button type="button" onClick={() => setLines([...lines, { seq: lines.length + 1, label: '', pctBp: Math.max(0, 10000 - sum), description: '', stageCode: null, trigger: 'stage_start', payableOn: tpl.kind === 'PO' ? 'MANUAL' : null }])} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary"><Plus size={14} /> Add line</button>}
        <span className={cn('text-[12.5px] font-semibold', sum === 10000 ? 'text-synced' : 'text-err')}>Total {pctLabel(sum)}</span>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onDone}>Close</Button>
          {canEdit && <Button icon={<Save size={15} />} disabled={save.isPending} onClick={async () => { setError(null); try { await save.mutateAsync(undefined); onDone(); } catch (e) { setError(refusalOf(e).message); } }}>{save.isPending ? 'Saving…' : 'Save'}</Button>}
        </div>
      </div>
      <ErrorBanner error={error} />
    </div>
  );
}

function BrandEditor({ brand, canEdit }: { brand: BrandProfile; canEdit: boolean }) {
  const [b, setB] = useState(brand);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => setB(brand), [brand]);
  const save = useRenoMutation(() => renoSend(`/brands/${brand.brandId}`, 'PUT', {
    companyLines: b.companyLines.filter(Boolean), contactLine: b.contactLine, bankLine: b.bankLine, termsLines: b.termsLines.filter(Boolean), intro: b.intro, signatoryCompany: b.signatoryCompany,
  }));
  return (
    <Card title={<span className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-full" style={{ background: brand.color }} />{brand.name}</span>}
      actions={canEdit ? <Button icon={<Save size={15} />} disabled={save.isPending} onClick={async () => { setError(null); setSaved(false); try { await save.mutateAsync(undefined); setSaved(true); } catch (e) { setError(refusalOf(e).message); } }}>{save.isPending ? 'Saving…' : 'Save'}</Button> : null}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Company block (one line each)" hint="Printed under the logo"><textarea rows={4} className={cn(inputCls, 'h-auto py-1.5')} disabled={!canEdit} value={b.companyLines.join('\n')} onChange={(e) => setB({ ...b, companyLines: e.target.value.split('\n') })} /></Field>
        <Field label="Terms (one line each)" hint="Printed at the foot of every page"><textarea rows={4} className={cn(inputCls, 'h-auto py-1.5')} disabled={!canEdit} value={b.termsLines.join('\n')} onChange={(e) => setB({ ...b, termsLines: e.target.value.split('\n') })} /></Field>
        <Field label="Phone / email line"><input className={inputCls} disabled={!canEdit} value={b.contactLine} onChange={(e) => setB({ ...b, contactLine: e.target.value })} /></Field>
        <Field label="Bank line"><input className={inputCls} disabled={!canEdit} value={b.bankLine} onChange={(e) => setB({ ...b, bankLine: e.target.value })} /></Field>
        <Field label="Intro sentence"><input className={inputCls} disabled={!canEdit} value={b.intro} onChange={(e) => setB({ ...b, intro: e.target.value })} /></Field>
        <Field label="Signing company"><input className={inputCls} disabled={!canEdit} value={b.signatoryCompany} onChange={(e) => setB({ ...b, signatoryCompany: e.target.value })} /></Field>
      </div>
      <p className="mt-2 text-[12px] text-ink-muted">{brand.logoR2Key ? 'Logo: uploaded in Project Maintenance > Brands.' : 'No logo yet: upload it in Project Maintenance > Brands; until then the brand name prints as text.'}</p>
      {saved && <p className="mt-1 text-[12.5px] font-semibold text-synced">Saved.</p>}
      <ErrorBanner error={error} />
    </Card>
  );
}

export function RenovationSettings() {
  const terms = useTerms();
  const brands = useBrands();
  const { can } = useAuth();
  const canEdit = can('scm.renovation.terms');
  const [editing, setEditing] = useState<TermTemplate | null>(null);
  const list = terms.data?.templates ?? [];
  const blank = (kind: 'CUSTOMER' | 'PO'): TermTemplate => ({ id: '', kind, name: '', isDefault: false, active: true, lines: [{ seq: 1, label: kind === 'PO' ? 'Mobilise' : '1ST PAYMENT', pctBp: 10000, description: '', stageCode: null, trigger: 'stage_start', payableOn: kind === 'PO' ? 'ON_CONFIRM' : null }] });
  return (
    <div className="space-y-4">
      <PageHeader back="/scm/renovation/quotations" eyebrow="Renovation" title="Payment terms & letterheads" description="Instalment templates for contracts and POs, and what each brand prints on its documents." />
      {(['CUSTOMER', 'PO'] as const).map((kind) => (
        <Card key={kind} title={kind === 'CUSTOMER' ? 'Customer payment terms' : 'PO payment schedules'} actions={canEdit ? <Button variant="secondary" icon={<Plus size={15} />} onClick={() => setEditing(blank(kind))}>New template</Button> : null}>
          <div className="space-y-2">
            {editing && editing.kind === kind && !editing.id && <TermEditor tpl={editing} canEdit={canEdit} onDone={() => setEditing(null)} />}
            {list.filter((t) => t.kind === kind).map((t) => (editing?.id === t.id
              ? <TermEditor key={t.id} tpl={t} canEdit={canEdit} onDone={() => setEditing(null)} />
              : (
                <button key={t.id} type="button" onClick={() => setEditing(t)} className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-left hover:border-primary">
                  <span className="font-semibold text-ink">{t.name}{t.isDefault && <span className="ml-2 rounded bg-primary-soft px-1.5 py-0.5 text-[11px] text-primary-ink">default</span>}</span>
                  <span className="text-[12.5px] text-ink-secondary">{t.lines.map((l) => `${l.label} ${pctLabel(l.pctBp)}`).join(' · ')}</span>
                </button>
              )))}
          </div>
        </Card>
      ))}
      <h2 className="pt-2 text-[14px] font-semibold text-ink">Letterheads</h2>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {(brands.data?.brands ?? []).filter((b) => b.active).map((b) => <BrandEditor key={b.brandId} brand={b} canEdit={canEdit} />)}
      </div>
    </div>
  );
}
