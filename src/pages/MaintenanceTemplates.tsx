import { useMemo, useState } from 'react';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { DataTable, type Column } from '../components/DataTable';
import { Select } from '../components/Select';
import { MoneyInput, NumberInput } from '../components/inputs';
import { useToast } from '../components/Toast';
import { HistoryDisclosure } from '../components/RecordHistory';
import { api, ApiFailure, errorMessage } from '../lib/api';
import { cx } from '../lib/design-tokens';
import { plural } from '../lib/format';
import { OpsModal, FormRow, INPUT, TEXTAREA, CATEGORY } from '../components/ops/OpsUi';
import { AssigneeFields, assigneeOf, useTechnicians, useTemplates, type Assignee, type RepairTemplate } from '../components/ops/RepairTemplates';
import type { Sku } from './MaintenanceCatalog';

const WHO = (t: RepairTemplate) => t.assigneeKind === 'in_house' ? (t.technicianName ? `${t.technicianName} (in-house)` : 'In-house technician')
  : t.assigneeKind === 'contractor' ? (t.contractorName ? `${t.contractorName} (contractor)` : 'Contractor') : 'Not set';

/** Maintenance > Templates: the repairs staff report again and again, each with what a new job starts with.
 *  Management and operations managers change them; everyone else who opens Maintenance reads them. */
export function TemplatesPanel({ money, skus }: { money: boolean; skus: Sku[] }) {
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const { data, loading, error, reload } = useTemplates(true);
  const [open, setOpen] = useState<RepairTemplate | 'new' | null>(null);
  const canEdit = !!data?.canEdit;
  const all = data?.data ?? [];
  const rows = data ? all.filter(t => showArchived || !t.archived) : null;
  const live = all.filter(t => !t.archived).length;

  const columns = useMemo<Column<RepairTemplate>[]>(() => [
    { key: 'name', label: 'Template', value: t => t.name, hideable: false, width: 220, sub: t => t.instructions,
      render: t => <span className="font-semibold text-ink">{t.name}</span> },
    { key: 'category', label: 'Category', value: t => t.category, text: t => CATEGORY[t.category] ?? t.category, width: 110 },
    { key: 'urgency', label: 'Urgency', type: 'status', value: t => t.urgency, status: t => (t.urgency === 'urgent' ? { label: 'Urgent', tone: 'critical' } : { label: 'Normal', tone: 'neutral' }), width: 110 },
    { key: 'who', label: 'Usually done by', value: t => WHO(t), width: 180 },
    { key: 'steps', label: 'Checklist', type: 'number', value: t => t.steps.length, text: t => plural(t.steps.length, 'step'), width: 100,
      render: t => <span className="whitespace-nowrap">{plural(t.steps.length, 'step')}</span> },
    { key: 'parts', label: 'Items', value: t => t.parts.map(p => `${p.qty} x ${p.name}`).join(', ') || null, width: 200, hidden: true,
      render: t => (t.parts.length ? <span className="block truncate">{t.parts.map(p => `${p.qty} x ${p.name}`).join(', ')}</span> : <span className="text-faint">None</span>) },
    ...(money ? [{ key: 'cost', label: 'Estimated cost', type: 'money' as const, value: (t: RepairTemplate) => t.estimatedCost, width: 130 }] : []),
    { key: 'block', label: 'Blocks unit', value: t => (t.blocksUnit ? 'Yes' : 'No'), width: 110, hidden: true },
    { key: 'used', label: 'Jobs opened', type: 'number', value: t => t.usedCount, width: 110 },
    { key: 'status', label: 'Status', type: 'status', value: t => (t.archived ? 'archived' : 'live'), status: t => (t.archived ? { label: 'Archived', tone: 'warning' } : { label: 'In use', tone: 'success' }), width: 110 },
  ], [money]);

  return (
    <div className="flex flex-col gap-3">
      <DataTable<RepairTemplate>
        id="maintenance.templates" urlPrefix="tpl." columns={columns} rows={rows} rowKey={t => t.id} loading={loading} error={data ? null : error} onRetry={reload}
        pageSize={0} noun={['template', 'templates']} exportName="maintenance-templates"
        rowTone={t => (t.archived ? 'muted' : null)} onRowClick={t => setOpen(t)}
        filtered={!showArchived && all.length > live} onClearFilters={() => setShowArchived(true)}
        toolbar={<span className="text-copy text-muted-ink">{plural(live, 'template')} · picking one on a new job fills its fields, checklist and items.</span>}
        actions={<>
          <label className="flex items-center gap-1.5 text-meta text-muted-ink cursor-pointer">
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
            Show archived
          </label>
          {canEdit && <Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setOpen('new')}>New template</Button>}
        </>}
        empty={{ title: 'No templates yet', icon: 'ClipboardList',
          body: canEdit ? 'Add the repairs staff report again and again, so a new job starts filled in.' : 'Management and operations managers add templates.',
          action: canEdit ? { label: 'New template', onClick: () => setOpen('new') } : undefined }}
      />
      {open && (
        <TemplateModal template={open === 'new' ? null : open} canEdit={canEdit} money={money} skus={skus} onClose={() => setOpen(null)}
          onSaved={msg => { toast({ tone: 'success', title: msg }); reload(); setOpen(null); }} />
      )}
    </div>
  );
}

interface Draft {
  name: string; category: string; urgency: 'normal' | 'urgent'; assignee: Assignee; estimatedCost: number | null; blocksUnit: boolean;
  instructions: string; steps: string[]; parts: { skuId: string; qty: number | null }[];
}
const draftOf = (t: RepairTemplate | null): Draft => t ? {
  name: t.name, category: t.category, urgency: t.urgency, assignee: assigneeOf(t), estimatedCost: t.estimatedCost, blocksUnit: t.blocksUnit,
  instructions: t.instructions ?? '', steps: t.steps.map(s => s.label), parts: t.parts.map(p => ({ skuId: p.skuId, qty: p.qty })),
} : { name: '', category: 'other', urgency: 'normal', assignee: { kind: '', technicianId: '', contractor: '' }, estimatedCost: null, blocksUnit: false, instructions: '', steps: [], parts: [] };

function TemplateModal({ template: t, canEdit, money, skus, onClose, onSaved }: {
  template: RepairTemplate | null; canEdit: boolean; money: boolean; skus: Sku[]; onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const techs = useTechnicians(canEdit);
  const [d, setD] = useState<Draft>(() => draftOf(t));
  const [step, setStep] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const readOnly = !canEdit || !!t?.archived;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setD(x => ({ ...x, [k]: v })); setErrors(e => ({ ...e, [k]: '', form: '' })); };

  function addStep() {
    const label = step.trim();
    if (!label) return;
    if (d.steps.some(s => s.toLowerCase() === label.toLowerCase())) { setErrors(e => ({ ...e, steps: 'That step is already on the list.' })); return; }
    set('steps', [...d.steps, label]); setStep('');
  }
  const move = (i: number, by: number) => { const s = [...d.steps]; const [x] = s.splice(i, 1); s.splice(i + by, 0, x); set('steps', s); };

  async function run(key: string, fn: () => Promise<unknown>, message: string) {
    setBusy(key);
    try { await fn(); onSaved(message); }
    catch (e) {
      const fields = e instanceof ApiFailure ? e.fields ?? {} : {};
      setErrors({ ...fields, form: Object.keys(fields).length ? '' : errorMessage(e, 'Not saved. Try again.') });
    } finally { setBusy(null); }
  }
  function save() {
    const e: Record<string, string> = {};
    if (!d.name.trim()) e.name = 'Name the template.';
    if (d.parts.some(p => !p.skuId)) e.parts = 'Pick a part on every line, or remove the line.';
    else if (d.parts.some(p => p.qty == null || p.qty < 1)) e.parts = 'Enter a quantity of 1 or more on every part.';
    if (Object.keys(e).length) { setErrors(e); return; }
    const body = {
      name: d.name.trim(), category: d.category, urgency: d.urgency,
      assigneeKind: d.assignee.kind || null, technicianId: d.assignee.kind === 'in_house' ? d.assignee.technicianId || null : null,
      contractorName: d.assignee.kind === 'contractor' ? d.assignee.contractor.trim() || null : null,
      ...(money || !t ? { estimatedCost: d.estimatedCost } : { estimatedCost: t.estimatedCost }),
      blocksUnit: d.blocksUnit, instructions: d.instructions.trim() || null, steps: d.steps, parts: d.parts.map(p => ({ skuId: p.skuId, qty: p.qty })),
    };
    void run('save', () => (t ? api.patch(`/maintenance/templates/${t.id}`, body) : api.post('/maintenance/templates', body)), t ? 'Template saved.' : 'Template added.');
  }

  const skuOptions = skus.filter(s => s.active || d.parts.some(p => p.skuId === s.id)).map(s => ({ value: s.id, label: `${s.code} · ${s.name}` }));
  const footer = (
    <div className="flex gap-2 flex-wrap w-full">
      {t && canEdit && !t.archived && <Button size="sm" variant="secondary" loading={busy === 'dup'}
        onClick={() => void run('dup', () => api.post(`/maintenance/templates/${t.id}/duplicate`, {}), 'Template copied. Open the copy to rename and change it.')}>Duplicate</Button>}
      {t && canEdit && (t.usedCount === 0 && !t.archived
        ? <Button size="sm" variant="secondary" loading={busy === 'del'} onClick={() => void run('del', () => api.del(`/maintenance/templates/${t.id}`), 'Template deleted.')}>Delete</Button>
        : <Button size="sm" variant="secondary" loading={busy === 'arch'} onClick={() => void run('arch', () => api.patch(`/maintenance/templates/${t.id}`, { archived: !t.archived }), t.archived ? 'Template restored.' : 'Template archived. Jobs opened from it keep it.')}>{t.archived ? 'Restore' : 'Archive'}</Button>)}
      <span className="flex-1" />
      <Button size="sm" variant="secondary" onClick={onClose} disabled={!!busy}>{readOnly ? 'Close' : 'Cancel'}</Button>
      {!readOnly && <Button size="sm" variant="primary" loading={busy === 'save'} onClick={save}>{t ? 'Save' : 'Add template'}</Button>}
    </div>
  );

  return (
    <OpsModal title={t ? t.name : 'New template'} width={640} onClose={onClose} busy={!!busy} footer={footer}
      sub={t ? `${t.archived ? 'Archived. ' : ''}${t.usedCount ? `${plural(t.usedCount, 'job')} opened from it.` : 'No job opened from it yet.'}${!canEdit ? ' Management and operations managers can change it.' : ''}` : 'What a new job starts with. Everything stays editable on the job.'}>
      <fieldset disabled={readOnly} className="contents">
        <FormRow label="Name" error={errors.name}><input className={INPUT} value={d.name} onChange={e => set('name', e.target.value)} maxLength={80} placeholder="e.g. Aircon not cold" /></FormRow>
        <div className="grid grid-cols-2 gap-3">
          <FormRow label="Category" error={errors.category}><select className={INPUT} value={d.category} onChange={e => set('category', e.target.value)}>{Object.entries(CATEGORY).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></FormRow>
          <FormRow label="Urgency"><select className={INPUT} value={d.urgency} onChange={e => set('urgency', e.target.value as 'normal' | 'urgent')}><option value="normal">Normal</option><option value="urgent">Urgent</option></select></FormRow>
        </div>
        {readOnly ? <FormRow label="Usually done by"><span className="text-copy text-ink">{t ? WHO(t) : ''}</span></FormRow>
          : <AssigneeFields label="Usually done by" value={d.assignee} onChange={v => set('assignee', v)} technicians={techs.data} error={errors.technicianId || errors.assignee} />}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
          {money && <FormRow label="Estimated cost, RM (optional)" error={errors.estimatedCost} hint="Fills the quote on a new job.">
            <MoneyInput className={INPUT} valueSen={d.estimatedCost} onChangeSen={v => set('estimatedCost', v)} maxSen={100_000_000} aria-label="Estimated cost in RM" /></FormRow>}
          <label className={cx('flex items-center gap-2 text-copy min-h-10', money && 'sm:mt-6')}>
            <input type="checkbox" className="w-4 h-4 accent-black" checked={d.blocksUnit} onChange={e => set('blocksUnit', e.target.checked)} />
            Block the unit until fixed
          </label>
        </div>
        <FormRow label="Instruction note (optional)" error={errors.instructions} hint="Shown to the technician on the job.">
          <textarea className={TEXTAREA} value={d.instructions} onChange={e => set('instructions', e.target.value)} maxLength={1000} placeholder="e.g. Turn off the water under the sink first." />
        </FormRow>

        <section className="flex flex-col gap-1.5">
          <span className="text-meta font-medium text-muted-ink">Checklist {d.steps.length > 0 && `(${plural(d.steps.length, 'step')})`}</span>
          {d.steps.length === 0 && <span className="text-copy text-muted-ink">No steps yet.</span>}
          <ol className="m-0 p-0 list-none flex flex-col gap-1">
            {d.steps.map((s, i) => (
              <li key={`${i}-${s}`} className="flex items-center gap-2 min-h-9 rounded-control bg-muted px-2.5">
                <span className="text-meta text-muted-ink w-5 tabular-nums">{i + 1}.</span>
                <span className="flex-1 min-w-0 text-copy">{s}</span>
                {!readOnly && <>
                  <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="w-8 h-8 grid place-items-center text-muted-ink cursor-pointer disabled:opacity-30 disabled:cursor-default"><Icon name="ChevronUp" size="sm" /></button>
                  <button type="button" aria-label="Move down" disabled={i === d.steps.length - 1} onClick={() => move(i, 1)} className="w-8 h-8 grid place-items-center text-muted-ink cursor-pointer disabled:opacity-30 disabled:cursor-default"><Icon name="ChevronDown" size="sm" /></button>
                  <button type="button" aria-label="Remove step" onClick={() => set('steps', d.steps.filter((_, n) => n !== i))} className="w-8 h-8 grid place-items-center text-muted-ink hover:text-danger cursor-pointer"><Icon name="X" size="sm" /></button>
                </>}
              </li>
            ))}
          </ol>
          {!readOnly && (
            <div className="flex gap-2">
              <input className={cx(INPUT, 'h-9')} value={step} onChange={e => setStep(e.target.value)} maxLength={160} placeholder="Add a step, e.g. Photo after"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addStep(); } }} aria-label="New step" />
              <Button size="sm" variant="secondary" type="button" onClick={addStep} disabled={!step.trim()} disabledReason="Write the step first.">Add</Button>
            </div>
          )}
          {errors.steps && <span className="text-meta text-danger">{errors.steps}</span>}
        </section>

        <section className="flex flex-col gap-1.5">
          <span className="text-meta font-medium text-muted-ink">Maintenance items usually needed</span>
          {d.parts.length === 0 && <span className="text-copy text-muted-ink">{skus.length ? 'None.' : 'None. Items come from Maintenance items, which has none yet.'}</span>}
          {d.parts.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_90px_32px] gap-2 items-center">
              <Select label="Item" size="md" value={p.skuId} placeholder="Pick an item" options={skuOptions} className="w-full"
                onChange={v => set('parts', d.parts.map((x, n) => (n === i ? { ...x, skuId: v } : x)))} />
              <NumberInput className={INPUT} value={p.qty} min={1} max={999} aria-label="Quantity" onChange={v => set('parts', d.parts.map((x, n) => (n === i ? { ...x, qty: v } : x)))} />
              {!readOnly && <button type="button" aria-label="Remove part" onClick={() => set('parts', d.parts.filter((_, n) => n !== i))} className="w-8 h-8 grid place-items-center text-muted-ink hover:text-danger cursor-pointer"><Icon name="X" size="sm" /></button>}
            </div>
          ))}
          {!readOnly && skus.some(s => s.active) && <Button size="sm" variant="secondary" className="self-start" icon={<Icon name="Plus" size="sm" />} onClick={() => set('parts', [...d.parts, { skuId: '', qty: 1 }])}>Add an item</Button>}
          {errors.parts && <span className="text-meta text-danger">{errors.parts}</span>}
        </section>
      </fieldset>
      {errors.form && <span className="text-meta text-danger" role="alert">{errors.form}</span>}
      {t && <HistoryDisclosure entity="maintenance_templates" id={t.id} refreshKey={t} />}
    </OpsModal>
  );
}
