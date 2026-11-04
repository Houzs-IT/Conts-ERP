import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { NumberInput } from '../../components/inputs';
import { SearchSelect } from '../../components/Select';
import { EmptyState } from '../../components/States';
import PageHeader from '../../components/PageHeader';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { useApi } from '../../lib/useApi';
import { useLeaveGuard } from '../../lib/useLeaveGuard';
import { useSession } from '../../lib/session';
import { api, ApiFailure, errorMessage, notifyFailure } from '../../lib/api';
import { titleCase } from '../../lib/format';
import { cx } from '../../lib/design-tokens';
import { PURPOSES, USED_BY, offeredTypes } from '../../lib/revenueModel';
import { useContractTypes } from '../../lib/useContractTypes';
import { BedsEditor, BaysEditor } from './UnitExtras';
import { BuildingModal, useOwnerOptions } from './UnitForms';
import { ContractFields, blankDraft, bodyOf, problems, type Draft } from './contractForm';
import { PROPERTIES_FALLBACK } from './fallback';
import { EMPTY_FORM, STEPS, hasInput, layoutToSave, stepAt, stepOfField, stepProblems, type AddUnitForm, type StepIndex } from './addUnitRules';
import { mayEditUnits, isPlaceholderOwner, layoutFromBedrooms, useLayoutTypes, SectionHead, Grid3, NumberRow, Labeled, Select, ReadOnly, type Building, type PropertiesPayload } from './shared';

interface NewUnitBody {
  buildingId: string; ownerId?: string; listingName: string; unitCode: string; address?: string;
  purpose: string; usedBy: string | null; layoutType: string | null;
  bedrooms?: number; bathrooms?: number; sizeSqft: number | null;
  beds: AddUnitForm['beds']; parkingBays: AddUnitForm['parkingBays'];
}

// A blank number box is left out so the server's default applies.
function bodyOfForm(f: AddUnitForm, layout: string | null): NewUnitBody {
  return {
    buildingId: f.buildingId, ...(f.ownerId ? { ownerId: f.ownerId } : {}),
    listingName: f.listingName.trim(), unitCode: f.unitCode.trim(), ...(f.address.trim() ? { address: f.address.trim() } : {}),
    purpose: f.purpose, usedBy: f.usedBy || null, layoutType: layout,
    ...(f.bedrooms != null ? { bedrooms: f.bedrooms } : {}), ...(f.bathrooms != null ? { bathrooms: f.bathrooms } : {}), sizeSqft: f.sizeSqft,
    beds: f.beds, parkingBays: f.parkingBays,
  };
}

function contractProblems(d: Draft): Record<string, string> {
  if (!d.contractCode) return { contractCode: 'Pick a package.' };
  const p = problems(d);
  if (!d.startsOn) p.startsOn = 'Enter the start date.';
  else if (d.renewsOn && d.renewsOn <= d.startsOn) p.renewsOn = 'Renewal must be after the start date.';
  return p;
}

export default function AddUnitPage(): ReactElement {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useSession();
  const canEdit = mayEditUnits(user);
  const [params] = useSearchParams();
  const types = useContractTypes();
  const props = useApi<PropertiesPayload>('/properties', PROPERTIES_FALLBACK);
  const { owners, loading: ownersLoading, error: ownersError, reload: reloadOwners } = useOwnerOptions(canEdit);
  const layoutTypes = useLayoutTypes();
  const [dialog, ask] = useConfirm();

  const [form, setForm] = useState<AddUnitForm>(() => ({ ...EMPTY_FORM, buildingId: params.get('building') ?? '' }));
  const [draft, setDraft] = useState<Draft>(() => blankDraft());
  const [step, setStep] = useState<StepIndex>(0);
  const [tried, setTried] = useState<readonly boolean[]>([false, false, false]);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [contractErrors, setContractErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [addingBuilding, setAddingBuilding] = useState(false);
  const linkChecked = useRef(false);

  const buildings = useMemo(() => [...(props.data?.buildings ?? [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })), [props.data]);
  const building = buildings.find(b => b.id === form.buildingId);
  // An old link can carry a ?building= that is no longer on the list.
  useEffect(() => {
    if (!props.data || props.loading || linkChecked.current) return;
    linkChecked.current = true;
    setForm(f => (f.buildingId && !props.data?.buildings.some(b => b.id === f.buildingId) ? { ...f, buildingId: '' } : f));
  }, [props.data, props.loading]);

  const typeOptions = (layoutTypes.data?.data ?? []).filter(t => t.isActive);
  const suggested = layoutFromBedrooms(form.bedrooms);
  const layout = layoutToSave(form.layoutType, suggested, typeOptions.map(t => t.key));

  const edit = (p: Partial<AddUnitForm>): void => {
    setForm(f => ({ ...f, ...p }));
    setServerErrors(e => Object.fromEntries(Object.entries(e).filter(([k]) => !(k in p))));
  };
  const editDraft = (p: Partial<Draft>): void => { setDraft(d => ({ ...d, ...p })); setContractErrors({}); };

  const contractTouched = JSON.stringify(draft) !== JSON.stringify(blankDraft());
  const dirty = hasInput(form, contractTouched) && !finished;
  useLeaveGuard(dirty, async () => {
    const left = await ask({ title: 'Leave without adding the unit?', danger: true, confirmLabel: 'Leave', cancelLabel: 'Stay',
      body: createdId ? 'The unit is already added, but its contract is not saved yet. Leaving now throws the contract away.' : 'You have typed details that are not saved. Leaving now throws them away.' });
    return left !== null;
  }, []);

  const hasOwner = !!form.ownerId;
  const own = step === 2 ? (hasOwner ? contractProblems(draft) : {}) : stepProblems(step, form);
  // The contract step shows its problems at once, as the Contract tab does.
  const shownErrors = { ...(step < 2 && tried[step] ? own : {}), ...serverErrors };
  const blocked = Object.values(own)[0];
  const markTried = (s: StepIndex): void => setTried(t => t.map((v, i) => v || i === s));
  const fieldError = (k: string): ReactElement | false => !!shownErrors[k] && <span className="text-caption text-critical">{shownErrors[k]}</span>;

  async function submit(): Promise<void> {
    if (saving) return;
    const first = ([0, 1] as const).find(s => Object.keys(stepProblems(s, form)).length > 0);
    if (!createdId && first !== undefined) { markTried(first); setStep(first); return; }
    setSaving(true);
    try {
      let id = createdId;
      if (!id) {
        try {
          const r = await api.post<{ id: string }>('/units', bodyOfForm(form, layout));
          id = r.id;
          setCreatedId(id);
        } catch (e) {
          if (e instanceof ApiFailure && e.fields && Object.keys(e.fields).length > 0) {
            setServerErrors(e.fields);
            setStep(stepAt(Math.min(...Object.keys(e.fields).map(stepOfField))));
          }
          notifyFailure(e);
          return;
        }
      }
      if (hasOwner) {
        try {
          await api.put(`/units/${encodeURIComponent(id)}/contract`, { ...bodyOf(draft), mode: 'update' });
        } catch (e) {
          if (e instanceof ApiFailure && e.fields) setContractErrors(e.fields);
          toast({ tone: 'critical', title: 'The unit was added, but its contract was not saved.', body: errorMessage(e, 'Check the contract below and save it again.') });
          return;
        }
      }
      // The guard must see "nothing to lose" before the move below.
      flushSync(() => setFinished(true));
      toast({ tone: 'success', title: 'Unit added.', body: hasOwner ? 'Its contract is saved.' : 'No owner yet: pick the owner on its Details tab, then add the contract.' });
      navigate(`/properties/units/${encodeURIComponent(id)}?tab=details`);
    } finally { setSaving(false); }
  }

  async function addBuilding(b: Omit<Building, 'id'>): Promise<void> {
    try {
      const r = await api.post<{ id: string }>('/properties', b);
      setAddingBuilding(false);
      toast({ tone: 'success', title: 'Building added.', body: `${b.name} is picked for this unit.` });
      edit({ buildingId: r.id });
      props.reload();
    } catch (e) { notifyFailure(e); }
  }

  if (!canEdit) {
    return <Card><EmptyState bare icon="Building2" title="You cannot add units" body="Only managers can add a unit. Ask a manager, or open the Units page to see the list." /></Card>;
  }

  const last = step === 2;
  const nextLabel = last ? (createdId ? 'Save contract' : 'Add unit') : 'Next';
  const tabs = (
    <nav aria-label="Add unit steps" className="px-5 pt-5">
      <p className="m-0 mb-2 text-meta text-muted-ink">Step {step + 1} of {STEPS.length}</p>
      <ol className="m-0 p-0 list-none grid grid-cols-3 gap-2">
        {STEPS.map((label, i) => (
          <li key={label} className="min-w-0">
            {/* A done step can be opened again; a later one only through Next, so its checks run. */}
            <button type="button" aria-current={step === i ? 'step' : undefined} disabled={i > step} onClick={() => setStep(stepAt(i))}
              className="w-full min-h-11 md:min-h-9 p-0 bg-transparent border-none text-left flex flex-col gap-1.5 enabled:cursor-pointer disabled:cursor-default">
              <span aria-hidden className={cx('block h-1.5 w-full rounded-full', i <= step ? 'bg-ink' : 'bg-line')} />
              <span className={cx('block truncate text-meta', step === i ? 'font-semibold text-ink' : i < step ? 'text-ink' : 'text-muted-ink')}>{label}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );

  return (
    <div className="flex flex-col gap-5 min-w-0 max-w-[960px]">
      <PageHeader title="Add unit" sub="Fill in the unit and its contract. Nothing is saved until the last step." back={{ label: 'Units', onClick: () => navigate('/properties/units') }} />
      <Card>
        {tabs}
        <div className="p-5">
          {createdId && <div className="mb-5 py-[10px] px-[14px] rounded-control bg-gold-tint text-copy">The unit is added. Only its contract is left to save.</div>}
          {step < 2 && (
            <fieldset disabled={!!createdId} className="m-0 p-0 border-0 min-w-0">
              {step === 0 && <>
                {(props.error || ownersError) && (
                  <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 py-[10px] px-[14px] rounded-control bg-critical-bg text-danger text-copy">
                    <span>{props.error ? `The building list did not load. ${props.error}` : `The owner list did not load, so owners cannot be picked yet. ${ownersError}`}</span>
                    <Button size="sm" variant="secondary" onClick={() => { if (props.error) props.reload(); if (ownersError) reloadOwners(); }}>Retry</Button>
                  </div>
                )}
                <SectionHead>Listing</SectionHead>
                <Grid3>
                  <Labeled label="Owner" help={hasOwner ? 'Picked from the owner profiles.' : 'Optional. Left empty, the unit waits under "Owner to be confirmed" until you pick one on its Details tab.'}>
                    <SearchSelect label="Owner" size="md" value={form.ownerId} onChange={v => edit({ ownerId: v })} allLabel="Leave empty: Owner to be confirmed"
                      placeholder={ownersLoading ? 'Loading owners' : 'Search owners'}
                      options={(owners ?? []).filter(o => !isPlaceholderOwner(o.displayName)).map(o => ({ value: o.id, label: titleCase(o.displayName), hint: o.units.length ? `${o.units.length} ${o.units.length === 1 ? 'unit' : 'units'}` : undefined }))} />
                    {fieldError('ownerId')}
                  </Labeled>
                  <Labeled label="Listing name *" help="Exactly as published on the channels">
                    <Field label="" aria-label="Listing name" value={form.listingName} error={shownErrors.listingName} onChange={e => edit({ listingName: e.target.value })} />
                  </Labeled>
                  <Labeled label="Unit code *" help="Building prefix plus unit, created by The Conts">
                    <Field label="" aria-label="Unit code" value={form.unitCode} error={shownErrors.unitCode} onChange={e => edit({ unitCode: e.target.value })} />
                  </Labeled>
                  <Labeled label="Building *">
                    <Select label="Building" value={form.buildingId} onChange={v => edit({ buildingId: v })}
                      options={[...(form.buildingId ? [] : [{ value: '', label: props.loading ? 'Loading buildings' : 'Pick a building' }]), ...buildings.map(b => ({ value: b.id, label: b.name }))]} />
                    {fieldError('buildingId')}
                    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <button type="button" onClick={() => setAddingBuilding(true)} className="p-0 bg-transparent border-none cursor-pointer [font-family:inherit] text-meta font-semibold text-gold-ink max-md:min-h-11">Add building</button>
                      <a href="/properties/settings?tab=buildings" target="_blank" rel="noopener noreferrer" className="text-meta font-semibold text-gold-ink no-underline max-md:inline-flex max-md:items-center max-md:min-h-11">Edit the building list</a>
                    </span>
                  </Labeled>
                  <Labeled label="State" help="Set on the building. Edit the building to change it.">
                    <ReadOnly>{building?.state ?? 'Pick a building'}</ReadOnly>
                  </Labeled>
                  <Labeled label="Address" span2>
                    <Field label="" aria-label="Address" placeholder={building?.city} value={form.address} error={shownErrors.address} onChange={e => edit({ address: e.target.value })} />
                  </Labeled>
                </Grid3>

                <SectionHead>What the unit is for</SectionHead>
                <Grid3>
                  <Labeled label="Purpose *" help={PURPOSES.find(p => p.value === form.purpose)?.help}>
                    <Select label="Purpose" value={form.purpose} onChange={v => edit({ purpose: v })}
                      options={[...(form.purpose ? [] : [{ value: '', label: 'Pick one' }]), ...PURPOSES.map(p => ({ value: p.value, label: p.label }))]} />
                    {fieldError('purpose')}
                  </Labeled>
                  <Labeled label="Used by" help="Optional: which business uses the unit.">
                    <Select label="Used by" value={form.usedBy} onChange={v => edit({ usedBy: v })} options={[{ value: '', label: 'Not set' }, ...USED_BY]} />
                    {fieldError('usedBy')}
                  </Labeled>
                </Grid3>
              </>}

              {step === 1 && <>
                <SectionHead>Type and size</SectionHead>
                <Grid3>
                  <Labeled label="Type" className="sm:max-w-[320px]" help={!form.layoutType && layout ? `Suggested from ${form.bedrooms === 0 ? 'no bedrooms' : `${form.bedrooms} ${form.bedrooms === 1 ? 'bedroom' : 'bedrooms'}`}.` : undefined}>
                    <Select label="Type" value={layout ?? ''} onChange={v => edit({ layoutType: v })}
                      options={[...(layout ? [] : [{ value: '', label: 'Not set' }]), ...typeOptions.map(t => ({ value: t.key, label: t.label }))]} />
                    {fieldError('layoutType')}
                  </Labeled>
                </Grid3>
                <NumberRow>
                  <Labeled label="Bedrooms" help="0 = studio" className="w-24">
                    <NumberInput label="" aria-label="Bedrooms" min={0} max={20} value={form.bedrooms} onChange={n => edit({ bedrooms: n })} error={shownErrors.bedrooms} />
                  </Labeled>
                  <Labeled label="Bathrooms" className="w-24">
                    <NumberInput label="" aria-label="Bathrooms" min={0} max={20} value={form.bathrooms} onChange={n => edit({ bathrooms: n })} error={shownErrors.bathrooms} />
                  </Labeled>
                  <Labeled label="Size (sq ft)" help="Built-up area" className="w-28">
                    <NumberInput label="" aria-label="Size in square feet" min={1} max={100000} value={form.sizeSqft} onChange={n => edit({ sizeSqft: n })} error={shownErrors.sizeSqft} />
                  </Labeled>
                  <p className="basis-full m-0 -mt-1 text-caption text-muted-ink">Bedrooms or bathrooms left blank save as 1.</p>
                </NumberRow>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-4">
                  <div className="flex flex-col gap-2 min-w-0">
                    <SectionHead noMargin>Beds and mattresses</SectionHead>
                    <BedsEditor beds={form.beds} onChange={beds => edit({ beds })} />
                    {fieldError('beds')}
                  </div>
                  <div className="flex flex-col gap-2 min-w-0">
                    <SectionHead noMargin>Car park</SectionHead>
                    <BaysEditor bays={form.parkingBays} onChange={parkingBays => edit({ parkingBays })} />
                    {fieldError('parkingBays')}
                  </div>
                </div>
              </>}
            </fieldset>
          )}

          {step === 2 && (
            hasOwner ? (
              <div className="flex flex-col gap-5 min-w-0">
                <SectionHead noMargin>Contract</SectionHead>
                <ContractFields d={draft} set={editDraft} errors={{ ...contractProblems(draft), ...contractErrors }} types={types} offered={offeredTypes(types)} label="Package"
                  afterSelect={!draft.contractCode && <p className="m-0 text-meta text-muted-ink">Pick a package to see the boxes it needs.</p>} />
              </div>
            ) : (
              <div className="py-[10px] px-[14px] rounded-control bg-muted text-copy">No owner yet. Add the contract on the Contract tab once the owner is set.</div>
            )
          )}
        </div>
      </Card>
      {/* In the flow, not sticky: a sticky bar floated over the boxes being filled on a phone. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3 px-5 bg-card rounded-card [border:1px_solid_var(--color-line)]">
        {blocked && <p role="status" className={cx('m-0 w-full text-meta', tried[step] ? 'text-critical' : 'text-muted-ink')}>{blocked}</p>}
        <Button size="md" variant="secondary" className="max-md:min-h-11" disabled={step === 0} disabledReason="This is the first step" onClick={() => setStep(s => stepAt(s - 1))}>Back</Button>
        <Button size="md" variant="primary" className="max-md:min-h-11" loading={saving}
          onClick={() => { if (blocked) markTried(step); else if (last) void submit(); else setStep(s => stepAt(s + 1)); }}>{nextLabel}</Button>
      </div>
      {addingBuilding && <BuildingModal onClose={() => setAddingBuilding(false)} onSubmit={b => void addBuilding(b)} />}
      {dialog}
    </div>
  );
}
