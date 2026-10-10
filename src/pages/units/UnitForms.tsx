import { useRef, useState, type ReactNode } from 'react';
import { DataTable, type Column } from '../../components/DataTable';
import { Button } from '../../components/Button';
import { ConfirmButton } from '../../components/ConfirmDialog';
import { Field } from '../../components/Field';
import { MoneyInput, NumberInput } from '../../components/inputs';
import Icon from '../../components/Icon';
import { Card } from '../../components/Card';
import { useToast } from '../../components/Toast';
import { color } from '../../theme';
import { api, notifyFailure, downloadFile } from '../../lib/api';
import { rm } from '../../lib/format';
import { bankName } from '../../lib/vocabulary';
import { MODEL } from '../../lib/revenueModel';
import {
  BANKS, STATES, cap,
  SectionHead, Grid3, Labeled, Select, ReadOnly, CentreModal,
  type Unit, type Building, type UnitDetail,
} from './shared';

type Change = (p: Partial<Unit>) => void;
type Doc = UnitDetail['documents'][number];

/** The bar above an editable tab: what is pending, and the one Save for the whole unit. */
export function SaveBar({ title, sub, dirty, saving, canEdit, onSave, extra }: { title: string; sub?: string; dirty: boolean; saving: boolean; canEdit: boolean; onSave: () => void; extra?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)]">
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-heading font-semibold">{title}</span>
        {sub && <span className="text-meta text-muted-ink">{sub}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {extra}
        {canEdit && <>
          {dirty && <span className="text-meta text-warning">Unsaved changes</span>}
          <Button variant="primary" size="sm" loading={saving} disabled={!dirty} disabledReason="Nothing has changed" onClick={onSave}>Save changes</Button>
        </>}
      </div>
    </div>
  );
}

export function DetailsForm({ u, buildings, money, canEdit, onChange, onOpenContract }: { u: Unit; buildings: Building[]; money: boolean; canEdit: boolean; onChange: Change; onOpenContract?: () => void }) {
  const building = buildings.find(b => b.id === u.buildingId);
  return (
    <fieldset disabled={!canEdit} className="p-5 m-0 border-0 min-w-0">
      <SectionHead>Listing</SectionHead>
      <Grid3>
        <Labeled label="Listing name" hint="FREE TEXT" help="Exactly as published on the channels">
          <Field label="" aria-label="Listing name" value={u.listingName} onChange={e => onChange({ listingName: e.target.value })} />
        </Labeled>
        <Labeled label="Unit code" hint="FREE TEXT" help="Building prefix plus unit, created by The Conts">
          <Field label="" aria-label="Unit code" value={u.unitCode} onChange={e => onChange({ unitCode: e.target.value })} />
        </Labeled>
        <Labeled label="Building" hint="DROPDOWN" help={u.parentUnitId ? 'A sub-unit stays in its parent unit\'s building.' : 'Moving a unit takes its sub-units with it.'}>
          <Select label="Building" value={u.buildingId} disabled={!!u.parentUnitId} onChange={v => onChange({ buildingId: v, state: buildings.find(b => b.id === v)?.state ?? u.state })}
            options={buildings.map(b => ({ value: b.id, label: b.name }))} />
        </Labeled>
        <Labeled label="State" hint="FROM BUILDING" help="Set on the building. Edit the building to change it.">
          <ReadOnly>{building?.state ?? u.state}</ReadOnly>
        </Labeled>
        <Labeled label="Address" hint="FREE TEXT" span2>
          <Field label="" aria-label="Address" value={u.address} onChange={e => onChange({ address: e.target.value })} />
        </Labeled>
        <Labeled label="Bedrooms" hint="NUMBER" help="0 for a studio">
          <NumberInput label="" aria-label="Bedrooms" min={0} max={20} value={u.bedrooms ?? null}
            onChange={n => onChange({ bedrooms: n ?? undefined })} />
        </Labeled>
        {money && u.baseRate !== undefined && (
          <Labeled label="Base nightly rate (RM)" hint="AMOUNT" help="The web price before channel uplifts. Saving it re-sends prices to linked channels.">
            <MoneyInput label="" aria-label="Base nightly rate" minSen={100} valueSen={u.baseRate}
              onChangeSen={sen => onChange({ baseRate: sen ?? 0 })} />
          </Labeled>
        )}
      </Grid3>

      <SectionHead>Owner</SectionHead>
      <Grid3>
        <Labeled label="Owner name" hint="FREE TEXT"><Field label="" aria-label="Owner name" value={u.ownerName} onChange={e => onChange({ ownerName: e.target.value })} /></Labeled>
        <Labeled label="IC or passport" hint="FREE TEXT" help="Accepts both formats"><Field label="" aria-label="IC or passport" value={u.ic} onChange={e => onChange({ ic: e.target.value })} /></Labeled>
        <Labeled label="Bank name" hint="DROPDOWN"><Select label="Bank name" value={u.bankName} onChange={v => onChange({ bankName: v })} options={BANKS.map(b => ({ value: b, label: bankName(b) ?? b }))} /></Labeled>
        <Labeled label="Bank account" hint="FREE TEXT"><Field label="" aria-label="Bank account" value={u.bankAccount} onChange={e => onChange({ bankAccount: e.target.value })} /></Labeled>
        <Labeled label="Account holder" hint="FREE TEXT" span2><Field label="" aria-label="Account holder" value={u.accountHolder} onChange={e => onChange({ accountHolder: e.target.value })} /></Labeled>
      </Grid3>
      <p className="-mt-3 mb-[22px] text-meta text-muted-ink">Owner and bank details belong to the owner, so a change here applies to every unit they own.</p>

      <SectionHead>Revenue model</SectionHead>
      <div className="flex flex-wrap items-center gap-3 mb-[6px]">
        <span className="text-copy">{u.revenueModel ? (u.termsLabel ?? MODEL[u.revenueModel].label) : u.pkg}</span>
        {onOpenContract && <button type="button" onClick={onOpenContract} className="p-0 bg-transparent border-none cursor-pointer [font:inherit] text-meta! font-semibold text-gold-ink">Change on the Contract tab</button>}
      </div>
      <p className="m-0 text-meta text-muted-ink">One revenue model per contract decides how the owner statement is worked out. Package {u.pkg.replace('Package ', '')} is kept from the owner workbook for reference.</p>
    </fieldset>
  );
}

const UPLOAD_KINDS = [{ value: 'contract', label: 'Contract' }, { value: 'inspection', label: 'Inspection report' }, { value: 'other', label: 'Other' }];

/** Every file stored against the unit: contracts, statements (money roles only), inspection reports, photos. */
export function DocumentsCard({ unitId, unitLabel, documents, onUploaded }: { unitId: string; unitLabel: string; documents: UnitDetail['documents']; onUploaded: () => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState('contract');
  const [busy, setBusy] = useState(false);
  function download(d: { id: string; name: string }) {
    toast({ tone: 'info', title: 'Preparing download', body: `${d.name} — served as a signed link.` });
    downloadFile(`/documents/${d.id}/download`).catch(notifyFailure);
  }
  const docColumns: Column<Doc>[] = [
    { key: 'name', label: 'Document', value: doc => doc.name, hideable: false, width: 240,
      render: doc => (
        <span className="flex items-center gap-[10px] min-w-0">
          <Icon name="FileText" size="sm" color={color.textMuted} />
          <span className="font-medium whitespace-nowrap overflow-hidden text-ellipsis" title={doc.name}>{doc.name}</span>
        </span>
      ) },
    { key: 'kind', label: 'Kind', value: doc => cap(doc.kind), width: 120 },
    { key: 'size', label: 'Size', value: doc => doc.sizeLabel, width: 90 },
    { key: 'added', label: 'Added', type: 'date', value: doc => doc.updatedAt, width: 116 },
    { key: 'download', label: '', noExport: true, sortable: false, filter: false, width: 130, align: 'right',
      render: doc => <Button size="sm" variant="secondary" icon={<Icon name="Download" size="sm" />} onClick={() => download(doc)}>Download</Button> },
  ];
  async function upload(file: File) {
    const fd = new FormData();
    fd.append('file', file); fd.append('unitId', unitId); fd.append('kind', kind);
    setBusy(true);
    try {
      await api.post<{ id: string }>('/documents', fd);
      toast({ tone: 'success', title: 'Document uploaded.', body: `${file.name} added to ${unitLabel}.` });
      onUploaded();
    } catch (e) { notifyFailure(e); }
    finally { setBusy(false); }
  }
  return (
    <Card>
      <div className="py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex flex-col gap-1">
        <span className="text-heading font-semibold">Documents</span>
        <span className="text-meta text-muted-ink">Agreements, statements, inspection reports and photos for this unit.</span>
      </div>
      <DataTable<Doc> id="unit.documents" urlPrefix="doc." bare noViews noToolbar pageSize={0} maxHeight="none"
        columns={docColumns} rows={documents} rowKey={doc => doc.id} noun={['document', 'documents']}
        empty={{ title: 'No documents on this unit yet.', icon: 'FileText' }} />
      <div className="flex flex-wrap items-center gap-2 py-3 px-5 bg-page">
        <div className="w-[180px] max-w-full"><Select label="Kind of document" value={kind} onChange={setKind} options={UPLOAD_KINDS} /></div>
        <Button size="sm" variant="secondary" loading={busy} icon={<Icon name="Upload" size="sm" />} onClick={() => fileRef.current?.click()}>Upload a document</Button>
        <input ref={fileRef} type="file" className="hidden" onChange={e => { const f = e.currentTarget.files?.item(0); if (f) void upload(f); e.currentTarget.value = ''; }} />
      </div>
    </Card>
  );
}

export function ExpensesEditor({ u, canEdit, onChange }: { u: Unit; canEdit: boolean; onChange: Change }) {
  const total = u.expenses.reduce((s, e) => s + e.amount, 0);
  const setAmt = (id: string, sen: number | null) => onChange({ expenses: u.expenses.map(e => e.id === id ? { ...e, amount: sen ?? 0 } : e) });
  const remove = (id: string) => onChange({ expenses: u.expenses.filter(e => e.id !== id) });
  return (
    <fieldset disabled={!canEdit} className="p-5 m-0 border-0 min-w-0">
      <div className="border border-solid border-line rounded-card overflow-hidden">
        {u.expenses.length === 0 && <div className="py-3 px-[14px] text-copy text-muted-ink [border-bottom:1px_solid_var(--color-line-soft)]">No recurring expenses.</div>}
        {u.expenses.map(e => (
          <div key={e.id} className="grid grid-cols-[minmax(0,1fr)_110px_30px] sm:grid-cols-[minmax(0,1fr)_160px_30px] gap-2 sm:gap-3 items-center py-[10px] px-[14px] [border-bottom:1px_solid_var(--color-line-soft)]">
            <input aria-label="Expense category" value={e.category} onChange={ev => onChange({ expenses: u.expenses.map(x => x.id === e.id ? { ...x, category: ev.target.value } : x) })} className="field-input h-[38px]! min-w-0" />
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-meta text-muted-ink">RM</span>
              <MoneyInput aria-label={`${e.category} amount`} valueSen={e.amount} onChangeSen={sen => setAmt(e.id, sen)} className="field-input h-[38px]! min-w-0 text-right tabular-nums" />
            </div>
            {canEdit ? (
              <button onClick={() => remove(e.id)} aria-label={`Remove ${e.category}`} title="Remove"
                className="w-[30px] h-[30px] grid place-items-center rounded-control border-none bg-transparent text-muted-ink cursor-pointer hover:bg-muted"><Icon name="X" size="sm" /></button>
            ) : <span />}
          </div>
        ))}
        {canEdit && (
          <button type="button" onClick={() => onChange({ expenses: [...u.expenses, { id: crypto.randomUUID(), category: 'Other', amount: 0, note: '' }] })}
            className="flex items-center gap-2 w-full py-[10px] px-[14px] bg-card [border:none] [border-bottom:1px_solid_var(--color-line-soft)]! cursor-pointer font-sans text-copy font-medium text-gold-ink text-left">
            <Icon name="Plus" size="sm" /> Add expense
          </button>
        )}
        <div className="flex justify-between py-3 px-[14px] bg-muted">
          <span className="text-copy font-semibold">Total monthly</span>
          <span className="text-copy font-semibold tabular-nums">{rm(total)}</span>
        </div>
      </div>
      <p className="text-meta text-muted-ink mt-[10px] mb-0">Deducted from the owner statement each month.</p>
    </fieldset>
  );
}

/** Adds a building, or with `initial` edits one. `onDelete` is offered only for a building with no units. */
export function BuildingModal({ initial, onClose, onSubmit, onDelete }: { initial?: Building; onClose: () => void; onSubmit: (b: Omit<Building, 'id'>) => void; onDelete?: () => void }) {
  const [name, setName] = useState(initial?.name ?? ''); const [city, setCity] = useState(initial?.city ?? ''); const [state, setState] = useState(initial?.state ?? STATES[0]);
  const ok = name.trim() !== '' && city.trim() !== '';
  return (
    <CentreModal title={initial ? 'Edit building' : 'Add building'} sub={initial ? 'Correct the name or location. Its units stay as they are.' : 'A building holds units. Add units to it next.'} onClose={onClose}
      footer={<>{onDelete && <ConfirmButton confirm={{ title: `Delete ${initial ? initial.name : 'this building'}?`, body: 'It has no units, and it is deleted for good.', confirmLabel: 'Delete building', cancelLabel: 'Keep it' }} onConfirm={onDelete}>Delete building</ConfirmButton>}<Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button size="sm" variant="primary" disabled={!ok} disabledReason="Fill name and city" onClick={() => onSubmit({ name: name.trim(), city: city.trim(), state })}>{initial ? 'Save' : 'Add building'}</Button></>}>
      <Field label="Building name" placeholder="e.g. Arte Mont Kiara" value={name} onChange={e => setName(e.target.value)} />
      <Field label="City / area" placeholder="e.g. Mont Kiara, 50480 KL" value={city} onChange={e => setCity(e.target.value)} />
      <Labeled label="State" hint="DROPDOWN" help={initial ? 'Every unit in the building is in this state.' : undefined}><Select label="State" value={state} onChange={setState} options={STATES.map(s => ({ value: s, label: s }))} /></Labeled>
    </CentreModal>
  );
}

export function ConfirmAdd({ title, sub, body, confirm, onClose, onConfirm }: { title: string; sub: string; body: string; confirm: string; onClose: () => void; onConfirm: () => void }) {
  return (
    <CentreModal title={title} sub={sub} onClose={onClose}
      footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button size="sm" variant="primary" onClick={onConfirm}>{confirm}</Button></>}>
      <p className="m-0 text-copy text-muted-ink">{body}</p>
    </CentreModal>
  );
}
