import { useState, type ReactNode } from 'react';
import { DataTable, type Column } from '../../components/DataTable';
import { Button } from '../../components/Button';
import { ConfirmButton } from '../../components/ConfirmDialog';
import { Field } from '../../components/Field';
import { NumberInput } from '../../components/inputs';
import Icon from '../../components/Icon';
import { Card } from '../../components/Card';
import { FileDropRow } from '../../components/Attachments';
import { useToast } from '../../components/Toast';
import { color } from '../../theme';
import { api, notifyFailure, downloadFile } from '../../lib/api';
import { titleCase } from '../../lib/format';
import { PhoneText } from '../../components/PhoneText';
import { addressLines, type OwnerAddress, type Owner } from '../owners/shared';
import { SearchSelect } from '../../components/Select';
import { useApi } from '../../lib/useApi';
import { masked as maskTail } from '../../lib/format';
import { MODEL, CODE, codeName, PURPOSES, USED_BY } from '../../lib/revenueModel';
import { BedsEditor, BaysEditor, bedsText, baysText } from './UnitExtras';
import { Link } from 'react-router-dom';
import {
  STATES, cap, layoutFromBedrooms, useLayoutTypes,
  SectionHead, Grid3, Labeled, Select, ReadOnly, CentreModal,
  type Unit, type Building, type UnitDetail, type LayoutTypeOption,
} from './shared';

/** Every owner profile, for the owner pickers (GET /api/owners, management roles). */
export function useOwnerOptions(on = true) {
  const r = useApi<{ data: Owner[] }>(on ? '/owners' : null);
  return { owners: r.data?.data ?? null, loading: r.loading };
}

type Change = (p: Partial<Unit>) => void;
type Doc = UnitDetail['documents'][number];

/** The bar above an editable tab: what is pending, and the one Save for the whole unit. `auto`: the tab saves itself
 *  when a box is left, so the bar only says where that stands, with Save again after a refused save. `hold`: a change
 *  that waits for Save even so (moving the unit), and why. */
export function SaveBar({ title, sub, dirty, saving, canEdit, onSave, extra, auto, failed, hold }: { title: string; sub?: string; dirty: boolean; saving: boolean; canEdit: boolean; onSave: () => void; extra?: ReactNode; auto?: boolean; failed?: boolean; hold?: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)]">
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-[16px] font-semibold tracking-[-0.01em]">{title}</span>
        {sub && <span className="text-meta text-muted-ink">{sub}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {extra}
        {canEdit && auto && <>
          <span role="status" className={failed ? 'text-meta text-critical' : dirty && !saving ? 'text-meta text-warning' : 'text-meta text-muted-ink'}>
            {saving ? 'Saving…' : failed ? 'Not saved' : hold && dirty ? hold : dirty ? 'Unsaved changes' : 'Saved. Changes save when you leave a box.'}
          </span>
          {(failed || hold) && dirty && !saving && <Button variant="primary" size="sm" onClick={onSave}>{failed ? 'Save again' : 'Save'}</Button>}
        </>}
        {canEdit && !auto && <>
          {dirty && <span className="text-meta text-warning">Unsaved changes</span>}
          <Button variant="primary" size="sm" loading={saving} disabled={!dirty} disabledReason="Nothing has changed" onClick={onSave}>Save changes</Button>
        </>}
      </div>
    </div>
  );
}

export function DetailsForm({ u, owner, buildings, canEdit, onChange, onOpenContract }: { u: Unit; owner: { id: string; name: string; email?: string | null; phone?: string | null; address?: OwnerAddress | null }; buildings: Building[]; canEdit: boolean; onChange: Change; onOpenContract?: () => void }) {
  const building = buildings.find(b => b.id === u.buildingId);
  const { owners } = useOwnerOptions(canEdit);
  const ownerId = u.ownerId ?? owner.id;
  const moved = ownerId !== owner.id;
  const shown = owners?.find(o => o.id === ownerId);
  // The picked owner's details from their profile (last four only); before the list arrives, the unit's own copy.
  const ic = shown ? (shown.icLast4 ? maskTail(shown.icLast4) : '') : moved ? '' : u.ic;
  const bank = shown ? shown.bankName ?? '' : moved ? '' : u.bankName;
  const account = shown ? (shown.bankAccountLast4 ? maskTail(shown.bankAccountLast4) : '') : moved ? '' : u.bankAccount;
  const holder = shown ? shown.accountHolder ?? '' : moved ? '' : u.accountHolder;
  const suggested = !u.layoutType ? layoutFromBedrooms(u.bedrooms) : null;
  const layout = u.layoutType ?? suggested;
  const types = useLayoutTypes();
  const [editingTypes, setEditingTypes] = useState(false);
  // Hidden types are not offered, except the one this unit already has.
  const typeOptions = (types.data?.data ?? []).filter(t => t.isActive || t.key === layout);
  return (
    <>
    <fieldset disabled={!canEdit} className="p-5 m-0 border-0 min-w-0">
      <SectionHead>Listing</SectionHead>
      <Grid3>
        <Labeled label="Listing name" help="Exactly as published on the channels">
          <Field label="" aria-label="Listing name" value={u.listingName} onChange={e => onChange({ listingName: e.target.value })} />
        </Labeled>
        <Labeled label="Unit code" help="Building prefix plus unit, created by The Conts">
          <Field label="" aria-label="Unit code" value={u.unitCode} onChange={e => onChange({ unitCode: e.target.value })} />
        </Labeled>
        <Labeled label="Building" help={u.parentUnitId ? 'A sub-unit stays in its parent unit\'s building.' : 'Moving a unit takes its sub-units with it.'}>
          <Select label="Building" value={u.buildingId} disabled={!!u.parentUnitId} onChange={v => onChange({ buildingId: v, state: buildings.find(b => b.id === v)?.state ?? u.state })}
            options={buildings.map(b => ({ value: b.id, label: b.name }))} />
        </Labeled>
        <Labeled label="State" help="Set on the building. Edit the building to change it.">
          <ReadOnly>{building?.state ?? u.state}</ReadOnly>
        </Labeled>
        <Labeled label="Address" span2>
          <Field label="" aria-label="Address" value={u.address} onChange={e => onChange({ address: e.target.value })} />
        </Labeled>
        {/* The nightly price is set on the Pricing page only (staff sheet UNIT, 23 Oct 2026). */}
      </Grid3>

      <SectionHead>What the unit is for</SectionHead>
      <Grid3>
        <Labeled label="Purpose" help={PURPOSES.find(p => p.value === (u.purpose ?? 'rental'))?.help}>
          <Select label="Purpose" value={u.purpose ?? 'rental'} onChange={v => onChange({ purpose: v as NonNullable<Unit['purpose']> })}
            options={PURPOSES.map(p => ({ value: p.value, label: p.label }))} />
        </Labeled>
        <Labeled label="Used by" help="Optional: which business uses the unit.">
          <Select label="Used by" value={u.usedBy ?? ''} onChange={v => onChange({ usedBy: v || null })}
            options={[{ value: '', label: 'Not set' }, ...USED_BY]} />
        </Labeled>
      </Grid3>

      <SectionHead>Type and size</SectionHead>
      <Grid3>
        <Labeled label="Type" help={u.layoutType ? undefined : suggested ? `Suggested from ${u.bedrooms === 0 ? 'no bedrooms' : `${u.bedrooms} ${u.bedrooms === 1 ? 'bedroom' : 'bedrooms'}`}. Saved with the next save.` : 'Pick one.'}>
          <Select label="Type" value={layout ?? ''} onChange={v => onChange({ layoutType: v || null })}
            options={[...(layout ? [] : [{ value: '', label: 'Not set' }]), ...typeOptions.map(t => ({ value: t.key, label: t.isActive ? t.label : `${t.label} (hidden)` }))]} />
          {types.data?.ready && types.data.mayEdit && (
            <button type="button" onClick={() => setEditingTypes(true)} className="self-start p-0 bg-transparent border-none cursor-pointer [font-family:inherit] text-meta font-semibold text-gold-ink">Edit the Type list</button>
          )}
        </Labeled>
        <Labeled label="Bedrooms" help="0 for a studio">
          <NumberInput label="" aria-label="Bedrooms" min={0} max={20} value={u.bedrooms ?? null}
            onChange={n => onChange({ bedrooms: n ?? undefined })} />
        </Labeled>
        <Labeled label="Bathrooms">
          <NumberInput label="" aria-label="Bathrooms" min={0} max={20} value={u.bathrooms ?? null}
            onChange={n => onChange({ bathrooms: n ?? undefined })} />
        </Labeled>
        <Labeled label="Size (sq ft)" help="Built-up area">
          <NumberInput label="" aria-label="Size in square feet" min={1} max={100000} value={u.sizeSqft ?? null}
            onChange={n => onChange({ sizeSqft: n ?? null })} />
        </Labeled>
      </Grid3>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-4 mb-[22px]">
        <div className="flex flex-col gap-2 min-w-0">
          <SectionHead noMargin>Beds and mattresses</SectionHead>
          {(u.beds?.length ?? 0) > 0 && <span className="text-copy font-medium">{bedsText(u.beds)}</span>}
          <BedsEditor beds={u.beds ?? []} disabled={!canEdit} onChange={beds => onChange({ beds })} />
        </div>
        <div className="flex flex-col gap-2 min-w-0">
          <SectionHead noMargin>Car park</SectionHead>
          {(u.parkingBays?.length ?? 0) > 0 && <span className="text-copy font-medium">{baysText(u.parkingBays)}</span>}
          <BaysEditor bays={u.parkingBays ?? []} disabled={!canEdit} onChange={parkingBays => onChange({ parkingBays })} />
        </div>
      </div>

      <SectionHead>Owner</SectionHead>
      <Grid3>
        <Labeled label="Owner" help={moved ? 'Saving moves this unit to this owner. Its current contract stays with the previous owner.' : 'Picked from the owner profiles.'}>
          {canEdit && owners ? (
            <SearchSelect label="Owner" size="md" value={ownerId} placeholder="Search owners"
              onChange={v => onChange({ ownerId: v })}
              options={owners.map(o => ({ value: o.id, label: titleCase(o.displayName), hint: o.units.length ? `${o.units.length} ${o.units.length === 1 ? 'unit' : 'units'}` : undefined }))} />
          ) : <ReadOnly>{titleCase(shown?.displayName ?? owner.name)}</ReadOnly>}
        </Labeled>
        <Labeled label="IC / company number">
          <ReadOnly>{ic || 'Not recorded'}</ReadOnly>
        </Labeled>
        <Labeled label="Bank">
          <ReadOnly>{[bank, account].filter(Boolean).join(' · ') || 'Not recorded'}</ReadOnly>
        </Labeled>
        <Labeled label="Account holder">
          <ReadOnly>{holder ? titleCase(holder) : 'Not recorded'}</ReadOnly>
        </Labeled>
      </Grid3>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 -mt-3 mb-[6px]">
        <Link to={`/owners/${encodeURIComponent(ownerId)}`} className="text-meta font-semibold text-gold-ink no-underline">Edit on owner profile</Link>
        <span className="text-meta text-muted-ink">IC, bank and contact details are kept on the owner, for every unit they own.</span>
      </div>
      {!moved && (owner.phone || owner.email || owner.address) && (
        <div className="flex flex-col gap-1 mb-[22px] text-copy text-ink">
          {owner.phone && <PhoneText value={owner.phone} />}
          {owner.email && <a href={`mailto:${owner.email}`} className="text-ink underline underline-offset-2 [overflow-wrap:anywhere]">{owner.email}</a>}
          {owner.address && <span className="whitespace-pre-line text-muted-ink">{addressLines(owner.address).join('\n')}</span>}
        </div>
      )}
      {moved && <div className="mb-[22px]" />}

      <SectionHead>Income model</SectionHead>
      <div className="flex flex-wrap items-center gap-3 mb-[6px]">
        <span className="text-copy">{u.contractCode ? `${codeName(u.contractCode)} · ${CODE[u.contractCode].label}${u.termsLabel ? ` · ${u.termsLabel}` : ''}` : u.revenueModel ? (u.termsLabel ?? MODEL[u.revenueModel].label) : u.pkg}</span>
        {onOpenContract && <button type="button" onClick={onOpenContract} className="p-0 bg-transparent border-none cursor-pointer [font-family:inherit] text-meta font-semibold text-gold-ink">Change on the Contract tab</button>}
      </div>
      <details className="m-0 text-meta text-muted-ink [&>summary]:cursor-pointer"><summary className="w-fit list-none inline-flex items-center gap-1 text-muted-ink"><span aria-hidden className="inline-grid place-items-center w-4 h-4 rounded-full border border-solid border-line text-[10px] font-semibold">?</span> How this works</summary><p className="m-0 mt-1.5">One income model per contract decides how the owner statement is worked out. Package {u.pkg.replace('Package ', '')} is kept from the owner workbook for reference.</p></details>
    </fieldset>
    {editingTypes && <LayoutTypesModal types={types.data?.data ?? []} onClose={() => setEditingTypes(false)} onChanged={types.reload} />}
    </>
  );
}

/** Staff keep the unit Type list here: add a Type, rename one, or hide one that is no longer used. Every Type has a row
 *  in the cleaning price grid (Service prices), so a new one is priced there. */
function LayoutTypesModal({ types, onClose, onChanged }: { types: LayoutTypeOption[]; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(types.map(t => [t.key, t.label])));
  const [added, setAdded] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  async function run(key: string, call: () => Promise<unknown>, done: string) {
    setBusy(key);
    try { await call(); toast({ tone: 'success', title: done }); onChanged(); }
    catch (e) { notifyFailure(e); }
    finally { setBusy(null); }
  }
  return (
    <CentreModal title="Unit Types" sub="The Type list on every unit. A hidden Type stays on the units that have it." onClose={onClose}
      footer={<Button size="sm" variant="secondary" onClick={onClose}>Done</Button>}>
      <div className="flex flex-col gap-2">
        {types.map(t => {
          const name = names[t.key] ?? t.label, renamed = name.trim() !== t.label;
          return (
            <div key={t.key} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
              <Field aria-label={`Name of ${t.label}`} value={name} maxLength={60} onChange={e => setNames(n => ({ ...n, [t.key]: e.target.value }))} />
              {renamed
                ? <Button size="sm" variant="primary" loading={busy === t.key} disabled={!name.trim()} disabledReason="Enter a name"
                    onClick={() => void run(t.key, () => api.patch(`/unit-layout-types/${encodeURIComponent(t.key)}`, { label: name.trim() }), 'Type renamed.')}>Save</Button>
                : <span />}
              <Button size="sm" variant="tertiary" loading={busy === `${t.key}:active`}
                onClick={() => void run(`${t.key}:active`, () => api.patch(`/unit-layout-types/${encodeURIComponent(t.key)}`, { isActive: !t.isActive }), t.isActive ? 'Type hidden.' : 'Type shown again.')}>
                {t.isActive ? 'Hide' : 'Show'}
              </Button>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
        <Field label="Add a Type" placeholder="e.g. Loft" value={added} maxLength={60} onChange={e => setAdded(e.target.value)} />
        <Button size="sm" variant="secondary" loading={busy === 'new'} disabled={!added.trim()} disabledReason="Enter a name"
          onClick={() => void run('new', async () => { await api.post('/unit-layout-types', { label: added.trim() }); setAdded(''); }, 'Type added. Set its cleaning price in Service prices.')}>Add</Button>
      </div>
    </CentreModal>
  );
}

const UPLOAD_KINDS = [{ value: 'contract', label: 'Contract' }, { value: 'inspection', label: 'Inspection report' }, { value: 'other', label: 'Other' }];

/** Every file stored against the unit: contracts, statements (money roles only), inspection reports, photos. */
export function DocumentsCard({ unitId, unitLabel, documents, onUploaded }: { unitId: string; unitLabel: string; documents: UnitDetail['documents']; onUploaded: () => void }) {
  const toast = useToast();
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
        <span className="text-[16px] font-semibold tracking-[-0.01em]">Documents</span>
        <span className="text-meta text-muted-ink">Agreements, statements, inspection reports and photos for this unit.</span>
      </div>
      <DataTable<Doc> id="unit.documents" urlPrefix="doc." bare noViews noToolbar pageSize={0} maxHeight="none"
        columns={docColumns} rows={documents} rowKey={doc => doc.id} noun={['document', 'documents']}
        empty={{ title: 'No documents on this unit yet.', icon: 'FileText' }} />
      <div className="grid grid-cols-1 sm:grid-cols-[180px_minmax(0,1fr)] items-center gap-2 py-3 px-5 [border-top:1px_solid_var(--color-line-soft)]">
        <Select label="Kind of document" value={kind} onChange={setKind} options={UPLOAD_KINDS} />
        <FileDropRow label={`Add ${UPLOAD_KINDS.find(k => k.value === kind)?.label.toLowerCase() ?? 'document'}`} hint="Drop a file here, or click to browse" busy={busy}
          onPick={fl => { const f = fl.item(0); if (f) void upload(f); }} />
      </div>
    </Card>
  );
}

/** Adds a building, or with `initial` edits one. `onDelete` is offered only for a building with no units. */
export function BuildingModal({ initial, onClose, onSubmit, onDelete }: { initial?: Building; onClose: () => void; onSubmit: (b: Omit<Building, 'id'>) => void; onDelete?: () => void }) {
  const [name, setName] = useState(initial?.name ?? ''); const [city, setCity] = useState(initial?.city ?? ''); const [state, setState] = useState(initial?.state ?? STATES[0]);
  const [fullAccessCard, setFullAccessCard] = useState(initial?.fullAccessCard ?? false);
  const ok = name.trim() !== '' && city.trim() !== '';
  return (
    <CentreModal title={initial ? 'Edit building' : 'Add building'} sub={initial ? 'Correct the name or location. Its units stay as they are.' : 'A building holds units. Add units to it next.'} onClose={onClose}
      footer={<>{onDelete && <ConfirmButton confirm={{ title: `Delete ${initial ? initial.name : 'this building'}?`, body: 'It has no units, and it is deleted for good.', confirmLabel: 'Delete building', cancelLabel: 'Keep it' }} onConfirm={onDelete} style={{ marginRight: 'auto' }}>Delete building</ConfirmButton>}<Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button size="sm" variant="primary" disabled={!ok} disabledReason="Fill name and city" onClick={() => onSubmit({ name: name.trim(), city: city.trim(), state, fullAccessCard })}>{initial ? 'Save' : 'Add building'}</Button></>}>
      <Field label="Building name" placeholder="e.g. Arte Mont Kiara" value={name} onChange={e => setName(e.target.value)} />
      <Field label="City / area" placeholder="e.g. Mont Kiara, 50480 KL" value={city} onChange={e => setCity(e.target.value)} />
      <Labeled label="State" help={initial ? 'Every unit in the building is in this state.' : undefined}><Select label="State" value={state} onChange={setState} options={STATES.map(s => ({ value: s, label: s }))} /></Labeled>
      <label className="flex items-start gap-2 text-copy cursor-pointer">
        <input type="checkbox" checked={fullAccessCard} onChange={e => setFullAccessCard(e.target.checked)} className="mt-[3px] accent-[var(--color-gold-ink)]" />
        <span>Full access card <span className="block text-meta text-muted-ink">One card opens the lobby, lift and car park. Shown on each unit's Access tab.</span></span>
      </label>
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

/** Adds a unit to a building: the owner is picked from the owner profiles first (a unit always has one). */
export function AddUnitModal({ buildingName, onClose, onConfirm }: { buildingName: string; onClose: () => void; onConfirm: (ownerId: string) => void }) {
  const { owners, loading } = useOwnerOptions();
  const [ownerId, setOwnerId] = useState('');
  return (
    <CentreModal title={`Add a unit to ${buildingName}`} sub="A blank unit opens for you to fill in." onClose={onClose}
      footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button size="sm" variant="primary" disabled={!ownerId} disabledReason="Pick the owner" onClick={() => onConfirm(ownerId)}>Add unit</Button></>}>
      <Labeled label="Owner" help={owners && owners.length === 0 ? 'No owner profiles yet. Add the owner on the Owners page first.' : 'Not listed? Add the owner on the Owners page first.'}>
        <SearchSelect label="Owner" size="md" value={ownerId} onChange={setOwnerId} placeholder={loading ? 'Loading owners' : 'Search owners'}
          options={(owners ?? []).map(o => ({ value: o.id, label: titleCase(o.displayName) }))} />
      </Labeled>
      <p className="m-0 text-copy text-muted-ink">You will set the listing name, code, layout, package and contract on its Details tab.</p>
    </CentreModal>
  );
}
