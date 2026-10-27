import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { color, channel as CH } from '../theme';
import { cx } from '../lib/design-tokens';
import { Card } from '../components/Card';
import { CoverPhotoDrop } from '../components/Attachments';
import { Eyebrow, Figure, SectionTitle } from '../components/Metric';
import PageHeader from '../components/PageHeader';
import { EmptyState } from '../components/States';
import { Select } from '../components/Select';
import { StatusBadge, StatusDot } from '../components/StatusBadge';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import ChannelMark from '../components/ChannelMark';
import ChannexChannelsCard from '../components/ChannexChannelsCard';
import { StaleBanner } from '../components/DataState';
import { RecordSkeleton, TreeSkeleton } from './units/UnitsSkeleton';
import { UnitList } from './units/UnitList';
import { useApi } from '../lib/useApi';
import { api, notifyFailure, downloadFile, ApiFailure, errorMessage } from '../lib/api';
import { useConfirm } from '../components/ConfirmDialog';
import { PurposeBadge, CodeBadge } from './units/UnitExtras';
import LettingTab from './units/LettingTab';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { rm, dateRange, date, monthLabel, plural, titleCase } from '../lib/format';
import type { UnitReadiness } from '../lib/types';
import UnitTree, { firstUnitId } from './units/UnitTree';
import AccessTab from './units/AccessTab';
import BookingsTab from './units/BookingsTab';
import JobsTab from './units/JobsTab';
import FinancialsTab, { MonthStepper, useFinancialMonth } from './units/FinancialsTab';
import { SaveBar, DetailsForm, DocumentsCard, BuildingModal, ConfirmAdd, AddUnitModal } from './units/UnitForms';
import { UnitCostsCard, BillModal } from './owners/Costs';
import ContractTab, { ModelChip } from './units/ContractTab';
import { PROPERTIES_FALLBACK, DETAIL_FALLBACK, mkUnit } from './units/fallback';
import { RecordHistory } from '../components/RecordHistory';
import {
  mayEditUnits, STATES, layoutFromBedrooms,
  type Unit, type Building, type PropertiesPayload, type UnitDetail, type RosterRow,
} from './units/shared';
import { statusLabel, statusOf, TONE_STYLE } from '../lib/status';
import { PnlTable } from './units/PnlTable';
import { stayPhase, stayWho } from '../lib/bookingStatus';

/** True at the width where the tree becomes a sticky pane (Tailwind xl). */
/** True at 768px and up: the unit record uses tabs; below it the sections stack. */
function useSmUp() {
  const q = '(min-width: 768px)';
  const read = () => typeof window !== 'undefined' && 'matchMedia' in window && window.matchMedia(q).matches;
  const [v, setV] = useState(read);
  useEffect(() => { if (typeof window === 'undefined' || !('matchMedia' in window)) return; const m = window.matchMedia(q); const f = () => setV(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  return v;
}

function useWide() {
  const q = '(min-width: 1280px)';
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q), f = () => setOn(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return on;
}

/** The unit lifecycle states an operator can set by hand, in the order they read on the record. */
const READINESS_OPTIONS: UnitReadiness[] = ['ready', 'occupied', 'cleaning', 'dirty', 'inspection', 'maintenance', 'blocked'];

// Short labels so the eight tabs sit on one row; the title carries the full name.
const TABS = [
  ['overview', 'Overview', 'Overview'], ['details', 'Details', 'Details and owner'], ['contract', 'Contract', 'Contract and documents'],
  ['access', 'Access', 'Access and keys'], ['reservations', 'Reservations', 'Reservations'], ['operations', 'Jobs', 'Cleaning, maintenance and fit-out'],
  ['financials', 'Financials', 'Financials'], ['letting', 'Agent to let', 'Agent to let: finding a long-term tenant for the owner'], ['activity', 'History', 'History of changes'],
] as const;
type Tab = typeof TABS[number][0];
/** The Reservations and Jobs tabs' filters and paging in the address. */
const TAB_PARAMS = ['fmonth', 'when', 'from', 'to', 'page', 'size', 'jfrom', 'jto', 'clean', 'repair'];
const isTab = (t: string | null): t is Tab => TABS.some(([k]) => k === t);

type Modal = null | { kind: 'building' } | { kind: 'editBuilding'; building: Building } | { kind: 'unit'; buildingId: string } | { kind: 'subunit'; buildingId: string; parent: Unit };

/** Units: the building and unit tree on the left, the whole record of the chosen unit on the right.
 *  Replaces the separate Properties, Units and Access and keys screens (old addresses redirect here, App.tsx). */
export default function UnitsPage({ unitId }: { unitId: string }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const { user } = useSession();
  const canEdit = mayEditUnits(user);
  const wide = useWide();

  const props = useApi<PropertiesPayload>('/properties', PROPERTIES_FALLBACK);
  const roster = useApi<{ data: RosterRow[] }>('/units');
  const [edits, setEdits] = useState<Record<string, Partial<Unit>>>({});
  const [readinessEdits, setReadinessEdits] = useState<Record<string, UnitReadiness>>({});
  const [modal, setModal] = useState<Modal>(null);
  const [treeOpen, setTreeOpen] = useState(!unitId);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const inFlight = useRef(false);
  const [dialog, ask] = useConfirm();
  // The open tab lives in the address (?tab=), so a link or a reload lands on the same tab.
  const tabParam = params.get('tab');
  const tab: Tab = isTab(tabParam) ? tabParam : 'overview';
  const setTab = (t: Tab) => setParams(p => {
    const n = new URLSearchParams(p);
    if (t === 'overview') n.delete('tab'); else n.set('tab', t);
    // A tab's own filters and page do not carry over to another tab.
    for (const k of TAB_PARAMS) n.delete(k);
    return n;
  }, { replace: true });

  const buildings = props.data?.buildings ?? [];
  const units = useMemo(() => (props.data?.units ?? []).map(u => ({ ...u, ...edits[u.id] })), [props.data, edits]);
  const original = props.data?.units ?? [];
  const readiness = useMemo(() => {
    const m: Record<string, UnitReadiness> = {};
    (roster.data?.data ?? []).forEach(r => { m[r.id] = r.readiness; });
    return { ...m, ...readinessEdits };
  }, [roster.data, readinessEdits]);

  // An address with no unit (or one that no longer exists) opens the first unit in the tree.
  const openId = unitId && (!props.data || units.some(u => u.id === unitId)) ? unitId : (firstUnitId(buildings, units) ?? unitId);
  const form = units.find(u => u.id === openId) ?? null;
  const detail = useApi<UnitDetail>(openId ? `/units/detail?unitId=${encodeURIComponent(openId)}` : null, DETAIL_FALLBACK);
  const d = detail.data;

  function select(id: string) {
    setTreeOpen(false);
    // The tab and the tree search carry over to the next unit; the Bookings filter and page do not.
    const next = new URLSearchParams();
    if (tab !== 'overview') next.set('tab', tab);
    const q = params.get('q');
    if (q) next.set('q', q);
    const search = next.toString();
    navigate({ pathname: `/properties/units/${encodeURIComponent(id)}`, search: search ? `?${search}` : '' });
  }

  const reloadAll = () => { props.reload(); detail.reload(); roster.reload(); };

  function patch(id: string, p: Partial<Unit>) { setEdits(e => ({ ...e, [id]: { ...e[id], ...p } })); }
  const dirty = !!form && !!edits[form.id];

  // Every write waits for the server; a refused save leaves the edits in place to correct and save again.
  async function save(endContract = false, quiet = false): Promise<void> {
    if (!form || inFlight.current) return;
    const sent = edits[form.id];
    const before = original.find(u => u.id === form.id);
    // The contract is saved on its own tab (PUT /units/:id/contract); never sent from here, so an older copy in
    // this form cannot overwrite it.
    // Owner and payout details belong to the owner and are edited on the owner's page; the old monthly costs list and
    // the cleaning price are saved on the Financials tab. None of them is sent from this form.
    // The nightly price is set on the Pricing page (PUT /rates), never from this form.
    const { baseRate: _rate, contract: _contract, revenueModel: _model, termsLabel: _terms, ownerName: _on, ic: _ic, bankName: _bn, bankAccount: _ba,
      accountHolder: _ah, expenses: _ex, cleaningPrice: _cp, deepCleaningPrice: _dcp, bedsLabel: _bl, parkingLabel: _pl, contractCode: _cc, ownerId, ...rest } = form;
    // An empty layout takes the one proposed from the bedrooms, as the form shows it.
    // The purpose, beds and bays go only when changed: a database without migration 0125 never sees them.
    const changed = (k: 'purpose' | 'usedBy' | 'beds' | 'parkingBays') => JSON.stringify(rest[k] ?? null) !== JSON.stringify(before?.[k] ?? null);
    const { purpose, usedBy, beds, parkingBays, ...plain } = rest;
    const body = {
      ...plain, layoutType: rest.layoutType ?? layoutFromBedrooms(rest.bedrooms), ...(ownerId && ownerId !== before?.ownerId ? { ownerId } : {}),
      ...(changed('purpose') ? { purpose } : {}), ...(changed('usedBy') ? { usedBy: usedBy ?? null } : {}), ...(changed('beds') ? { beds } : {}),
      ...(changed('parkingBays') ? { parkingBays: (parkingBays ?? []).map(b => ({ lotNumber: b.lotNumber, level: b.level, note: b.note })) } : {}),
      ...(endContract ? { endContract: true } : {}),
    };
    setSaving(true); inFlight.current = true;
    let retry = false;
    try {
      await api.patch(`/units/${form.id}`, body);
      if (!quiet) toast({ tone: 'success', title: 'Changes saved.', body: `${form.listingName || form.unitCode} updated.` });
      // Only what was sent is cleared: a box changed while this save was on its way stays, to be saved next.
      setEdits(e => { if (e[form.id] !== sent) return e; const n = { ...e }; delete n[form.id]; return n; });
      setSaveFailed(false);
      reloadAll();
    } catch (e) {
      setSaveFailed(true);
      // A new purpose the contract does not fit: say so, and on a yes end the contract and save again.
      if (e instanceof ApiFailure && e.code === 'CONTRACT_MISMATCH' && !endContract) {
        retry = (await ask({ title: 'End the current contract?', body: e.message, meta: 'The ended contract stays in the contract history of the unit.',
          confirmLabel: 'End contract and save', cancelLabel: 'Keep it', danger: true })) !== null;
      } else notifyFailure(e);
    }
    finally { setSaving(false); inFlight.current = false; }
    if (retry) await save(true, quiet);
  }
  // Moving the unit to another owner or building is never saved by leaving a box: it waits for Save, so a slip in a
  // list cannot move a unit (its contract stays with the previous owner).
  const kept = form ? original.find(u => u.id === form.id) : undefined;
  const moving = !!form && !!kept && ((!!form.ownerId && form.ownerId !== kept.ownerId) || form.buildingId !== kept.buildingId);
  // The Details tab saves itself when a box is left (staff sheet UNIT, 26 Oct 2026). A car park bay with no lot number
  // waits until it has one; a refused save waits for Save again, so the same error is not shown on every box.
  function autoSave() {
    if (!form || !dirty || inFlight.current || saveFailed || moving) return;
    if ((form.parkingBays ?? []).some(b => !b.lotNumber.trim())) return;
    void save(false, true);
  }
  // A box changed while a save was on its way is saved as soon as that save is back.
  useEffect(() => { if (!saving) autoSave(); }, [saving]); // eslint-disable-line react-hooks/exhaustive-deps
  // Another unit starts clean.
  useEffect(() => setSaveFailed(false), [openId]);
  // Delete only a unit added by mistake; anything with history is refused and offered Blocked instead.
  async function deleteUnit() {
    if (!form) return;
    const name = form.unitCode || form.listingName || 'this unit';
    if ((await ask({ title: `Delete ${name}?`, body: 'Only a unit with no reservations, statements, expenses, contracts or jobs can be deleted. It is removed for good, with its car park bays, access codes and files.',
      confirmLabel: 'Delete unit', cancelLabel: 'Keep it', danger: true })) === null) return;
    try {
      await api.del(`/units/${encodeURIComponent(form.id)}`);
      toast({ tone: 'success', title: 'Unit deleted.', body: `${name} is gone from the list.` });
      setEdits(e => { const n = { ...e }; delete n[form.id]; return n; });
      navigate('/properties/units');
      reloadAll();
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 409) {
        const block = await ask({ title: `${name} cannot be deleted`, body: e.message, meta: 'Blocked keeps its history and stops it being used; you can set it back to Ready at any time.',
          confirmLabel: 'Set to Blocked', cancelLabel: 'Leave it', danger: false });
        if (block === null) return;
        try {
          await api.patch(`/units/${form.id}/readiness`, { readiness: 'blocked' });
          toast({ tone: 'success', title: 'Unit blocked.', body: `${name} is out of use; its history is kept.` });
          reloadAll();
        } catch (err) { toast({ tone: 'critical', title: 'Not blocked.', body: errorMessage(err) }); }
      } else toast({ tone: 'critical', title: 'Unit was not deleted.', body: errorMessage(e) });
    }
  }
  async function addBuilding(b: Omit<Building, 'id'>) {
    try {
      await api.post<{ id: string }>('/properties', b);
      setModal(null);
      toast({ tone: 'success', title: 'Building added.', body: `${b.name} — add units to it.` });
      props.reload();
    } catch (e) { notifyFailure(e); }
  }
  async function saveBuilding(id: string, b: Omit<Building, 'id'>) {
    try {
      await api.patch(`/properties/${id}`, b);
      setModal(null);
      toast({ tone: 'success', title: 'Building updated.', body: b.name });
      reloadAll();
    } catch (e) { notifyFailure(e); }
  }
  async function deleteBuilding(b: Building) {
    try {
      await api.del(`/properties/${b.id}`);
      setModal(null);
      toast({ tone: 'success', title: 'Building deleted.', body: b.name });
      props.reload();
    } catch (e) { notifyFailure(e); }
  }
  async function createUnit(nu: ReturnType<typeof newUnit>, title: string, body: string) {
    try {
      const r = await api.post<{ id: string }>('/units', nu);
      setModal(null);
      toast({ tone: 'success', title, body });
      navigate(`/properties/units/${encodeURIComponent(r.id)}?tab=details`);
      props.reload(); roster.reload();
    } catch (e) { notifyFailure(e); }
  }
  // Only the unit's own fields go to the server; the owner is picked (a sub-unit takes its parent's).
  const newUnit = (u: Unit) => ({ id: u.id, buildingId: u.buildingId, parentUnitId: u.parentUnitId, ownerId: u.ownerId, listingName: '', unitCode: '', pkg: u.pkg, term: u.term, split: u.split, splitValue: u.splitValue });
  function addUnit(buildingId: string, ownerId: string) {
    const state = buildings.find(b => b.id === buildingId)?.state ?? STATES[0];
    void createUnit(newUnit(mkUnit(crypto.randomUUID(), buildingId, '', '', state, '', { ownerId })), 'Unit added.', 'Fill in its details below.');
  }
  function addSubUnit(buildingId: string, parent: Unit) {
    const nu = mkUnit(crypto.randomUUID(), buildingId, '', '', parent.state, '', { parentUnitId: parent.id, split: 'Profit share' });
    void createUnit(newUnit(nu), 'Sub-unit added.', 'Fill in its details below.');
  }

  // ?view=list shows every unit as one table instead of the tree and one record.
  const listMode = params.get('view') === 'list';
  const setListMode = (on: boolean) => setParams(p => { const n = new URLSearchParams(on ? '' : p); if (on) n.set('view', 'list'); else n.delete('view'); return n; }, { replace: true });
  const header = (
    <PageHeader title="Units" sub={props.data ? `${plural(units.length, 'unit')} · ${plural(buildings.length, 'building')}` : 'Loading units…'}
      actions={<Button size="sm" variant="secondary" icon={<Icon name={listMode ? 'FolderTree' : 'Table2'} size="sm" />} onClick={() => setListMode(!listMode)}>{listMode ? 'Tree and record' : 'List of all units'}</Button>}
      primary={canEdit ? <Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal({ kind: 'building' })}>Add building</Button> : undefined} />
  );

  const modals = <>
    {modal?.kind === 'building' && <BuildingModal onClose={() => setModal(null)} onSubmit={b => void addBuilding(b)} />}
    {modal?.kind === 'editBuilding' && <BuildingModal initial={modal.building} onClose={() => setModal(null)}
      onSubmit={b => void saveBuilding(modal.building.id, b)}
      onDelete={units.every(u => u.buildingId !== modal.building.id) ? () => void deleteBuilding(modal.building) : undefined} />}
    {modal?.kind === 'unit' && <AddUnitModal buildingName={buildings.find(b => b.id === modal.buildingId)?.name ?? 'this building'}
      onClose={() => setModal(null)} onConfirm={ownerId => addUnit(modal.buildingId, ownerId)} />}
    {modal?.kind === 'subunit' && <ConfirmAdd title={`Add a sub-unit under ${modal.parent.unitCode || 'this unit'}`}
      sub="A part of this unit let on its own, such as a bedroom or a floor." body="The sub-unit belongs to the same owner as its parent. You can give it its own code, split and expenses." confirm="Add sub-unit"
      onClose={() => setModal(null)} onConfirm={() => addSubUnit(modal.buildingId, modal.parent)} />}
  </>;

  if (listMode) {
    return (
      <div className="flex flex-col gap-5 min-w-0">
        {header}
        <UnitList units={units} buildings={buildings} readiness={readiness} loading={props.loading} error={props.error} onRetry={reloadAll} onOpen={select} />
        {modals}
      </div>
    );
  }
  if (props.loading && units.length === 0) {
    // The tree and the record as they will stand, so the page does not rearrange itself when the units arrive.
    return (
      <div className="flex flex-col gap-5 min-w-0">
        {header}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(300px,340px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(340px,380px)_minmax(0,1fr)] gap-5 items-start min-w-0">
          <div className="min-w-0 xl:h-[calc(100vh-100px)]">
            <div className="max-xl:hidden h-full"><TreeSkeleton fill /></div>
            <div aria-hidden className="xl:hidden h-[58px] bg-card border border-solid border-line rounded-card flex items-center gap-3 px-[14px]">
              <div className="skeleton h-[16px] w-[16px]" /><div className="flex flex-col gap-[6px] flex-1"><div className="skeleton h-[9px] w-[30%]" /><div className="skeleton h-[12px] w-[45%]" /></div>
            </div>
            {treeOpen && <div className="xl:hidden mt-2"><TreeSkeleton /></div>}
          </div>
          <RecordSkeleton />
        </div>
      </div>
    );
  }
  if (units.length === 0 && props.data) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <Card>
          <EmptyState bare icon="Building2" title="No units yet"
            body={buildings.length ? 'Add a unit with the + on a building.' : 'Add a building first, then add units to it.'}
            action={canEdit && !buildings.length ? { label: 'Add building', onClick: () => setModal({ kind: 'building' }) } : undefined} />
          {buildings.length > 0 && <div className="pb-4 px-4"><UnitTree buildings={buildings} units={units} selectedId="" readiness={readiness} canEdit={canEdit}
            onSelect={select} onEditBuilding={b => setModal({ kind: 'editBuilding', building: b })} onAddUnit={id => setModal({ kind: 'unit', buildingId: id })} onAddSubUnit={(bid, p) => setModal({ kind: 'subunit', buildingId: bid, parent: p })} /></div>}
        </Card>
        {modals}
      </div>
    );
  }

  const building = buildings.find(b => b.id === form?.buildingId);
  const unitLabel = form ? (form.unitCode || form.listingName || 'this unit') : d ? `${d.unit.propertyName} ${d.unit.unitNumber}` : 'this unit';

  return (
    <div className="flex flex-col gap-5 min-w-0">
      {header}
      {(props.error || detail.error) && <StaleBanner message={`Showing the last record we have. ${props.error ?? detail.error}`} onRetry={reloadAll} />}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(300px,340px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(340px,380px)_minmax(0,1fr)] gap-5 items-start min-w-0">
        {/* On a wide screen the tree is its own pane: it stays put under the top bar, as tall as the window, and
            scrolls by itself, so it never runs out while the record on the right scrolls. */}
        <div className="flex flex-col gap-2 min-w-0 xl:sticky xl:top-0 xl:h-[calc(100vh-100px)] xl:z-[1]">
          {/* Below the wide-desktop breakpoint the tree folds away behind a picker once a unit is open. */}
          <button onClick={() => setTreeOpen(o => !o)} aria-expanded={treeOpen}
            className="xl:hidden flex items-center gap-3 w-full py-[11px] px-[14px] bg-card border border-solid border-line rounded-card cursor-pointer [font-family:inherit] text-copy text-left">
            <Icon name="Building2" size="sm" color={color.textMuted} />
            <span className="flex-1 min-w-0">
              <span className="block text-caption text-muted-ink">{building?.name ?? 'Unit'}</span>
              <span className="block text-copy font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{form?.unitCode || form?.listingName || 'Choose a unit'}</span>
            </span>
            <span className="text-meta font-medium text-gold-ink flex-none">{treeOpen ? 'Close' : 'Change unit'}</span>
          </button>
          <div className={cx(treeOpen ? 'block' : 'hidden', 'xl:block min-w-0 xl:flex-1 xl:min-h-0')}>
            <UnitTree fill={wide} buildings={buildings} units={units} selectedId={openId} readiness={readiness} canEdit={canEdit}
              onSelect={select} onEditBuilding={b => setModal({ kind: 'editBuilding', building: b })}
              onAddUnit={id => setModal({ kind: 'unit', buildingId: id })} onAddSubUnit={(bid, p) => setModal({ kind: 'subunit', buildingId: bid, parent: p })} />
          </div>
        </div>

        <div className="flex flex-col gap-5 min-w-0">
          {!d ? (
            detail.error ? <Card><div className="p-10 text-center text-muted-ink text-copy">{detail.error}</div></Card> : <RecordSkeleton />
          ) : (
            <UnitRecord d={d} form={form} buildings={buildings} building={building} unitLabel={unitLabel}
              tab={tab} setTab={setTab} canEdit={canEdit} dirty={dirty} saving={saving} saveFailed={saveFailed} moving={moving} onSave={() => { setSaveFailed(false); void save(); }} onAutoSave={autoSave} onDelete={() => void deleteUnit()}
              onChange={p => form && patch(form.id, p)} reload={reloadAll} reloadDetail={detail.reload}
              readiness={readiness[d.unit.id] ?? d.unit.readiness}
              setReadiness={(id, r) => setReadinessEdits(m => { const n = { ...m }; if (r) n[id] = r; else delete n[id]; return n; })} />
          )}
        </div>
      </div>
      {modals}
      {dialog}
    </div>
  );
}

interface RecordProps {
  d: UnitDetail; form: Unit | null; buildings: Building[]; building: Building | undefined; unitLabel: string;
  tab: Tab; setTab: (t: Tab) => void; canEdit: boolean; dirty: boolean; saving: boolean; saveFailed: boolean; moving: boolean; onSave: () => void; onAutoSave: () => void; onDelete: () => void;
  onChange: (p: Partial<Unit>) => void; reload: () => void; reloadDetail: () => void;
  readiness: UnitReadiness; setReadiness: (id: string, r: UnitReadiness | null) => void;
}

function UnitRecord({ d, form, buildings, building, unitLabel, tab, setTab, canEdit, dirty, saving, saveFailed, moving, onSave, onAutoSave, onDelete, onChange, reload, reloadDetail, readiness, setReadiness }: RecordProps) {
  const toast = useToast();
  const { user } = useSession();
  // Same people as edit the unit's master data (the server's channex-setup / channex-connect).
  const canManageChannels = mayEditUnits(user);
  const wideRecord = useSmUp();
  const [fmonth, setFmonth] = useFinancialMonth();
  const [utilityBill, setUtilityBill] = useState(false);
  const [billsSaved, setBillsSaved] = useState(0);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // The newest photo is the unit's cover (also its card on the Owner Showcase).
  const cover = d.coverPhotoId ?? null;
  useEffect(() => { setPhoto(cover ? `/api/documents/${cover}/download` : null); }, [d.unit.id, cover]);

  const u = d.unit;
  const p = d.performance;
  const money = !!d.pnl;
  // A showroom or warehouse is never on the channels (0125): no channel card, no nightly price, no occupancy.
  const rental = (u.purpose ?? form?.purpose ?? 'rental') === 'rental';
  const openIssues = d.openMaintenanceCount ?? d.maintenance.filter(m => m.state !== 'resolved').length;
  // Financial sections are absent from the payload for roles without access, so that tab is not offered.
  const tabs = TABS.filter(([k]) => k !== 'financials' || money);
  const shown: Tab = tabs.some(([k]) => k === tab) ? tab : 'overview';
  // Phones (owner, Oct 2026): the record is one page you scroll down, not eight tabs you scroll sideways.
  // Each section keeps its own component and data; only the tab gate is lifted. Desktop is unchanged.
  const stacked = !wideRecord;
  const on = (k: Tab) => stacked || shown === k;
  // On a phone the strip scrolls sideways; keep the open tab in view (a link can land on the last one).
  useEffect(() => {
    const strip = tabsRef.current, el = strip?.querySelector<HTMLElement>(`[data-tab="${shown}"]`);
    if (strip && el && (el.offsetLeft < strip.scrollLeft || el.offsetLeft + el.offsetWidth > strip.scrollLeft + strip.clientWidth)) {
      strip.scrollLeft = el.offsetLeft - 20;
    }
  }, [shown]);
  // The P and L and the stats are both the current calendar month to date (units/detail.ts).
  const periodLabel = `${monthLabel(p.period)} to date`;

  function changeReadiness(next: UnitReadiness) {
    if (next === readiness) return;
    const prev = readiness;
    setReadiness(u.id, next);
    api.patch(`/units/${u.id}/readiness`, { readiness: next })
      .then(() => { toast({ tone: 'success', title: 'Status updated.', body: `${unitLabel} is now ${statusLabel('readiness', next)}.` }); reload(); })
      .catch(err => { setReadiness(u.id, prev === u.readiness ? null : prev); notifyFailure(err); });
  }
  function takeFile(file: File) {
    const fd = new FormData();
    fd.append('file', file); fd.append('unitId', u.id); fd.append('kind', 'photo');
    setUploading(true);
    api.post('/documents', fd)
      .then(() => { setPhoto(URL.createObjectURL(file)); toast({ tone: 'success', title: 'Photo added to this unit.', body: 'It will appear on the owner statement and channel listings.' }); reloadDetail(); })
      .catch(notifyFailure)
      .finally(() => setUploading(false));
  }
  function expensesReport() {
    if (!form) return;
    toast({ tone: 'info', title: 'Preparing report', body: `Expenses for ${unitLabel} — served as a download.` });
    downloadFile('/expenses/report', { unitId: form.id, period: fmonth }).catch(notifyFailure);
  }
  const needsForm = <Card><div className="p-8 text-center text-copy text-muted-ink">This unit's master data is not available to your role.</div></Card>;
  const title = form?.listingName || `${u.propertyName} ${u.unitNumber}`;
  const stem = unitLabel.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'unit';
  const subtitle = [form?.unitCode || u.unitNumber, building?.name ?? u.propertyName].filter(Boolean).join(' · ');

  return (
    <>
      <Card>
        <div className="pt-[14px] px-[14px] pb-0">
          <CoverPhotoDrop photo={photo} onPick={takeFile} busy={uploading} className="h-[96px] sm:h-[128px]"
            label="Add a photo of this unit" hint="Drop an image here, or click to browse" />
        </div>

        <div className="pt-[18px] px-5 sm:px-6 pb-4 flex items-start justify-between gap-6 flex-wrap">
          <div className="flex flex-col gap-[9px] min-w-0">
            <Eyebrow className="[overflow-wrap:anywhere]">{subtitle}</Eyebrow>
            <h2 className="m-0 text-title font-semibold tracking-[-0.01em] [overflow-wrap:anywhere]">{title}</h2>
            <span className="text-copy text-muted-ink">{form?.address || `${u.addressLine}, ${u.city}`}</span>
            <div className="flex items-center gap-3 flex-wrap">
              {/* One control for the state; the dot keeps its colour. A native select, so the list is never clipped by the card. */}
              {/* Each state has its colour (staff sheet UNIT): the box takes the current one, the list shows each row in its own. */}
              <span className="inline-flex items-center gap-2 [&_select]:[border-color:var(--tone)] [&_select]:[box-shadow:inset_3px_0_0_var(--tone)]" title="Change the unit state"
                style={{ ['--tone' as string]: TONE_STYLE[statusOf('readiness', readiness).tone].line }}>
                <StatusDot entity="readiness" value={readiness} />
                <Select label="Status" className="w-[150px]" value={readiness} onChange={v => changeReadiness(v as UnitReadiness)}
                  options={READINESS_OPTIONS.map(r => ({ value: r, label: statusLabel('readiness', r), color: TONE_STYLE[statusOf('readiness', r).tone].fg }))} />
              </span>
              {form?.parentUnitId && <StatusBadge tone="warning" label="Sub-unit" />}
              <PurposeBadge purpose={u.purpose} />
              <CodeBadge code={u.contractCode} />
              {u.revenueModel && (rental || u.contractCode) && <span title={`Income model: ${u.revenueModelLabel}. Change it on the Contract tab.`}><ModelChip model={u.revenueModel} label={u.termsLabel ?? u.revenueModelLabel} /></span>}
              {u.channels.length > 0 && (
                <span className="inline-flex items-center gap-1.5" aria-label={`Sold on ${u.channels.map(c => CH[c].label).join(', ')}`}>
                  {u.channels.map(c => <span key={c} title={CH[c].label} className="flex"><ChannelMark ch={c} size={22} /></span>)}
                </span>
              )}
              {!u.isListed && rental && <span title="This unit is not for sale on Airbnb, Booking.com or any other channel, so no reservations come in through them. Connect it under Channels on the Overview tab."><StatusBadge tone="neutral" label="Not listed on any channel" /></span>}
            </div>
          </div>
          {/* Owner names run long (several co-owners, company names); they wrap instead of running off a phone. */}
          <div className="flex flex-col gap-1 min-w-0 max-w-full sm:max-w-[45%] items-start">
            <Eyebrow>Owner</Eyebrow>
            <Link to={`/owners/${encodeURIComponent(u.owner.id)}`} className="text-heading font-semibold no-underline text-ink! [overflow-wrap:anywhere]">{titleCase(u.owner.name)}</Link>
            {u.contract && <span className="text-meta text-muted-ink">{u.termsLabel ?? `${u.contract.managementFeePct}%`} · {u.contract.renewsOn ? `renews ${date(u.contract.renewsOn)}` : 'No renewal date'}</span>}
          </div>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-[repeat(auto-fit,minmax(96px,1fr))] gap-x-4 gap-y-5 pt-5 px-5 sm:px-6 pb-5 [border-top:1px_solid_var(--color-line-soft)]">
          {(rental ? [
            ['Occupancy', `${p.occupancy}%`], ['Avg nightly price', rm(p.adr, { cents: false })], ['Earnings per night (all nights)', rm(p.revpar, { cents: false })],
            ['Rating', p.rating != null ? p.rating.toFixed(2) : '—'], ['Open maintenance jobs', String(openIssues)],
          ] : [['Purpose', u.purpose === 'warehouse' ? 'Warehouse' : 'Showroom'], ['Car park bays', form?.parkingBays?.length ? String(form.parkingBays.length) : '—'], ['Open maintenance jobs', String(openIssues)]]).map(([label, value]) => (
            <div key={label} className="flex flex-col gap-2 min-w-0">
              <Eyebrow>{label}</Eyebrow>
              <Figure value={value} className="text-[20px] sm:text-[24px] font-medium tracking-[-0.02em] leading-none text-ink" />
            </div>
          ))}
        </div>

        <div ref={tabsRef} role="tablist" aria-label="Unit record" className="max-md:hidden flex flex-nowrap px-5 sm:px-6 [border-top:1px_solid_var(--color-line)] overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map(([k, label, full]) => (
            <button key={k} role="tab" aria-selected={k === shown} onClick={() => setTab(k)} title={full !== label ? full : undefined} data-tab={k}
              className={cx('py-[13px] px-0.5 mr-4 last:mr-0 [border:none] bg-transparent cursor-pointer [font-family:inherit] whitespace-nowrap text-copy! flex-none',
                k === shown ? 'font-semibold! text-ink [box-shadow:inset_0_-2px_0_var(--color-gold)]' : 'text-muted-ink')}>
              {label}
            </button>
          ))}
        </div>
      </Card>

      {stacked && on('overview') && <h3 className="m-0 mt-2 text-heading font-semibold">Overview</h3>}
      {on('overview') && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-5 [align-items:start]">
          <Card>
            <SectionTitle title="Current and next reservations"
              right={<button type="button" onClick={() => setTab('reservations')} className="bg-transparent [border:none] p-0 cursor-pointer [font-family:inherit] text-meta font-semibold text-gold-ink whitespace-nowrap">All reservations</button>} />
            {d.stays.length === 0 && <div className="py-4 px-5 text-copy text-muted-ink [border-top:1px_solid_var(--color-line-soft)]">Nothing booked from today on.</div>}
            {d.stays.slice(0, 4).map(s => (
              <div key={s.id} className="flex items-center gap-3 py-[13px] px-5 [border-top:1px_solid_var(--color-line-soft)]">
                <span title={CH[s.channel].label} className="flex"><ChannelMark ch={s.channel} size={28} /></span>
                <div className="flex flex-col gap-[3px] flex-1 min-w-0">
                  <span className={cx('text-copy font-semibold whitespace-nowrap overflow-hidden text-ellipsis', (stayWho(s).missing || stayWho(s).hold) && 'text-muted-ink')}>{stayWho(s).name}</span>
                  <span className="text-meta text-muted-ink"><span className="sr-only">{CH[s.channel].label} · </span>{dateRange(s.checkIn, s.checkOut)}</span>
                </div>
                <StatusBadge entity="stay" value={stayPhase(s)} />
              </div>
            ))}
          </Card>
          {rental ? <ChannexChannelsCard unitId={u.id} linked={!!u.channexLinked} canManage={canManageChannels} onChanged={reload} buildingId={building?.id} buildingName={building?.name} />
            : <Card><SectionTitle title="Channels" /><div className="py-4 px-5 text-copy text-muted-ink [border-top:1px_solid_var(--color-line-soft)]">A {u.purpose} unit is not connected to Airbnb, Booking.com or any other channel, and takes no reservations.</div></Card>}
          {d.pnl && (
            <Card>
              <SectionTitle title={`${periodLabel} P and L`} />
              <div className="[border-top:1px_solid_var(--color-line-soft)]"><PnlTable rows={d.pnl} hideZero /></div>
            </Card>
          )}
        </div>
      )}

      {stacked && on('details') && <h3 className="m-0 mt-2 text-heading font-semibold">Details and owner</h3>}
      {on('details') && (form ? (
        <Card>
          <SaveBar title="Details & owner" sub="Listing name, purpose, type, beds, car park, owner and income model." dirty={dirty} saving={saving} canEdit={canEdit} onSave={onSave}
            auto failed={saveFailed} hold={moving ? 'Moving this unit: press Save to confirm.' : undefined}
            extra={canEdit ? <Button size="sm" variant="tertiary" icon={<Icon name="Trash2" size="sm" />} onClick={onDelete}>Delete unit</Button> : undefined} />
          <div onBlur={onAutoSave}>
            <DetailsForm u={form} owner={u.owner} buildings={buildings} canEdit={canEdit} onChange={onChange} onOpenContract={() => setTab('contract')} />
          </div>
        </Card>
      ) : needsForm)}

      {stacked && on('contract') && <h3 className="m-0 mt-2 text-heading font-semibold">Contract and documents</h3>}
      {on('contract') && (money
        ? <ContractTab key={u.id} unitId={u.id} canEdit={canEdit} onSaved={reload}
            footer={<DocumentsCard unitId={u.id} unitLabel={unitLabel} documents={d.documents ?? []} onUploaded={reloadDetail} />} />
        : <>
          <Card><div className="p-8 text-center text-copy text-muted-ink">The owner's contract is visible to finance and management.</div></Card>
          <DocumentsCard unitId={u.id} unitLabel={unitLabel} documents={d.documents ?? []} onUploaded={reloadDetail} />
        </>)}

      {stacked && on('access') && <h3 className="m-0 mt-2 text-heading font-semibold">Access and keys</h3>}
      {on('access') && <AccessTab key={u.id} unitId={u.id} unitLabel={unitLabel} parking={form?.parkingLabel} fullAccessCard={building?.fullAccessCard} />}

      {stacked && on('reservations') && <h3 className="m-0 mt-2 text-heading font-semibold">Reservations</h3>}
      {on('reservations') && <BookingsTab key={u.id} unitId={u.id} />}

      {stacked && on('operations') && <h3 className="m-0 mt-2 text-heading font-semibold">Cleaning, maintenance and fit-out</h3>}
      {on('operations') && <JobsTab key={u.id} unitId={u.id} stem={stem} />}
      {stacked && on('financials') && <h3 className="m-0 mt-2 text-heading font-semibold">Financials</h3>}
      {on('financials') && d.pnl && (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <MonthStepper month={fmonth} onChange={setFmonth} />
            <div className="flex items-center gap-2 flex-wrap">
              {form && <Button size="sm" variant="tertiary" icon={<Icon name="Download" size="sm" />} onClick={expensesReport}>Expenses report for {monthLabel(fmonth)}</Button>}
              {canEdit && <Button size="sm" variant="secondary" icon={<Icon name="Zap" size="sm" />} onClick={() => setUtilityBill(true)}>Add utility bill</Button>}
            </div>
          </div>
          {utilityBill && <BillModal units={[{ id: u.id, label: unitLabel }]} defaultUnitId={u.id} ownerId={u.owner.id} canAdjust={false} month={fmonth}
            onClose={() => setUtilityBill(false)} onSaved={() => { setBillsSaved(n => n + 1); reloadDetail(); reload(); }} />}
          <FinancialsTab key={`fin.${u.id}.${billsSaved}`} unitId={u.id} month={fmonth} />
          <UnitCostsCard key={`costs.${u.id}.${billsSaved}`} unitId={u.id} ownerId={u.owner.id} unitLabel={unitLabel} canEdit={canEdit} cleaningPrice={form?.cleaningPrice} month={fmonth}
            deepCleaningPrice={form?.deepCleaningPrice} legacyCosts={form?.expenses ?? []} onChanged={() => { reloadDetail(); reload(); }} />
        </>
      )}

      {stacked && on('letting') && <h3 className="m-0 mt-2 text-heading font-semibold">Agent to let</h3>}
      {on('letting') && <LettingTab key={u.id} unitId={u.id} canEdit={canEdit} money={money} />}

      {stacked && on('activity') && <h3 className="m-0 mt-2 text-heading font-semibold">History of changes</h3>}
      {on('activity') && (
        <RecordHistory key={u.id} entity="units" id={u.id} refreshKey={d}
          also={u.contract?.id ? [['owner_contracts', u.contract.id]] : undefined} />
      )}
    </>
  );
}
