import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { color, channel as CH } from '../theme';
import { cx } from '../lib/design-tokens';
import { Card } from '../components/Card';
import { Eyebrow, Figure, SectionTitle } from '../components/Metric';
import PageHeader from '../components/PageHeader';
import { EmptyState } from '../components/States';
import { Select } from '../components/Select';
import { MoneyText } from '../components/MoneyText';
import { StatusBadge, StatusDot } from '../components/StatusBadge';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import ChannelMark from '../components/ChannelMark';
import ChannexChannelsCard from '../components/ChannexChannelsCard';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { DataTable, type Column } from '../components/DataTable';
import { UnitList } from './units/UnitList';
import { useApi } from '../lib/useApi';
import { api, notifyFailure, downloadFile } from '../lib/api';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { rm, dateRange, date, monthLabel, plural, humanize, titleCase } from '../lib/format';
import type { UnitReadiness } from '../lib/types';
import UnitTree, { firstUnitId } from './units/UnitTree';
import AccessTab from './units/AccessTab';
import BookingsTab from './units/BookingsTab';
import { SaveBar, DetailsForm, DocumentsCard, ExpensesEditor, BuildingModal, ConfirmAdd } from './units/UnitForms';
import ContractTab, { ModelChip } from './units/ContractTab';
import { ExpensesCard } from './owners/ExpenseEntry';
import { todayMyt } from '../lib/format';
import { PROPERTIES_FALLBACK, DETAIL_FALLBACK, mkUnit } from './units/fallback';
import { RecordHistory } from '../components/RecordHistory';
import {
  MASTER_ROLES, STATES,
  type Unit, type Building, type PropertiesPayload, type UnitDetail, type RosterRow,
} from './units/shared';
import { statusLabel } from '../lib/status';

/** True at the width where the tree becomes a sticky pane (Tailwind xl). */
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

const CHARGE_LABEL: Record<string, string> = { owner: 'Owner', guest_deposit: 'Guest deposit', the_conts: 'The Conts', warranty: 'Warranty' };

// Short labels so the eight tabs sit on one row; the title carries the full name.
const TABS = [
  ['overview', 'Overview', 'Overview'], ['details', 'Details', 'Details and owner'], ['contract', 'Contract', 'Contract and documents'],
  ['access', 'Access', 'Access and keys'], ['reservations', 'Bookings', 'Bookings'], ['operations', 'Housekeeping', 'Cleaning, maintenance and fit-out'],
  ['financials', 'Financials', 'Financials'], ['activity', 'History', 'History of changes'],
] as const;
type Tab = typeof TABS[number][0];
const isTab = (t: string | null): t is Tab => TABS.some(([k]) => k === t);

type Modal = null | { kind: 'building' } | { kind: 'editBuilding'; building: Building } | { kind: 'unit'; buildingId: string } | { kind: 'subunit'; buildingId: string; parent: Unit };

/** Units: the building and unit tree on the left, the whole record of the chosen unit on the right.
 *  Replaces the separate Properties, Units and Access and keys screens (old addresses redirect here, App.tsx). */
export default function UnitsPage({ unitId }: { unitId: string }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const { user } = useSession();
  const canEdit = !!user && MASTER_ROLES.includes(user.role);
  const wide = useWide();

  const props = useApi<PropertiesPayload>('/properties', PROPERTIES_FALLBACK);
  const roster = useApi<{ data: RosterRow[] }>('/units');
  const [edits, setEdits] = useState<Record<string, Partial<Unit>>>({});
  const [readinessEdits, setReadinessEdits] = useState<Record<string, UnitReadiness>>({});
  const [modal, setModal] = useState<Modal>(null);
  const [treeOpen, setTreeOpen] = useState(!unitId);
  const [saving, setSaving] = useState(false);
  // The open tab lives in the address (?tab=), so a link or a reload lands on the same tab.
  const tabParam = params.get('tab');
  const tab: Tab = isTab(tabParam) ? tabParam : 'overview';
  const setTab = (t: Tab) => setParams(p => {
    const n = new URLSearchParams(p);
    if (t === 'overview') n.delete('tab'); else n.set('tab', t);
    // The Bookings tab's own filter and page do not carry over to another tab.
    n.delete('when'); n.delete('page'); n.delete('size');
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
  async function save() {
    if (!form) return;
    const before = original.find(u => u.id === form.id);
    // The contract is saved on its own tab (PUT /units/:id/contract); never sent from here, so an older copy in
    // this form cannot overwrite it.
    const { baseRate, contract: _contract, revenueModel: _model, termsLabel: _terms, ...body } = form;
    setSaving(true);
    try {
      await api.patch(`/units/${form.id}`, body);
      // The base rate has its own endpoint because changing it re-sends prices to linked channels.
      if (baseRate !== undefined && baseRate !== before?.baseRate) await api.put('/rates', { unitId: form.id, baseRate });
      toast({ tone: 'success', title: 'Changes saved.', body: `${form.listingName || form.unitCode} updated.` });
      setEdits(e => { const n = { ...e }; delete n[form.id]; return n; });
      reloadAll();
    } catch (e) { notifyFailure(e); }
    finally { setSaving(false); }
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
  async function createUnit(nu: Unit, title: string, body: string) {
    try {
      const r = await api.post<{ id: string }>('/units', nu);
      setModal(null);
      toast({ tone: 'success', title, body });
      navigate(`/properties/units/${encodeURIComponent(r.id)}?tab=details`);
      props.reload(); roster.reload();
    } catch (e) { notifyFailure(e); }
  }
  function addUnit(buildingId: string) {
    const state = buildings.find(b => b.id === buildingId)?.state ?? STATES[0];
    void createUnit(mkUnit(crypto.randomUUID(), buildingId, '', '', state, '', { ownerName: '' }), 'Unit added.', 'Fill in its details below.');
  }
  function addSubUnit(buildingId: string, parent: Unit) {
    const nu = mkUnit(crypto.randomUUID(), buildingId, '', '', parent.state, '', {
      parentUnitId: parent.id, ownerName: parent.ownerName, ic: parent.ic, bankName: parent.bankName, bankAccount: parent.bankAccount, accountHolder: parent.accountHolder, split: 'Profit share',
    });
    void createUnit(nu, 'Sub-unit added.', 'A room or floor under the unit — fill in its details below.');
  }

  // ?view=list shows every unit as one table instead of the tree and one record.
  const listMode = params.get('view') === 'list';
  const setListMode = (on: boolean) => setParams(p => { const n = new URLSearchParams(on ? '' : p); if (on) n.set('view', 'list'); else n.delete('view'); return n; }, { replace: true });
  const header = (
    <PageHeader title="Units" sub={`${plural(units.length, 'unit')} · ${plural(buildings.length, 'building')}`}
      actions={<Button size="sm" variant="secondary" icon={<Icon name={listMode ? 'FolderTree' : 'Table2'} size="sm" />} onClick={() => setListMode(!listMode)}>{listMode ? 'Tree and record' : 'List of all units'}</Button>}
      primary={canEdit ? <Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal({ kind: 'building' })}>Add building</Button> : undefined} />
  );

  const modals = <>
    {modal?.kind === 'building' && <BuildingModal onClose={() => setModal(null)} onSubmit={b => void addBuilding(b)} />}
    {modal?.kind === 'editBuilding' && <BuildingModal initial={modal.building} onClose={() => setModal(null)}
      onSubmit={b => void saveBuilding(modal.building.id, b)}
      onDelete={units.every(u => u.buildingId !== modal.building.id) ? () => void deleteBuilding(modal.building) : undefined} />}
    {modal?.kind === 'unit' && <ConfirmAdd title={`Add a unit to ${buildings.find(b => b.id === modal.buildingId)?.name ?? 'this building'}`}
      sub="A blank unit opens for you to fill in." body="You will set the listing name, code, owner, package and GRR on its Details tab." confirm="Add unit"
      onClose={() => setModal(null)} onConfirm={() => addUnit(modal.buildingId)} />}
    {modal?.kind === 'subunit' && <ConfirmAdd title={`Add a sub-unit under ${modal.parent.unitCode || 'this unit'}`}
      sub="A room or floor let separately inside this unit." body="The sub-unit inherits the owner and bank details of its parent. You can give it its own code, revenue split and expenses." confirm="Add sub-unit"
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
    return <div className="flex flex-col gap-5">{header}<Card><TableSkeleton rows={6} cols={3} /></Card></div>;
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

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(260px,300px)_minmax(0,1fr)] gap-5 items-start min-w-0">
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
            <Card><div className="p-10 text-center text-muted-ink text-copy">{detail.error ?? 'Loading unit…'}</div></Card>
          ) : (
            <UnitRecord d={d} form={form} buildings={buildings} building={building} unitLabel={unitLabel}
              tab={tab} setTab={setTab} canEdit={canEdit} dirty={dirty} saving={saving} onSave={() => void save()}
              onChange={p => form && patch(form.id, p)} reload={reloadAll} reloadDetail={detail.reload}
              readiness={readiness[d.unit.id] ?? d.unit.readiness}
              setReadiness={(id, r) => setReadinessEdits(m => { const n = { ...m }; if (r) n[id] = r; else delete n[id]; return n; })} />
          )}
        </div>
      </div>
      {modals}
    </div>
  );
}

interface RecordProps {
  d: UnitDetail; form: Unit | null; buildings: Building[]; building: Building | undefined; unitLabel: string;
  tab: Tab; setTab: (t: Tab) => void; canEdit: boolean; dirty: boolean; saving: boolean; onSave: () => void;
  onChange: (p: Partial<Unit>) => void; reload: () => void; reloadDetail: () => void;
  readiness: UnitReadiness; setReadiness: (id: string, r: UnitReadiness | null) => void;
}

function UnitRecord({ d, form, buildings, building, unitLabel, tab, setTab, canEdit, dirty, saving, onSave, onChange, reload, reloadDetail, readiness, setReadiness }: RecordProps) {
  const toast = useToast();
  const { user } = useSession();
  // Matches MASTER_ROLES on the server's channex-setup / channex-connect.
  const canManageChannels = !!user && MASTER_ROLES.includes(user.role);
  const fileRef = useRef<HTMLInputElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  useEffect(() => { setPhoto(null); }, [d.unit.id]);

  const u = d.unit;
  const p = d.performance;
  const money = !!d.pnl;
  const openIssues = d.maintenance.filter(m => m.state !== 'resolved').length;
  // Financial sections are absent from the payload for roles without access, so that tab is not offered.
  const tabs = TABS.filter(([k]) => k !== 'financials' || money);
  const shown: Tab = tabs.some(([k]) => k === tab) ? tab : 'overview';
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
      .then(() => { toast({ tone: 'success', title: 'Unit state updated.', body: `${unitLabel} is now ${statusLabel('readiness', next)}.` }); reload(); })
      .catch(err => { setReadiness(u.id, prev === u.readiness ? null : prev); notifyFailure(err); });
  }
  function takeFile(file: File) {
    const fd = new FormData();
    fd.append('file', file); fd.append('unitId', u.id); fd.append('kind', 'photo');
    api.post('/documents', fd)
      .then(() => { setPhoto(URL.createObjectURL(file)); toast({ tone: 'success', title: 'Photo added to this unit.', body: 'It will appear on the owner statement and channel listings.' }); reloadDetail(); })
      .catch(notifyFailure);
  }
  function expensesReport() {
    if (!form) return;
    toast({ tone: 'info', title: 'Preparing report', body: `Expenses for ${unitLabel} — served as a download.` });
    downloadFile('/expenses/report', { unitId: form.id, period: todayMyt().slice(0, 7) }).catch(notifyFailure);
  }
  const needsForm = <Card><div className="p-8 text-center text-copy text-muted-ink">This unit's master data is not available to your role.</div></Card>;
  const title = form?.listingName || `${u.propertyName} ${u.unitNumber}`;
  const stem = unitLabel.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'unit';
  const subtitle = [form?.unitCode || u.unitNumber, building?.name ?? u.propertyName].filter(Boolean).join(' · ');

  return (
    <>
      <Card>
        <div className="pt-[14px] px-[14px] pb-0">
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files.item(0); if (f) takeFile(f); }}
            className={cx('h-[84px] sm:h-[112px] rounded-control grid place-items-center overflow-hidden bg-muted', dragOver ? '[border:1px_dashed_var(--color-gold)]' : '[border:1px_solid_var(--color-line-soft)]')}
            style={photo ? { background: `center / cover no-repeat url(${photo})` } : undefined}>
            {!photo && (
              <div className="flex items-center gap-[10px] text-center px-4">
                <Icon name="Image" size="base" color={color.faint} />
                <span className="text-meta text-muted-ink">
                  <span className="font-medium text-ink">Drop a photo of this unit</span> or <button onClick={() => fileRef.current?.click()} className="[font-family:inherit] text-meta bg-transparent [border:none] p-0 cursor-pointer text-gold-ink underline">browse files</button>
                </span>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.currentTarget.files?.item(0); if (f) takeFile(f); e.currentTarget.value = ''; }} />
        </div>

        <div className="pt-[18px] px-5 sm:px-6 pb-4 flex items-start justify-between gap-6 flex-wrap">
          <div className="flex flex-col gap-[9px] min-w-0">
            <Eyebrow className="[overflow-wrap:anywhere]">{subtitle}</Eyebrow>
            <h2 className="m-0 text-title font-semibold tracking-[-0.01em] [overflow-wrap:anywhere]">{title}</h2>
            <span className="text-copy text-muted-ink">{form?.address || `${u.addressLine}, ${u.city}`}</span>
            <div className="flex items-center gap-3 flex-wrap">
              {/* One control for the state; the dot keeps its colour. A native select, so the list is never clipped by the card. */}
              <span className="inline-flex items-center gap-2" title="Change the unit state">
                <StatusDot entity="readiness" value={readiness} />
                <Select label="Unit state" className="w-[150px]" value={readiness} onChange={v => changeReadiness(v as UnitReadiness)}
                  options={READINESS_OPTIONS.map(r => ({ value: r, label: statusLabel('readiness', r) }))} />
              </span>
              {form?.parentUnitId && <StatusBadge tone="warning" label="Sub-unit" />}
              {u.revenueModel && <span title={`Revenue model: ${u.revenueModelLabel}. Change it on the Contract tab.`}><ModelChip model={u.revenueModel} label={u.termsLabel ?? u.revenueModelLabel} /></span>}
              {u.channels.length > 0 && (
                <span className="inline-flex items-center gap-1.5" aria-label={`Sold on ${u.channels.map(c => CH[c].label).join(', ')}`}>
                  {u.channels.map(c => <span key={c} title={CH[c].label} className="flex"><ChannelMark ch={c} size={22} /></span>)}
                </span>
              )}
              {!u.isListed && <span title="This unit is not for sale on Airbnb, Booking.com or any other channel, so no bookings come in through them. Connect it under Channels on the Overview tab."><StatusBadge tone="neutral" label="Not listed on any channel" /></span>}
            </div>
          </div>
          {/* Owner names run long (several co-owners, company names); they wrap instead of running off a phone. */}
          <div className="flex flex-col gap-1 min-w-0 max-w-full sm:max-w-[45%] items-start">
            <Eyebrow>Owner</Eyebrow>
            <a href={`#/owners/${encodeURIComponent(u.owner.id)}`} className="text-heading font-semibold no-underline text-ink! [overflow-wrap:anywhere]">{titleCase(u.owner.name)}</a>
            {u.contract && <span className="text-meta text-muted-ink">{u.termsLabel ?? `${u.contract.managementFeePct}%`} · {u.contract.renewsOn ? `renews ${date(u.contract.renewsOn)}` : 'No renewal date'}</span>}
          </div>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-[repeat(auto-fit,minmax(96px,1fr))] gap-x-4 gap-y-5 pt-5 px-5 sm:px-6 pb-5 [border-top:1px_solid_var(--color-line-soft)]">
          {[
            ['Occupancy', `${p.occupancy}%`], ['ADR', rm(p.adr, { cents: false })], ['RevPAR', rm(p.revpar, { cents: false })],
            ['Rating', p.rating != null ? p.rating.toFixed(2) : '—'], ['Open issues', String(openIssues)],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col gap-2 min-w-0">
              <Eyebrow>{label}</Eyebrow>
              <Figure value={value} className="text-[20px] sm:text-[24px] font-medium tracking-[-0.02em] leading-none text-ink" />
            </div>
          ))}
        </div>

        <div ref={tabsRef} role="tablist" aria-label="Unit record" className="flex flex-nowrap px-5 sm:px-6 [border-top:1px_solid_var(--color-line)] overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map(([k, label, full]) => (
            <button key={k} role="tab" aria-selected={k === shown} onClick={() => setTab(k)} title={full !== label ? full : undefined} data-tab={k}
              className={cx('py-[13px] px-0.5 mr-4 last:mr-0 [border:none] bg-transparent cursor-pointer [font-family:inherit] whitespace-nowrap text-copy! flex-none',
                k === shown ? 'font-semibold! text-ink [box-shadow:inset_0_-2px_0_var(--color-gold)]' : 'text-muted-ink')}>
              {label}
            </button>
          ))}
        </div>
      </Card>

      {shown === 'overview' && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-5 [align-items:start]">
          <Card>
            <SectionTitle title="Current and next stays"
              right={<button type="button" onClick={() => setTab('reservations')} className="bg-transparent [border:none] p-0 cursor-pointer [font-family:inherit] text-meta font-semibold text-gold-ink whitespace-nowrap">All bookings</button>} />
            {d.stays.length === 0 && <div className="py-4 px-5 text-copy text-muted-ink [border-top:1px_solid_var(--color-line-soft)]">Nothing booked from today on.</div>}
            {d.stays.slice(0, 4).map(s => (
              <div key={s.id} className="flex items-center gap-3 py-[13px] px-5 [border-top:1px_solid_var(--color-line-soft)]">
                <span title={CH[s.channel].label} className="flex"><ChannelMark ch={s.channel} size={28} /></span>
                <div className="flex flex-col gap-[3px] flex-1 min-w-0">
                  <span className="text-copy font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{s.guestName ?? 'No guest'}</span>
                  <span className="text-meta text-muted-ink"><span className="sr-only">{CH[s.channel].label} · </span>{dateRange(s.checkIn, s.checkOut)}</span>
                </div>
                <StatusBadge entity="booking" value={s.state} />
              </div>
            ))}
          </Card>
          <ChannexChannelsCard unitId={u.id} linked={!!u.channexLinked} canManage={canManageChannels} onChanged={reload} />
          {d.pnl && (
            <Card>
              <SectionTitle title={`${periodLabel} P and L`} />
              {d.pnl.map((l, i) => {
                const net = l.type === 'net';
                return (
                  <div key={i} className={cx('flex items-center justify-between gap-5 py-3 px-5 [border-top:1px_solid_var(--color-line-soft)]', net && 'bg-page')}>
                    <span className={cx('text-copy', net ? 'font-semibold text-ink' : 'font-normal text-muted-ink')}>{l.label}</span>
                    <MoneyText sen={l.amount} mode="exact" className={cx('text-ink text-right', net ? 'text-heading font-semibold' : 'text-copy font-medium')} />
                  </div>
                );
              })}
            </Card>
          )}
        </div>
      )}

      {shown === 'details' && (form ? (
        <Card>
          <SaveBar title="Details & owner" sub="Listing, building, owner and revenue model." dirty={dirty} saving={saving} canEdit={canEdit} onSave={onSave} />
          <DetailsForm u={form} buildings={buildings} money={money} canEdit={canEdit} onChange={onChange} onOpenContract={() => setTab('contract')} />
        </Card>
      ) : needsForm)}

      {shown === 'contract' && (money
        ? <ContractTab key={u.id} unitId={u.id} canEdit={canEdit} onSaved={reload}
            footer={<DocumentsCard unitId={u.id} unitLabel={unitLabel} documents={d.documents ?? []} onUploaded={reloadDetail} />} />
        : <>
          <Card><div className="p-8 text-center text-copy text-muted-ink">The owner's contract is visible to finance and management.</div></Card>
          <DocumentsCard unitId={u.id} unitLabel={unitLabel} documents={d.documents ?? []} onUploaded={reloadDetail} />
        </>)}

      {shown === 'access' && <AccessTab key={u.id} unitId={u.id} unitLabel={unitLabel} />}

      {shown === 'reservations' && <BookingsTab key={u.id} unitId={u.id} />}

      {shown === 'operations' && (
        <>
          <Card>
            <div className="py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex items-baseline justify-between gap-3 flex-wrap">
              <span className="text-[16px] font-semibold tracking-[-0.01em]">Cleaning and tasks</span>
              {/* units/detail.ts sends the latest 12; the full list is on the Housekeeping board. */}
              {d.tasks.length >= 12 && <span className="text-meta text-muted-ink">Latest 12</span>}
            </div>
            <DataTable<TaskRow> id="unit.tasks" urlPrefix="tasks." bare noViews pageSize={0} maxHeight="none"
              columns={TASK_COLUMNS} rows={d.tasks} rowKey={t => t.id} noun={['task', 'tasks']} exportName={`${stem}-tasks`}
              empty={{ title: 'No tasks for this unit.', icon: 'Sparkles' }} />
          </Card>
          <Card>
            <div className="py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex items-baseline justify-between gap-3 flex-wrap">
              <span className="text-[16px] font-semibold tracking-[-0.01em]">Maintenance</span>
              {d.maintenance.length >= 12 && <span className="text-meta text-muted-ink">Latest 12</span>}
            </div>
            <DataTable<JobRow> id="unit.maintenance" urlPrefix="jobs." bare noViews pageSize={0} maxHeight="none"
              columns={JOB_COLUMNS} rows={d.maintenance} rowKey={m => m.id} noun={['job', 'jobs']} exportName={`${stem}-maintenance`}
              empty={{ title: 'No maintenance jobs reported.', icon: 'Wrench' }} />
          </Card>
          <Card>
            <div className="py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex items-center justify-between gap-3 flex-wrap">
              <span className="text-[16px] font-semibold tracking-[-0.01em]">Fit-out register</span>
              <a href="#/properties/inventory" className="text-meta font-semibold text-gold-ink no-underline">Open inventory</a>
            </div>
            <DataTable<ItemRow> id="unit.fitout" urlPrefix="fit." bare noViews pageSize={0} maxHeight="none"
              columns={ITEM_COLUMNS} rows={d.inventory} rowKey={i => i.id} noun={['item', 'items']} exportName={`${stem}-fit-out`}
              empty={{ title: 'Nothing recorded in this unit.', icon: 'Package' }} />
          </Card>
        </>
      )}
      {shown === 'financials' && d.pnl && (
        <>
          <ExpensesCard title="Expenses this month" unitId={u.id} month={todayMyt().slice(0, 7)} units={[{ id: u.id, label: unitLabel }]} canEdit={canEdit} onChanged={reloadDetail} />
          {form && (
            <Card>
              <SaveBar title="Recurring monthly costs" sub="The unit's usual monthly costs, for reference and the expenses report. Record the actual bills above." dirty={dirty} saving={saving} canEdit={canEdit} onSave={onSave}
                extra={<Button size="sm" variant="secondary" icon={<Icon name="Download" size="sm" />} onClick={expensesReport}>Generate report</Button>} />
              <ExpensesEditor u={form} canEdit={canEdit} onChange={onChange} />
            </Card>
          )}
          <Card>
            <div className="py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex items-baseline justify-between gap-3 flex-wrap">
              <span className="text-[16px] font-semibold tracking-[-0.01em]">Gross to net</span>
              <span className="text-meta text-muted-ink">{periodLabel}</span>
            </div>
            {d.pnl.map((l, i) => {
              const net = l.type === 'net';
              return (
                <div key={i} className={cx('flex items-center justify-between gap-5 [border-bottom:1px_solid_var(--color-line-soft)]', net ? 'py-[15px] px-5 bg-page' : 'py-3 px-5 bg-card')}>
                  <span className={cx(net ? 'text-copy font-semibold text-ink' : 'text-copy font-normal text-muted-ink')}>{l.label}</span>
                  <MoneyText sen={l.amount} mode="exact" className={cx('text-right', net ? 'text-heading font-semibold' : 'text-copy font-medium')} />
                </div>
              );
            })}
            <div className="py-[13px] px-5 text-meta text-muted-ink [text-wrap:pretty]">
              The owner statement for the month so far, by the unit's revenue model: income split by night into the month, less the costs the owner pays. The month is not closed yet, so the figures still move.
            </div>
          </Card>
          {d.companyPnl && (
            <Card>
              <div className="py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex flex-col gap-1">
                <span className="text-[16px] font-semibold tracking-[-0.01em]">Company side</span>
                <span className="text-meta text-muted-ink">What the company keeps or pays on this unit, {periodLabel.toLowerCase()}. Costs paid by the company, a tenant or a guest show here, never on the owner statement.</span>
              </div>
              {d.companyPnl.map((l, i) => {
                const net = l.type === 'net';
                return (
                  <div key={i} className={cx('flex items-center justify-between gap-5 [border-bottom:1px_solid_var(--color-line-soft)] last:border-b-0', net ? 'py-[15px] px-5 bg-page' : 'py-3 px-5 bg-card')}>
                    <span className={cx(net ? 'text-copy font-semibold text-ink' : 'text-copy font-normal text-muted-ink')}>{l.label}</span>
                    <MoneyText sen={l.amount} mode="exact" className={cx('text-right', net ? 'text-heading font-semibold' : 'text-copy font-medium')} />
                  </div>
                );
              })}
            </Card>
          )}
        </>
      )}

      {shown === 'activity' && (
        <RecordHistory key={u.id} entity="units" id={u.id} refreshKey={d}
          also={u.contract?.id ? [['owner_contracts', u.contract.id]] : undefined} />
      )}
    </>
  );
}

type TaskRow = UnitDetail['tasks'][number];
type JobRow = UnitDetail['maintenance'][number];
type ItemRow = UnitDetail['inventory'][number];

const TASK_COLUMNS: Column<TaskRow>[] = [
  { key: 'title', label: 'Task', value: t => t.title, hideable: false, width: 220 },
  { key: 'kind', label: 'Type', value: t => humanize(t.kind), width: 120 },
  { key: 'assignee', label: 'Assigned to', type: 'person', value: t => t.assigneeName ?? 'Unassigned', width: 160 },
  { key: 'when', label: 'Due or done', type: 'datetime', value: t => t.completedAt ?? t.dueAt, width: 160,
    sub: t => (t.completedAt ? 'Done' : t.dueAt ? 'Due' : null) },
  { key: 'state', label: 'Status', type: 'status', value: t => t.state, entity: 'task', width: 130 },
];

const JOB_COLUMNS: Column<JobRow>[] = [
  { key: 'title', label: 'Job', value: m => m.title, hideable: false, width: 240,
    render: m => (
      <span className="flex items-center gap-2 min-w-0">
        <span className="font-semibold whitespace-nowrap overflow-hidden text-ellipsis" title={m.title}>{m.title}</span>
        {m.blocksUnit && <StatusBadge tone="critical" label="Blocks the unit" size="sm" />}
      </span>
    ),
    sub: m => (m.detail ? <span title={m.detail}>{m.detail}</span> : null) },
  { key: 'detail', label: 'Detail', value: m => m.detail, hidden: true, width: 240 },
  { key: 'reported', label: 'Reported', type: 'date', value: m => m.reportedAt, width: 116 },
  { key: 'vendor', label: 'Vendor', value: m => m.vendorName, width: 140 },
  { key: 'charge', label: 'Charged to', value: m => CHARGE_LABEL[m.chargeTo] ?? humanize(m.chargeTo), width: 130 },
  { key: 'state', label: 'Status', type: 'status', value: m => m.state, entity: 'task', width: 130 },
  { key: 'amount', label: 'Amount', type: 'money', value: m => m.finalAmount ?? m.quotedAmount ?? null, width: 120,
    sub: m => (m.finalAmount != null ? 'Final' : m.quotedAmount != null ? 'Quoted' : null) },
];

const ITEM_COLUMNS: Column<ItemRow>[] = [
  { key: 'name', label: 'Item', value: i => i.name, hideable: false, width: 220, sub: i => (i.suppliedInHouse ? 'Supplied by The Conts' : null) },
  { key: 'quantity', label: 'Quantity', value: i => i.quantity, width: 90 },
  { key: 'condition', label: 'Condition', type: 'status', value: i => i.condition, entity: 'condition', width: 130 },
  { key: 'cost', label: 'Cost', type: 'money', value: i => i.purchaseCost ?? null, width: 110,
    render: i => <span className="tabular-nums whitespace-nowrap">{i.purchaseCost != null ? rm(i.purchaseCost, { cents: false }) : '—'}</span> },
];

