import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { color, tone as T, channel as CH } from '../theme';
import { cx } from '../lib/design-tokens';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { EmptyState } from '../components/States';
import { Select } from '../components/Select';
import { MoneyText } from '../components/MoneyText';
import { Badge, Dot } from '../components/Badge';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import ChannelMark from '../components/ChannelMark';
import ChannexChannelsCard from '../components/ChannexChannelsCard';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, notifyFailure, downloadFile } from '../lib/api';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { rm, dateRange, date, dateShort, dateTime, monthLabel, plural, humanize, titleCase } from '../lib/format';
import { READINESS, TASK } from '../lib/vocabulary';
import { STATUS } from '../lib/bookingStatus';
import type { UnitReadiness } from '../lib/types';
import UnitTree, { firstUnitId } from './units/UnitTree';
import AccessTab from './units/AccessTab';
import BookingsTab from './units/BookingsTab';
import { SaveBar, DetailsForm, ContractFields, DocumentsCard, ExpensesEditor, BuildingModal, ConfirmAdd } from './units/UnitForms';
import { PROPERTIES_FALLBACK, DETAIL_FALLBACK, mkUnit } from './units/fallback';
import {
  READY_TONE, TASK_TONE, COND_TONE, MASTER_ROLES, STATES, cap,
  type Unit, type Building, type PropertiesPayload, type UnitDetail, type RosterRow,
} from './units/shared';

/** The unit lifecycle states an operator can set by hand, in the order they read on the record. */
const READINESS_OPTIONS: UnitReadiness[] = ['ready', 'occupied', 'cleaning', 'dirty', 'inspection', 'maintenance', 'blocked'];

const CHARGE_LABEL: Record<string, string> = { owner: 'Owner', guest_deposit: 'Guest deposit', the_conts: 'The Conts', warranty: 'Warranty' };

// Short labels so the eight tabs sit on one row; the title carries the full name.
const TABS = [
  ['overview', 'Overview', 'Overview'], ['details', 'Details', 'Details and owner'], ['contract', 'Contract', 'Contract and documents'],
  ['access', 'Access', 'Access and keys'], ['reservations', 'Bookings', 'Bookings'], ['operations', 'Housekeeping', 'Cleaning, maintenance and fit-out'],
  ['financials', 'Financials', 'Financials'], ['activity', 'Activity', 'Activity'],
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
    n.delete('when'); n.delete('page');
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
    const { baseRate, ...body } = form;
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

  const header = (
    <PageHeader title="Units" sub={`${plural(units.length, 'unit')} · ${plural(buildings.length, 'building')}`}
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
        <div className="flex flex-col gap-2 min-w-0">
          {/* Below the wide-desktop breakpoint the tree folds away behind a picker once a unit is open. */}
          <button onClick={() => setTreeOpen(o => !o)} aria-expanded={treeOpen}
            className="xl:hidden flex items-center gap-3 w-full py-[11px] px-[14px] bg-card border border-solid border-line rounded-card cursor-pointer [font:inherit] text-left">
            <Icon name="Building2" size="sm" color={color.textMuted} />
            <span className="flex-1 min-w-0">
              <span className="block text-caption text-muted-ink">{building?.name ?? 'Unit'}</span>
              <span className="block text-copy font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{form?.unitCode || form?.listingName || 'Choose a unit'}</span>
            </span>
            <span className="text-meta font-medium text-gold-ink flex-none">{treeOpen ? 'Close' : 'Change unit'}</span>
          </button>
          <div className={cx(treeOpen ? 'block' : 'hidden', 'xl:block min-w-0')}>
            <UnitTree buildings={buildings} units={units} selectedId={openId} readiness={readiness} canEdit={canEdit}
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
      .then(() => { toast({ tone: 'success', title: 'Unit state updated.', body: `${unitLabel} is now ${cap(next)}.` }); reload(); })
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
    downloadFile('/expenses/report', { unitId: form.id, period: new Date().toISOString().slice(0, 7) }).catch(notifyFailure);
  }
  const needsForm = <Card><div className="p-8 text-center text-copy text-muted-ink">This unit's master data is not available to your role.</div></Card>;
  const title = form?.listingName || `${u.propertyName} ${u.unitNumber}`;
  const subtitle = [form?.unitCode || u.unitNumber, building?.name ?? u.propertyName].filter(Boolean).join(' · ');

  return (
    <>
      <Card>
        <div className="pt-[14px] px-[14px] pb-0">
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files.item(0); if (f) takeFile(f); }}
            className={cx('h-[140px] sm:h-[200px] rounded-control grid place-items-center overflow-hidden bg-muted', dragOver ? '[border:1px_dashed_var(--color-gold)]' : '[border:1px_solid_var(--color-line-soft)]')}
            style={photo ? { background: `center / cover no-repeat url(${photo})` } : undefined}>
            {!photo && (
              <div className="flex flex-col items-center gap-[7px] text-center px-4">
                <Icon name="Image" size="lg" color={color.faint} />
                <span className="text-copy font-medium text-ink">Drop a photo of this unit</span>
                <span className="text-meta text-muted-ink">
                  or <button onClick={() => fileRef.current?.click()} className="[font:inherit] text-meta! bg-transparent [border:none] p-0 cursor-pointer text-gold-ink underline">browse files</button>
                </span>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.currentTarget.files?.item(0); if (f) takeFile(f); e.currentTarget.value = ''; }} />
        </div>

        <div className="pt-[18px] px-5 sm:px-6 pb-4 flex items-start justify-between gap-6 flex-wrap">
          <div className="flex flex-col gap-[9px] min-w-0">
            <div className="text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink [overflow-wrap:anywhere]">{subtitle}</div>
            <h2 className="m-0 text-title font-semibold tracking-[-0.01em] [overflow-wrap:anywhere]">{title}</h2>
            <span className="text-copy text-muted-ink">{form?.address || `${u.addressLine}, ${u.city}`}</span>
            <div className="flex items-center gap-3 flex-wrap">
              {/* One control for the state; the dot keeps its colour. A native select, so the list is never clipped by the card. */}
              <span className="inline-flex items-center gap-2" title="Change the unit state">
                <Dot tone={READY_TONE[readiness]} />
                <Select label="Unit state" className="w-[150px]" value={readiness} onChange={v => changeReadiness(v as UnitReadiness)}
                  options={READINESS_OPTIONS.map(r => ({ value: r, label: READINESS[r].label }))} />
              </span>
              {form?.parentUnitId && <Badge tone="warning" label="Sub-unit" />}
              {form && <Badge tone="neutral" label={form.pkg} />}
              {u.channels.length > 0 && (
                <span className="inline-flex items-center gap-1.5" aria-label={`Sold on ${u.channels.map(c => CH[c].label).join(', ')}`}>
                  {u.channels.map(c => <span key={c} title={CH[c].label} className="flex"><ChannelMark ch={c} size={22} /></span>)}
                </span>
              )}
              {!u.isListed && <Badge tone="neutral" label="Not listed" />}
            </div>
          </div>
          <div className="flex flex-col gap-1 flex-none items-start">
            <span className="text-meta text-muted-ink">Owner</span>
            <a href={`#/owners/${encodeURIComponent(u.owner.id)}`} className="text-heading font-semibold no-underline text-ink!">{titleCase(u.owner.name)}</a>
            {u.contract && <span className="text-meta text-muted-ink">{u.contract.managementFeePct}% · {u.contract.renewsOn ? `renews ${date(u.contract.renewsOn)}` : 'No renewal date'}</span>}
          </div>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(96px,1fr))] gap-4 pt-4 px-5 sm:px-6 pb-4 [border-top:1px_solid_var(--color-line-soft)]">
          {[
            ['Occupancy', `${p.occupancy}%`], ['ADR', rm(p.adr, { cents: false })], ['RevPAR', rm(p.revpar, { cents: false })],
            ['Rating', p.rating != null ? p.rating.toFixed(2) : '—'], ['Open issues', String(openIssues)],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col gap-1 min-w-0">
              <span className="text-meta font-medium text-muted-ink">{label}</span>
              <span className="text-title font-semibold tracking-[-0.01em] tabular-nums">{value}</span>
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
            <div className="pt-[18px] px-5 pb-[14px] flex items-baseline justify-between gap-3">
              <span className="text-heading font-semibold">Current and next stays</span>
              <button type="button" onClick={() => setTab('reservations')} className="bg-transparent [border:none] p-0 cursor-pointer [font:inherit] text-meta! font-semibold text-gold-ink whitespace-nowrap">All bookings</button>
            </div>
            {d.stays.length === 0 && <div className="py-4 px-5 text-copy text-muted-ink [border-top:1px_solid_var(--color-line-soft)]">Nothing booked from today on.</div>}
            {d.stays.slice(0, 4).map(s => (
              <div key={s.id} className="flex items-center gap-3 py-[13px] px-5 [border-top:1px_solid_var(--color-line-soft)]">
                <span title={CH[s.channel].label} className="flex"><ChannelMark ch={s.channel} size={28} /></span>
                <div className="flex flex-col gap-[3px] flex-1 min-w-0">
                  <span className="text-copy font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{s.guestName ?? 'No guest'}</span>
                  <span className="text-meta text-muted-ink"><span className="sr-only">{CH[s.channel].label} · </span>{dateRange(s.checkIn, s.checkOut)}</span>
                </div>
                <Badge tone={STATUS[s.state].tone} label={STATUS[s.state].label} />
              </div>
            ))}
          </Card>
          <ChannexChannelsCard unitId={u.id} linked={!!u.channexLinked} canManage={canManageChannels} onChanged={reload} />
          {d.pnl && (
            <Card>
              <div className="pt-[18px] px-5 pb-[14px]"><span className="text-heading font-semibold">{periodLabel} P and L</span></div>
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
          <DetailsForm u={form} buildings={buildings} money={money} canEdit={canEdit} onChange={onChange} />
        </Card>
      ) : needsForm)}

      {shown === 'contract' && (
        <>
          {form ? (
            <Card>
              <SaveBar title="Contract" sub="The management agreement with the owner." dirty={dirty} saving={saving} canEdit={canEdit} onSave={onSave} />
              <ContractFields u={form} canEdit={canEdit} onChange={onChange} />
            </Card>
          ) : needsForm}
          <DocumentsCard unitId={u.id} unitLabel={unitLabel} documents={d.documents ?? []} onUploaded={reloadDetail} />
        </>
      )}

      {shown === 'access' && <AccessTab key={u.id} unitId={u.id} unitLabel={unitLabel} />}

      {shown === 'reservations' && <BookingsTab key={u.id} unitId={u.id} />}

      {shown === 'operations' && (
        <>
          <Card>
            <div className="py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex items-baseline justify-between gap-3 flex-wrap">
              <span className="text-heading font-semibold">Cleaning and tasks</span>
              {/* units/detail.ts sends the latest 12; the full list is on the Housekeeping board. */}
              {d.tasks.length >= 12 && <span className="text-meta text-muted-ink">Latest 12</span>}
            </div>
            {d.tasks.length === 0 && <div className="py-4 px-5 text-copy text-muted-ink">No tasks for this unit.</div>}
            {d.tasks.map(t => (
              <div key={t.id} className="flex items-center gap-[14px] py-[14px] px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex-wrap" style={{ borderLeft: `3px solid ${T[TASK_TONE[t.state]].line}` }}>
                <div className="flex flex-col gap-0.5 flex-1 min-w-[180px]">
                  <span className="text-copy font-medium">{t.title}</span>
                  <span className="text-meta text-muted-ink">
                    {humanize(t.kind)} · {t.assigneeName ?? 'Unassigned'}{t.completedAt ? ` · done ${dateTime(t.completedAt)}` : t.dueAt ? ` · due ${dateTime(t.dueAt)}` : ''}
                  </span>
                </div>
                <Badge tone={TASK_TONE[t.state]} label={TASK[t.state].label} />
              </div>
            ))}
          </Card>
          <Card>
            <div className="py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex items-baseline justify-between gap-3 flex-wrap">
              <span className="text-heading font-semibold">Maintenance</span>
              {d.maintenance.length >= 12 && <span className="text-meta text-muted-ink">Latest 12</span>}
            </div>
            {d.maintenance.length === 0 && <div className="py-4 px-5 text-copy text-muted-ink">No maintenance jobs reported.</div>}
            {d.maintenance.map(m => (
              <div key={m.id} className="py-[14px] px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex items-start gap-4 flex-wrap">
                <div className="flex flex-col gap-[3px] flex-1 min-w-[200px]">
                  <div className="flex items-center gap-[9px] flex-wrap">
                    <span className="text-copy font-semibold">{m.title}</span>
                    <Badge tone={TASK_TONE[m.state]} label={TASK[m.state].label} />
                    {m.blocksUnit && <Badge tone="critical" label="Blocks the unit" />}
                  </div>
                  <span className="text-meta text-muted-ink">{dateShort(m.reportedAt)}{m.vendorName ? ` · ${m.vendorName}` : ''} · charged to {CHARGE_LABEL[m.chargeTo] ?? humanize(m.chargeTo)}</span>
                  {m.detail && <span className="text-copy [text-wrap:pretty]">{m.detail}</span>}
                </div>
                {(m.finalAmount != null || m.quotedAmount != null) && (
                  <div className="flex flex-col items-end gap-0.5 flex-none">
                    <MoneyText sen={m.finalAmount ?? m.quotedAmount!} mode="exact" className="text-copy font-semibold" />
                    <span className="text-caption text-muted-ink">{m.finalAmount != null ? 'Final' : 'Quoted'}</span>
                  </div>
                )}
              </div>
            ))}
          </Card>
          <Card>
            <div className="py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex items-center justify-between gap-3 flex-wrap">
              <span className="text-heading font-semibold">Fit-out register</span>
              <a href="#/properties/inventory" className="text-meta font-semibold text-gold-ink no-underline">Open inventory</a>
            </div>
            {d.inventory.length === 0 ? <div className="py-4 px-5 text-copy text-muted-ink">Nothing recorded in this unit.</div> : (
              <div className="overflow-x-auto">
                <div className="min-w-[600px]">
                  {d.inventory.map(i => (
                    <div key={i.id} className="grid grid-cols-[minmax(200px,2fr)_minmax(90px,0.8fr)_minmax(130px,1fr)_minmax(100px,0.9fr)] gap-[14px] items-center min-h-[50px] py-[9px] px-5 [border-bottom:1px_solid_var(--color-line-soft)]">
                      <div className="flex flex-col gap-px min-w-0">
                        <span className="text-copy">{i.name}</span>
                        {i.suppliedInHouse && <span className="text-caption text-muted-ink">Supplied by The Conts</span>}
                      </div>
                      <span className="text-copy">{i.quantity}</span>
                      <div><Badge tone={COND_TONE[i.condition] ?? 'neutral'} label={cap(i.condition)} /></div>
                      <span className="text-copy text-right tabular-nums">{i.purchaseCost != null ? rm(i.purchaseCost, { cents: false }) : '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </>
      )}

      {shown === 'financials' && d.pnl && (
        <>
          {form && (
            <Card>
              <SaveBar title="Monthly expenses" sub="Recurring costs deducted from the owner statement." dirty={dirty} saving={saving} canEdit={canEdit} onSave={onSave}
                extra={<Button size="sm" variant="secondary" icon={<Icon name="Download" size="sm" />} onClick={expensesReport}>Generate report</Button>} />
              <ExpensesEditor u={form} canEdit={canEdit} onChange={onChange} />
            </Card>
          )}
          <Card>
            <div className="py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex items-baseline justify-between gap-3 flex-wrap">
              <span className="text-heading font-semibold">Gross to net</span>
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
              Bookings that check in this month, less the management fee and the expenses recorded this month. The month is not closed yet, so the figures still move.
            </div>
          </Card>
        </>
      )}

      {shown === 'activity' && (
        <Card>
          <div className="py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex flex-col gap-1">
            <span className="text-heading font-semibold">Activity</span>
            <span className="text-meta text-muted-ink">Who did what, when, and from where. Read straight from the audit trail.</span>
          </div>
          {d.activity.length === 0 && <div className="py-4 px-5 text-copy text-muted-ink">Nothing recorded yet.</div>}
          {d.activity.map((a, i) => (
            <div key={i} className="flex items-center gap-[14px] py-3 px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex-wrap">
              <span className="w-[30px] h-[30px] flex-none rounded-full bg-muted text-muted-ink grid place-items-center text-caption font-semibold">
                {a.actorLabel.split(' ').map(n => n[0]).slice(0, 2).join('')}
              </span>
              <div className="flex flex-col gap-px flex-1 min-w-[160px]">
                <span className="text-copy"><strong className="font-semibold">{a.actorLabel}</strong> · {a.action.replace(/[._]/g, ' ')}</span>
                <span className="text-meta text-muted-ink">{a.source.replace(/_/g, ' ')}</span>
              </div>
              <span className="text-meta text-muted-ink">{dateTime(a.occurredAt)}</span>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
