import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { color, text } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import Icon from '../components/Icon';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { rm } from '../lib/format';
import type { Tone, UnitReadiness } from '../lib/types';

const READY_TONE: Record<UnitReadiness, Tone> = {
  occupied: 'info', dirty: 'warning', cleaning: 'info', inspection: 'warning',
  ready: 'success', maintenance: 'critical', blocked: 'neutral',
};

const STATES = ['Kuala Lumpur', 'Selangor', 'Penang', 'Johor', 'Melaka', 'Perak', 'Negeri Sembilan'];

interface Unit {
  id: string; unitNumber: string; propertyId: string; propertyName: string;
  city: string; state: string; ownerId: string; ownerName: string;
  readiness: UnitReadiness; bedrooms: number; bathrooms: number; maxGuests: number;
  baseRate?: number; isListed: boolean;
}
interface Payload { data: Unit[]; generatedAt: string }
interface AddedBuilding { name: string; city: string; state: string }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'u1', unitNumber: '#A-12-03', propertyId: 'p1', propertyName: 'Vista Jaya One', city: 'Petaling Jaya', state: 'Selangor', ownerId: 'o1', ownerName: 'Lim Chee Keong', readiness: 'occupied', bedrooms: 2, bathrooms: 2, maxGuests: 4, baseRate: 28400, isListed: true },
    { id: 'u2', unitNumber: '#B-08-11', propertyId: 'p2', propertyName: 'Arcoris Mont Kiara', city: 'Mont Kiara', state: 'Kuala Lumpur', ownerId: 'o2', ownerName: 'Wong Mei Ling', readiness: 'cleaning', bedrooms: 0, bathrooms: 1, maxGuests: 2, baseRate: 23100, isListed: true },
    { id: 'u3', unitNumber: '#2207', propertyId: 'p3', propertyName: 'Tribeca', city: 'Bukit Bintang', state: 'Kuala Lumpur', ownerId: 'o3', ownerName: 'Rajesh Kumar', readiness: 'ready', bedrooms: 1, bathrooms: 1, maxGuests: 3, baseRate: 31800, isListed: true },
    { id: 'u4', unitNumber: '#15-06', propertyId: 'p4', propertyName: 'Scarletz', city: 'KLCC', state: 'Kuala Lumpur', ownerId: 'o4', ownerName: 'Chong Wei Han', readiness: 'dirty', bedrooms: 1, bathrooms: 1, maxGuests: 2, baseRate: 26500, isListed: true },
    { id: 'u5', unitNumber: '#A-21-02', propertyId: 'p5', propertyName: 'The Establishment', city: 'Kuchai Lama', state: 'Kuala Lumpur', ownerId: 'o5', ownerName: 'Nur Aisyah', readiness: 'dirty', bedrooms: 2, bathrooms: 2, maxGuests: 4, baseRate: 24200, isListed: true },
    { id: 'u6', unitNumber: '#C-31-14', propertyId: 'p6', propertyName: 'Sentral Suites', city: 'KL Sentral', state: 'Kuala Lumpur', ownerId: 'o6', ownerName: 'Tan Boon Huat', readiness: 'maintenance', bedrooms: 0, bathrooms: 1, maxGuests: 2, baseRate: 22800, isListed: true },
  ],
};

const READY_LABEL = (r: string) => r[0].toUpperCase() + r.slice(1);
const beds = (n: number) => n === 0 ? 'Studio' : `${n} bed`;

/** state → building → unit, the layering the business actually thinks in. */
export default function PropertiesPage() {
  const { data, loading, error, reload } = useApi<Payload>('/units', FALLBACK);
  const toast = useToast();

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [added, setAdded] = useState<Unit[]>([]);
  const [addedBuildings, setAddedBuildings] = useState<AddedBuilding[]>([]);
  const [modal, setModal] = useState<null | { kind: 'building' } | { kind: 'unit'; building: string; city: string; state: string }>(null);

  const units = [...added, ...(data?.data ?? [])];

  // state → building → { city, units }. Seeded with just-added buildings so an
  // empty building still appears with its own "Add unit" affordance.
  const byState: Record<string, Record<string, { city: string; units: Unit[] }>> = {};
  const ensure = (state: string, building: string, city: string) => {
    (byState[state] ??= {})[building] ??= { city, units: [] };
    if (city && !byState[state][building].city) byState[state][building].city = city;
    return byState[state][building];
  };
  addedBuildings.forEach(b => ensure(b.state, b.name, b.city));
  units.forEach(u => ensure(u.state, u.propertyName, u.city).units.push(u));

  const buildingCount = new Set([...units.map(u => u.propertyName), ...addedBuildings.map(b => b.name)]).size;

  function addBuilding(b: AddedBuilding) {
    setAddedBuildings(list => [b, ...list]);
    setCollapsed(c => ({ ...c, [b.name]: false }));
    toast({ tone: 'success', title: 'Building added.', body: `${b.name} — now add units to it.` });
    api.post('/properties', b).catch(() => {});
    setModal(null);
  }

  function addUnit(building: string, city: string, state: string, u: Omit<Unit, 'id' | 'propertyId' | 'propertyName' | 'city' | 'state'>) {
    const unit: Unit = { id: crypto.randomUUID(), propertyId: '', propertyName: building, city, state, ...u };
    setAdded(a => [unit, ...a]);
    toast({ tone: 'success', title: 'Unit added.', body: `${u.unitNumber} added to ${building}.` });
    api.post('/units', { ...u, building }).catch(() => {});
    setModal(null);
  }

  const totalUnits = units.length;

  return (
    <>
      <PageHeader
        title="Properties"
        sub={`${totalUnits} units · ${buildingCount} buildings · ${Object.keys(byState).length} states`}
        right={<Button variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal({ kind: 'building' })}>Add building</Button>}
      />

      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      {loading && units.length === 0 ? <Card><TableSkeleton rows={6} cols={5} /></Card> : totalUnits === 0 && addedBuildings.length === 0 ? (
        <Card>
          <EmptyState onAdd={() => setModal({ kind: 'building' })} />
        </Card>
      ) : (
        <Card>
          {Object.entries(byState).map(([state, group]) => (
            <div key={state}>
              <div style={{ padding: '11px 22px', background: color.muted, borderBottom: `1px solid ${color.border}`, fontSize: text.micro, fontWeight: 600, letterSpacing: '0.1em', color: color.textMuted }}>
                {state.toUpperCase()}
              </div>
              {Object.entries(group).map(([building, { city, units: list }]) => {
                const open = !collapsed[building];
                return (
                  <div key={building}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 22px 11px 16px', borderBottom: `1px solid ${color.borderMuted}`, background: '#FFFFFF' }}>
                      <button onClick={() => setCollapsed(c => ({ ...c, [building]: open }))}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', textAlign: 'left', padding: 0, minWidth: 0 }}>
                        <span style={{ display: 'flex', transition: 'transform 180ms', transform: `rotate(${open ? 90 : 0}deg)`, color: color.textMuted }}>
                          <Icon name="ChevronRight" size="sm" />
                        </span>
                        <span style={{ fontSize: text.cardTitle, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{building}</span>
                        <span style={{ fontSize: text.small, color: color.textMuted, whiteSpace: 'nowrap' }}>{city} · {list.length} unit{list.length === 1 ? '' : 's'}</span>
                      </button>
                      <Button size="sm" variant="secondary" icon={<Icon name="Plus" size="sm" />}
                        onClick={() => setModal({ kind: 'unit', building, city, state })}>Add unit</Button>
                    </div>
                    {open && (list.length === 0 ? (
                      <div style={{ padding: '14px 22px 14px 54px', fontSize: 12.5, color: color.textMuted, borderBottom: `1px solid ${color.borderMuted}` }}>
                        No units in this building yet. Use <strong style={{ fontWeight: 600 }}>Add unit</strong> to add the first.
                      </div>
                    ) : list.map(u => (
                      <a key={u.id} href={`#/properties/units/${encodeURIComponent(u.id)}`}
                        style={{ display: 'grid', gridTemplateColumns: 'minmax(130px,1.1fr) minmax(110px,0.9fr) minmax(150px,1.3fr) minmax(110px,1fr) minmax(90px,0.8fr)', gap: 14, alignItems: 'center', minHeight: 52, padding: '9px 22px 9px 54px', borderBottom: `1px solid ${color.borderMuted}`, textDecoration: 'none', color: 'inherit' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 500 }}>{u.unitNumber}</span>
                          <span style={{ fontSize: 11.5, color: color.textMuted }}>{beds(u.bedrooms)} · sleeps {u.maxGuests}</span>
                        </div>
                        <div><Badge tone={READY_TONE[u.readiness]} label={READY_LABEL(u.readiness)} /></div>
                        <span style={{ fontSize: 12.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.ownerName || '—'}</span>
                        <span style={{ fontSize: 13, textAlign: 'right' }}>
                          {u.baseRate != null ? rm(u.baseRate, { cents: false }) : '—'}
                        </span>
                        <div>{!u.isListed && <Badge tone="neutral" label="Not listed" />}</div>
                      </a>
                    )))}
                  </div>
                );
              })}
            </div>
          ))}
        </Card>
      )}

      {modal?.kind === 'building' && (
        <AddBuildingModal onClose={() => setModal(null)} onSubmit={addBuilding} />
      )}
      {modal?.kind === 'unit' && (
        <AddUnitModal building={modal.building}
          onClose={() => setModal(null)}
          onSubmit={u => addUnit(modal.building, modal.city, modal.state, u)} />
      )}
    </>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div style={{ padding: '48px 22px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}>
      <span style={{ color: color.textMuted }}><Icon name="Building2" /></span>
      <div style={{ fontSize: 14, color: color.textMuted, maxWidth: 340 }}>No buildings yet. Add a building, then add units to it.</div>
      <Button variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={onAdd}>Add building</Button>
    </div>
  );
}

/* ---------- local form modal (centred), styled to match Dialog ---------- */

function Modal({ title, sub, onClose, onSubmit, submitLabel, canSubmit, children }: {
  title: string; sub?: string; onClose: () => void; onSubmit: () => void;
  submitLabel: string; canSubmit: boolean; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('input,select')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', padding: 24, background: 'var(--color-surface-scrim)', animation: 'fade-in var(--motion-standard) var(--ease-out) both' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0 }} />
      <div ref={ref} style={{ position: 'relative', width: '100%', maxWidth: 460, maxHeight: '88vh', overflowY: 'auto', background: 'var(--color-surface-card)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-overlay)' }}>
        <form onSubmit={e => { e.preventDefault(); if (canSubmit) onSubmit(); }}>
          <div style={{ padding: '22px 22px 4px', display: 'flex', flexDirection: 'column', gap: 5 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{title}</h2>
            {sub && <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>{sub}</p>}
          </div>
          <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
          <div style={{ padding: '14px 22px', borderTop: '1px solid var(--color-border-default)', background: 'var(--color-surface-page)', display: 'flex', justifyContent: 'flex-end', gap: 9 }}>
            <Button size="sm" variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button size="sm" variant="primary" type="submit" disabled={!canSubmit} disabledReason="Fill the required fields first">{submitLabel}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

const selectStyle: CSSProperties = {
  height: 'var(--control-height)', width: '100%', boxSizing: 'border-box', padding: '0 12px',
  fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--color-text-primary)',
  background: 'var(--color-surface-card)', border: '1px solid var(--color-border-default)',
  borderRadius: 'var(--radius-control)', outline: 'none',
};
function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <label style={{ fontSize: 'var(--text-small)', fontWeight: 500, color: 'var(--color-text-muted)' }}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} style={selectStyle}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function AddBuildingModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (b: AddedBuilding) => void }) {
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState(STATES[0]);
  const canSubmit = name.trim().length > 0 && city.trim().length > 0;
  return (
    <Modal title="Add building" sub="A building holds units. Add units to it next." onClose={onClose}
      submitLabel="Add building" canSubmit={canSubmit}
      onSubmit={() => onSubmit({ name: name.trim(), city: city.trim(), state })}>
      <Field label="Building name" placeholder="e.g. Arcoris Mont Kiara" value={name} onChange={e => setName(e.target.value)} />
      <Field label="City / area" placeholder="e.g. Mont Kiara" value={city} onChange={e => setCity(e.target.value)} />
      <SelectField label="State" value={state} onChange={setState} options={STATES} />
    </Modal>
  );
}

function AddUnitModal({ building, onClose, onSubmit }: {
  building: string; onClose: () => void;
  onSubmit: (u: { unitNumber: string; ownerId: string; ownerName: string; readiness: UnitReadiness; bedrooms: number; bathrooms: number; maxGuests: number; baseRate?: number; isListed: boolean }) => void;
}) {
  const [unitNumber, setUnitNumber] = useState('');
  const [bedrooms, setBedrooms] = useState('1');
  const [bathrooms, setBathrooms] = useState('1');
  const [maxGuests, setMaxGuests] = useState('2');
  const [rate, setRate] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const canSubmit = unitNumber.trim().length > 0;
  return (
    <Modal title={`Add unit to ${building}`} sub="Core details now; full record (owner, GRR, expenses, contract) on the unit page." onClose={onClose}
      submitLabel="Add unit" canSubmit={canSubmit}
      onSubmit={() => onSubmit({
        unitNumber: unitNumber.trim(),
        ownerId: '', ownerName: ownerName.trim(),
        readiness: 'ready',
        bedrooms: Number(bedrooms) || 0, bathrooms: Number(bathrooms) || 0, maxGuests: Number(maxGuests) || 1,
        baseRate: rate ? Math.round(Number(rate) * 100) : undefined,
        isListed: false,
      })}>
      <Field label="Unit code" placeholder="e.g. #B-08-11" value={unitNumber} onChange={e => setUnitNumber(e.target.value)} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="Bedrooms" type="number" min={0} numeric value={bedrooms} onChange={e => setBedrooms(e.target.value)} />
        <Field label="Bathrooms" type="number" min={0} numeric value={bathrooms} onChange={e => setBathrooms(e.target.value)} />
        <Field label="Sleeps" type="number" min={1} numeric value={maxGuests} onChange={e => setMaxGuests(e.target.value)} />
      </div>
      <Field label="Base rate (RM / night)" type="number" min={0} numeric placeholder="e.g. 288" value={rate} onChange={e => setRate(e.target.value)} help="Optional now; set per-channel rates later on the calendar." />
      <Field label="Owner name" placeholder="Optional — assign on the unit page" value={ownerName} onChange={e => setOwnerName(e.target.value)} />
    </Modal>
  );
}
