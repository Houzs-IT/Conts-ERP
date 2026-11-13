import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import Icon from '../components/Icon';
import { Select } from '../components/Select';
import { TabBar, tabId, panelId } from '../components/TabBar';
import { StaleBanner } from '../components/DataState';
import { EmptyState, SkeletonRows } from '../components/States';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { useSession } from '../lib/session';
import { mayRun } from '../lib/areaAccess';
import { StatusBadge } from '../components/StatusBadge';
import { api, notifyFailure, ApiFailure } from '../lib/api';
import { MODELS, codeName, plainOptions, fittingOptions, type ContractType, type ContractTypeOptions, type RevenueModel } from '../lib/revenueModel';
import { useContractTypesPayload } from '../lib/useContractTypes';
import { plural, buildingName } from '../lib/format';
import { BuildingModal } from './units/UnitForms';
import { PROPERTIES_FALLBACK } from './units/fallback';
import { useLayoutTypes, useBedSizes, Labeled, Select as FormSelect, CentreModal, buildingArea, type Building, type PropertiesPayload } from './units/shared';

/** Units > Unit settings: the lists the unit screens pick from, kept by staff instead of in code (owner, 4 Nov 2026; PLAN-unit-settings.md). */

const TABS = [
  { key: 'buildings', label: 'Buildings', icon: 'Building2' },
  { key: 'types', label: 'Unit types', icon: 'LayoutGrid' },
  { key: 'beds', label: 'Bed sizes', icon: 'BedDouble' },
  { key: 'contracts', label: 'Contract types', icon: 'FileSignature' },
] as const;
type TabKey = (typeof TABS)[number]['key'];
const isTab = (v: string | null): v is TabKey => TABS.some(t => t.key === v);

const byName = (a: Building, b: Building): number => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

export default function UnitSettingsPage() {
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab');
  const tab: TabKey = isTab(asked) ? asked : 'buildings';
  const setTab = (t: TabKey) => setParams(p => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });
  const { user } = useSession();
  const canEdit = mayRun(user, 'unitSettings');

  return (
    <>
      <PageHeader title="Unit settings" sub="The lists staff pick from on the unit screens" />
      <div className="mt-5 mb-3">
        <div className="md:hidden">
          <Select label="Settings list" size="md" value={tab} onChange={v => { if (isTab(v)) setTab(v); }} options={TABS.map(t => ({ value: t.key, label: t.label }))} />
        </div>
        <div className="hidden md:block"><TabBar id="unit-settings" label="Unit settings lists" tabs={TABS} value={tab} onChange={setTab} /></div>
      </div>
      <div role="tabpanel" id={panelId('unit-settings')} aria-labelledby={tabId('unit-settings', tab)}>
        {tab === 'buildings' && <BuildingsTab canEdit={canEdit} />}
        {tab === 'types' && <UnitTypesTab />}
        {tab === 'beds' && <BedSizesTab />}
        {tab === 'contracts' && <ContractTypesTab />}
      </div>
    </>
  );
}

type BuildingModalState = { kind: 'add' } | { kind: 'edit'; building: Building } | null;

function BuildingsTab({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const props = useApi<PropertiesPayload>('/properties', PROPERTIES_FALLBACK);
  const [modal, setModal] = useState<BuildingModalState>(null);
  const buildings = useMemo(() => [...(props.data?.buildings ?? [])].sort(byName), [props.data]);
  const unitCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of props.data?.units ?? []) m.set(u.buildingId, (m.get(u.buildingId) ?? 0) + 1);
    return m;
  }, [props.data]);

  async function add(b: Omit<Building, 'id'>): Promise<void> {
    try {
      await api.post<{ id: string }>('/properties', b);
      setModal(null);
      toast({ tone: 'success', title: 'Building added.', body: `${buildingName(b.name)} is on the list. Add units to it on the Units page.` });
      props.reload();
    } catch (e) { notifyFailure(e); }
  }
  async function save(id: string, b: Omit<Building, 'id'>): Promise<void> {
    try {
      await api.patch(`/properties/${id}`, b);
      setModal(null);
      toast({ tone: 'success', title: 'Building updated.', body: buildingName(b.name) });
      props.reload();
    } catch (e) { notifyFailure(e); }
  }
  async function remove(b: Building): Promise<void> {
    try {
      await api.del(`/properties/${b.id}`);
      setModal(null);
      toast({ tone: 'success', title: 'Building deleted.', body: buildingName(b.name) });
      props.reload();
    } catch (e) { notifyFailure(e); }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <p className="m-0 text-copy text-muted-ink flex-1 basis-[240px]">Every building units can be added to. Correct a name here and the units follow. A building with no units can be deleted.</p>
        {canEdit && <Button size="sm" variant="primary" className="max-md:min-h-11" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal({ kind: 'add' })}>Add building</Button>}
      </div>
      {props.error && <StaleBanner message={props.data ? `Showing the last list we have. ${props.error}` : props.error} onRetry={props.reload} />}
      {props.loading && !props.data ? <SkeletonRows rows={6} /> : !props.data ? null : buildings.length === 0 ? (
        <EmptyState icon="Building2" title="No buildings yet" body="Add the first building, then add its units on the Units page." />
      ) : (
        <Card>
          <ul className="m-0 p-0 list-none divide-y divide-line-soft">
            {buildings.map(b => (
              <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 px-5">
                <div className="flex flex-col min-w-0 flex-1 basis-[200px]">
                  <span className="text-copy font-medium [overflow-wrap:anywhere]">{buildingName(b.name)}</span>
                  <span className="text-meta text-muted-ink [overflow-wrap:anywhere]">{[buildingArea(b), b.state].filter(Boolean).join(' · ')}</span>
                </div>
                <span className="text-meta text-muted-ink">{plural(unitCount.get(b.id) ?? 0, 'unit')}</span>
                {canEdit && <Button size="sm" variant="secondary" className="max-md:min-h-11" onClick={() => setModal({ kind: 'edit', building: b })}>Edit</Button>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {modal?.kind === 'add' && <BuildingModal onClose={() => setModal(null)} onSubmit={b => void add(b)} />}
      {modal?.kind === 'edit' && <BuildingModal initial={modal.building} onClose={() => setModal(null)} onSubmit={b => void save(modal.building.id, b)}
        onDelete={(unitCount.get(modal.building.id) ?? 0) === 0 ? () => void remove(modal.building) : undefined} />}
    </>
  );
}

/** Add a Type, rename one, or hide one that is no longer used. Every Type has a row in the cleaning price grid
 *  (Service prices), so a new one is priced there. */
function UnitTypesTab() {
  return <NameListTab list={useLayoutTypes()} path="/unit-layout-types" noun="Type" addLabel="Add a Type" placeholder="e.g. Loft"
    intro="The Type list on every unit. A hidden Type stays on the units that have it." added="Type added. Set its cleaning price in Service prices." />;
}

/** The bed sizes a unit's Beds and mattresses pick from (owner, 4 Nov 2026). */
function BedSizesTab() {
  return <NameListTab list={useBedSizes()} path="/unit-bed-sizes" noun="Bed size" addLabel="Add a bed size" placeholder="e.g. Double"
    intro="The bed sizes on every unit's Beds and mattresses. A hidden size stays on the units that have it." added="Bed size added." />;
}

/** A list of names staff add, rename and hide (never delete: units keep the key). */
function NameListTab({ list: types, path, noun, addLabel, placeholder, intro, added: addedMsg }: {
  list: ReturnType<typeof useLayoutTypes>; path: string; noun: string; addLabel: string; placeholder: string; intro: string; added: string;
}) {
  const toast = useToast();
  const list = types.data?.data ?? [];
  const canEdit = !!types.data?.ready && !!types.data.mayEdit;
  const [names, setNames] = useState<Record<string, string>>({});
  const [added, setAdded] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  async function run(key: string, call: () => Promise<unknown>, done: string): Promise<void> {
    setBusy(key);
    try { await call(); toast({ tone: 'success', title: done }); types.reload(); }
    catch (e) { notifyFailure(e); }
    finally { setBusy(null); }
  }
  return (
    <>
      <p className="m-0 mb-3 text-copy text-muted-ink">{intro}</p>
      {types.data && !types.data.ready && <p className="m-0 mb-3 text-meta text-warning">The {noun} list cannot be changed on this database yet.</p>}
      {types.error && <StaleBanner message={types.data ? `Showing the last list we have. ${types.error}` : types.error} onRetry={types.reload} />}
      {types.loading && !types.data ? <SkeletonRows rows={6} /> : !types.data ? null : (
        <Card>
          <ul className="m-0 p-0 list-none divide-y divide-line-soft">
            {list.map(t => {
              const name = names[t.key] ?? t.label, renamed = name.trim() !== t.label;
              return (
                <li key={t.key} className="flex flex-wrap items-center gap-2 py-3 px-5">
                  <div className="flex-1 basis-[200px] min-w-0">
                    <Field aria-label={`Name of ${t.label}`} value={name} maxLength={60} disabled={!canEdit} style={{ minHeight: 44 }}
                      onChange={e => setNames(n => ({ ...n, [t.key]: e.target.value }))} />
                  </div>
                  {!t.isActive && <span className="text-meta text-muted-ink">Hidden</span>}
                  {canEdit && renamed && (
                    <Button size="sm" variant="primary" className="max-md:min-h-11" loading={busy === t.key} disabled={!name.trim()} disabledReason="Enter a name"
                      onClick={() => void run(t.key, () => api.patch(`${path}/${encodeURIComponent(t.key)}`, { label: name.trim() }), `${noun} renamed.`)}>Save</Button>
                  )}
                  {canEdit && (
                    <Button size="sm" variant="tertiary" className="max-md:min-h-11" loading={busy === `${t.key}:active`}
                      onClick={() => void run(`${t.key}:active`, () => api.patch(`${path}/${encodeURIComponent(t.key)}`, { isActive: !t.isActive }), t.isActive ? `${noun} hidden.` : `${noun} shown again.`)}>
                      {t.isActive ? 'Hide' : 'Show'}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          {canEdit && (
            <div className="flex flex-wrap items-end gap-2 py-3 px-5 [border-top:1px_solid_var(--color-line-soft)]">
              <div className="flex-1 basis-[200px] min-w-0">
                <Field label={addLabel} placeholder={placeholder} value={added} maxLength={60} style={{ minHeight: 44 }} onChange={e => setAdded(e.target.value)} />
              </div>
              <Button size="sm" variant="secondary" className="max-md:min-h-11" loading={busy === 'new'} disabled={!added.trim()} disabledReason="Enter a name"
                onClick={() => void run('new', async () => { await api.post(path, { label: added.trim() }); setAdded(''); }, addedMsg)}>Add</Button>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

/** The contract types (PS, PS GRR, RTR, ...): the code staff say, its label and package, and the income model the owner
 *  statement works it out by. The six income models themselves stay in code. */
function ContractTypesTab() {
  const toast = useToast();
  const ct = useContractTypesPayload();
  const list = ct.data?.data ?? [];
  const canEdit = !!ct.data?.ready && !!ct.data.mayEdit;
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<{ initial?: ContractType } | null>(null);
  const path = (code: string): string => `/contract-types/${encodeURIComponent(code)}`;
  async function run(key: string, call: () => Promise<unknown>, done: string): Promise<void> {
    setBusy(key);
    try { await call(); toast({ tone: 'success', title: done }); ct.reload(); }
    catch (e) { notifyFailure(e); }
    finally { setBusy(null); }
  }
  /** Swaps two neighbours; the whole order is saved in one request. */
  const move = (i: number, dir: -1 | 1): Promise<void> => {
    const codes = list.map(t => t.code);
    [codes[i], codes[i + dir]] = [codes[i + dir], codes[i]];
    return run('move', () => api.post('/contract-types/order', { codes }), 'Order changed.');
  };
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <p className="m-0 text-copy text-muted-ink flex-1 basis-[240px]">The contract types a unit can take. Each one is worked out by one of the six income models. A hidden type stays on the contracts that have it. Each type also has options (owner fixed amount, agent share, no operator share, rent-out grid), so a new package is one income model plus the options ticked.</p>
        {canEdit && <Button size="sm" variant="primary" className="max-md:min-h-11" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal({})}>Add contract type</Button>}
      </div>
      {ct.data && !ct.data.ready && <p className="m-0 mb-3 text-meta text-warning">The contract types cannot be changed on this database yet.</p>}
      {ct.error && <StaleBanner message={ct.data ? `Showing the last list we have. ${ct.error}` : ct.error} onRetry={ct.reload} />}
      {ct.loading && !ct.data ? <SkeletonRows rows={6} /> : !ct.data ? null : (
        <Card>
          <ul className="m-0 p-0 list-none divide-y divide-line-soft">
            {list.map((t, i) => (
              <li key={t.code} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 px-5">
                <div className="flex flex-col gap-0.5 min-w-0 flex-1 basis-[240px]">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-copy font-semibold">{codeName(list, t.code)}</span>
                    {!t.isActive && <StatusBadge tone="neutral" label="Hidden" size="sm" />}
                    {t.isDefaultForModel && <StatusBadge tone="info" label="Default for its model" size="sm" />}
                  </span>
                  <span className="text-copy [overflow-wrap:anywhere]">{t.label}</span>
                  <span className="text-meta text-muted-ink [overflow-wrap:anywhere]">
                    {[MODELS.find(m => m.key === t.revenueModel)?.label ?? t.revenueModel, ...fittingOptions(t.revenueModel).filter(o => t[o.key]).map(o => o.short), plural(t.contracts ?? 0, 'contract')].join(' · ')}
                  </span>
                </div>
                {canEdit && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="secondary" className="max-md:min-h-11" onClick={() => setModal({ initial: t })}>Edit</Button>
                    <Button size="sm" variant="tertiary" className="max-md:min-h-11" loading={busy === `${t.code}:active`}
                      onClick={() => void run(`${t.code}:active`, () => api.patch(path(t.code), { isActive: !t.isActive }), t.isActive ? 'Contract type hidden.' : 'Contract type shown again.')}>
                      {t.isActive ? 'Hide' : 'Show'}
                    </Button>
                    <Button size="sm" variant="tertiary" className="max-md:min-h-11" aria-label={`Move ${t.code} up`} disabled={i === 0 || busy === 'move'} disabledReason="Already first" onClick={() => void move(i, -1)}>Up</Button>
                    <Button size="sm" variant="tertiary" className="max-md:min-h-11" aria-label={`Move ${t.code} down`} disabled={i === list.length - 1 || busy === 'move'} disabledReason="Already last" onClick={() => void move(i, 1)}>Down</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {modal && <ContractTypeModal initial={modal.initial} canSetOptions={!!ct.data?.optionsReady} onClose={() => setModal(null)} onSaved={() => { setModal(null); ct.reload(); }} />}
    </>
  );
}

function ContractTypeModal({ initial, canSetOptions, onClose, onSaved }: { initial?: ContractType; canSetOptions: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState(initial?.code ?? '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [pkg, setPkg] = useState(initial?.package ?? '');
  const [model, setModel] = useState<RevenueModel>(initial?.revenueModel ?? 'management');
  const [blurb, setBlurb] = useState(initial?.blurb ?? '');
  const [isDefault, setIsDefault] = useState(initial?.isDefaultForModel ?? false);
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const used = initial?.contracts ?? 0;
  const [options, setOptions] = useState<ContractTypeOptions>(initial ?? plainOptions('', 'management'));
  const modelLocked = !!initial && (used > 0 || initial.isDefaultForModel);
  const optionsLocked = !canSetOptions || used > 0;
  const shownOptions = fittingOptions(model);
  const optionsBody = Object.fromEntries(shownOptions.map(o => [o.key, options[o.key]]));
  const ok = label.trim() !== '' && (!!initial || code.trim() !== '');
  function pickModel(next: RevenueModel): void {
    setModel(next);
    setOptions(plainOptions('', next));
  }
  async function submit(): Promise<void> {
    setSaving(true);
    try {
      const common = { label: label.trim(), package: pkg.trim() || null, blurb: blurb.trim() || null };
      if (initial) {
        await api.patch(`/contract-types/${encodeURIComponent(initial.code)}`, { ...common, ...(modelLocked ? {} : { revenueModel: model }), ...(optionsLocked ? {} : optionsBody), ...(isDefault && !initial.isDefaultForModel ? { isDefaultForModel: true } : {}) });
      } else {
        await api.post('/contract-types', { ...common, ...(optionsLocked ? {} : optionsBody), code: code.trim(), revenueModel: model, isDefaultForModel: isDefault });
      }
      toast({ tone: 'success', title: initial ? 'Contract type saved.' : 'Contract type added.' });
      onSaved();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setFields(e.fields);
      notifyFailure(e);
    } finally { setSaving(false); }
  }
  return (
    <CentreModal title={initial ? `Edit ${initial.code}` : 'Add contract type'} sub={initial ? 'The code stays as it is, because contracts point at it.' : 'The code cannot be changed once it is added.'} onClose={onClose}
      footer={<><Button size="sm" variant="secondary" className="max-md:min-h-11" onClick={onClose}>Cancel</Button><Button size="sm" variant="primary" className="max-md:min-h-11" loading={saving} disabled={!ok} disabledReason="Fill the code and the name" onClick={() => void submit()}>{initial ? 'Save' : 'Add'}</Button></>}>
      {!initial && <Field label="Code" placeholder="e.g. PS PLUS" value={code} maxLength={20} error={fields.code} style={{ minHeight: 44 }}
        onChange={e => { setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9 ]/g, '')); setFields(f => ({ ...f, code: '' })); }} />}
      <Field label="Name" placeholder="e.g. Airbnb profit sharing" value={label} maxLength={80} error={fields.label} style={{ minHeight: 44 }} onChange={e => setLabel(e.target.value)} />
      <Field label="Package" placeholder="e.g. Package A" help="Leave empty if it has none." value={pkg} maxLength={30} error={fields.package} style={{ minHeight: 44 }} onChange={e => setPkg(e.target.value)} />
      <Labeled label="Income model" help={modelLocked ? (used > 0 ? `${plural(used, 'contract')} use this type, so its income model is fixed.` : 'This is the default for its model. Make another type the default to change it.') : MODELS.find(m => m.key === model)?.statement}>
        <FormSelect label="Income model" value={model} disabled={modelLocked} onChange={v => { const next = MODELS.find(m => m.key === v); if (next) pickModel(next.key); }}
          options={MODELS.filter(m => m.key !== 'grr' || m.key === model).map(m => ({ value: m.key, label: m.label }))} />
        {fields.revenueModel && <span className="text-caption text-critical">{fields.revenueModel}</span>}
      </Labeled>
      {shownOptions.length > 0 && (
        <fieldset className="m-0 p-0 border-0 flex flex-col gap-1 min-w-0">
          <legend className="p-0 mb-1 text-meta font-medium text-muted-ink">Options</legend>
          {shownOptions.map(o => (
            <label key={o.key} className={`flex items-start gap-2 text-copy min-h-11 ${optionsLocked ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
              <input type="checkbox" checked={options[o.key]} disabled={optionsLocked} onChange={e => setOptions(prev => ({ ...prev, [o.key]: e.target.checked }))} className="mt-[3px] accent-[var(--color-gold-ink)]" />
              <span>{o.label} <span className="block text-meta text-muted-ink">{o.hint}</span>
                {fields[o.key] && <span className="block text-caption text-critical">{fields[o.key]}</span>}
              </span>
            </label>
          ))}
          {optionsLocked && <span className="text-caption text-muted-ink">{used > 0 ? `${plural(used, 'contract')} use this type, so its options are fixed. Add a new type for other options.` : 'The options cannot be changed on this database yet.'}</span>}
        </fieldset>
      )}
      <Field label="What it means" placeholder="One line staff can read" value={blurb} maxLength={200} error={fields.blurb} style={{ minHeight: 44 }} onChange={e => setBlurb(e.target.value)} />
      <label className="flex items-start gap-2 text-copy cursor-pointer min-h-11">
        <input type="checkbox" checked={isDefault} disabled={initial?.isDefaultForModel} onChange={e => setIsDefault(e.target.checked)} className="mt-[3px] accent-[var(--color-gold-ink)]" />
        <span>The default for its income model <span className="block text-meta text-muted-ink">{initial?.isDefaultForModel ? 'To change this, make another type the default.' : 'Read for a contract that has no saved type. Only one type per model.'}</span></span>
      </label>
    </CentreModal>
  );
}
