import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { color, radius, text } from '../theme';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import Icon from '../components/Icon';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { rm } from '../lib/format';

const STATES = ['Kuala Lumpur', 'Selangor', 'Penang', 'Johor', 'Melaka', 'Perak', 'Negeri Sembilan'];
const BANKS = ['MBBE', 'PBBB', 'CIBB', 'RHBB', 'HLBB', 'AMBB', 'BIMB', 'UOVB', 'OCBC'];
const PACKAGES = ['Package A', 'Package B', 'Package C'];
const TERMS = ['Long term', 'Short term'];
const SPLITS = ['Not set', 'Profit share', 'GRR — guaranteed rent'];

interface Expense { id: string; category: string; amount: number; note: string }
interface Unit {
  id: string; buildingId: string;
  listingName: string; unitCode: string; state: string; address: string;
  ownerName: string; ic: string; bankName: string; bankAccount: string; accountHolder: string;
  pkg: string; term: string; split: string; splitValue: number | null;
  expenses: Expense[];
  contract: { feePct: number; startedOn: string; renewsOn: string; documents: { id: string; name: string }[] };
}
interface Building { id: string; name: string; city: string; state: string }
interface Payload { buildings: Building[]; units: Unit[]; generatedAt: string }

const ex = (id: string, category: string, amount: number, note = ''): Expense => ({ id, category, amount, note });
const mkUnit = (id: string, buildingId: string, listingName: string, unitCode: string, state: string, address: string, owner: Partial<Unit>): Unit => ({
  id, buildingId, listingName, unitCode, state, address,
  ownerName: owner.ownerName ?? '', ic: owner.ic ?? '', bankName: owner.bankName ?? BANKS[1], bankAccount: owner.bankAccount ?? '', accountHolder: owner.accountHolder ?? owner.ownerName ?? '',
  pkg: owner.pkg ?? 'Package C', term: owner.term ?? 'Long term', split: owner.split ?? 'Not set', splitValue: owner.splitValue ?? null,
  expenses: owner.expenses ?? [ex('e1', 'Internet', 12900), ex('e2', 'Electricity', 18000), ex('e3', 'Water', 4500), ex('e4', 'Cleaning', 35000)],
  contract: owner.contract ?? { feePct: 25, startedOn: '2025-06-01', renewsOn: '2027-06-01', documents: [{ id: 'd1', name: 'Management agreement.pdf' }, { id: 'd2', name: 'Offer letter.pdf' }] },
});

const FALLBACK: Payload = {
  generatedAt: '',
  buildings: [
    { id: 'b1', name: 'Agile Bukit Bintang', city: 'Imbi, 55100 KL', state: 'Kuala Lumpur' },
    { id: 'b2', name: 'Arte Mont Kiara', city: 'Mont Kiara, 50480 KL', state: 'Kuala Lumpur' },
    { id: 'b3', name: 'Anggun Residences', city: 'Chow Kit, 50300 KL', state: 'Kuala Lumpur' },
    { id: 'b4', name: '8th Stellar Sri Petaling', city: 'Sri Petaling, 57000 KL', state: 'Kuala Lumpur' },
    { id: 'b5', name: 'Skyline KLCC', city: 'Jalan Yap Kwan Seng, 50450 KL', state: 'Kuala Lumpur' },
    { id: 'b6', name: 'Continew', city: 'Cheras, 56000 KL', state: 'Selangor' },
  ],
  units: [
    mkUnit('u1', 'b1', 'Hikari Grove #400M>TRX #500M>Pavilion #105', 'AGILE-C1313A', 'Kuala Lumpur', 'C-13-13A, Lot 1160, Jalan Bukit Bintang', { ownerName: 'LIANG WOOI KEE', ic: '680606-08-5101', bankName: 'PBBB', bankAccount: '4605371109', accountHolder: 'LIANG WOOI KEE & TAN KA CHENG', pkg: 'Package C' }),
    mkUnit('u2', 'b1', 'Agile Skyline Suite', 'AGILE-C3713A', 'Kuala Lumpur', 'C-37-13A, Lot 1160, Jalan Bukit Bintang', { ownerName: 'WONG SIEW MING', ic: '710214-14-5220', bankName: 'MBBE', bankAccount: '1512988771', pkg: 'Package A' }),
    mkUnit('u3', 'b2', 'Arte KLCC View 2BR', 'ARTE-MK2-0916', 'Kuala Lumpur', 'MK2-09-16, Jalan Dutamas, Mont Kiara', { ownerName: 'Rajesh Kumar', ic: '650930-10-5333', bankName: 'CIBB', bankAccount: '7024551200', pkg: 'Package B', split: 'GRR — guaranteed rent', splitValue: 350000 }),
    mkUnit('u4', 'b2', 'Arte Garden Studio', 'ARTE-MK2-0915', 'Kuala Lumpur', 'MK2-09-15, Jalan Dutamas, Mont Kiara', { ownerName: 'Chong Wei Han', ic: '730118-08-5019', bankName: 'PBBB', bankAccount: '3388120945' }),
    mkUnit('u5', 'b3', 'Anggun City Loft', 'ANGG-2207', 'Kuala Lumpur', '#2207, Jalan Raja Bot, Chow Kit', { ownerName: 'Nur Aisyah', ic: '820903-14-5108', bankName: 'RHBB', bankAccount: '2140099231' }),
    mkUnit('u6', 'b4', '8th Stellar 1BR', 'STEL-A1706', 'Kuala Lumpur', 'A-17-06, Jalan Radin, Sri Petaling', { ownerName: 'Tan Boon Huat', ic: '690722-08-5411', bankName: 'HLBB', bankAccount: '1990552073' }),
    mkUnit('u7', 'b5', 'Skyline KLCC High Floor', 'SKY-D2613', 'Kuala Lumpur', 'D-26-13, Jalan Yap Kwan Seng', { ownerName: 'Lim Chee Keong', ic: '660118-10-5223', bankName: 'PBBB', bankAccount: '4605371109', pkg: 'Package B' }),
    mkUnit('u8', 'b5', 'Skyline KLCC 2BR', 'SKY-C1513', 'Kuala Lumpur', 'C-15-13, Jalan Yap Kwan Seng', { ownerName: 'Goh Family Trust', ic: 'A2244551', bankName: 'OCBC', bankAccount: '7013220041' }),
    mkUnit('u9', 'b5', 'Skyline KLCC Studio', 'SKY-B3201', 'Kuala Lumpur', 'B-32-01, Jalan Yap Kwan Seng', { ownerName: 'Cassandra Low', ic: '900511-14-6002', bankName: 'MBBE', bankAccount: '5120087744' }),
    mkUnit('u10', 'b6', 'Continew Cheras 2BR', 'CONT-B2603A', 'Selangor', 'B-26-03A, Jalan Cheras', { ownerName: 'Lim Chun Teck', ic: '780304-10-5119', bankName: 'CIBB', bankAccount: '7024119002' }),
  ],
};

const FT: CSSProperties = { fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: color.faint };

export default function PropertiesPage() {
  const { data, loading, error, reload } = useApi<Payload>('/properties', FALLBACK);
  const toast = useToast();
  const [addedB, setAddedB] = useState<Building[]>([]);
  const [addedU, setAddedU] = useState<Unit[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Unit>>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'details' | 'expenses' | 'contract'>('details');
  const [modal, setModal] = useState<null | { kind: 'building' } | { kind: 'unit'; buildingId: string }>(null);

  const buildings = [...addedB, ...(data?.buildings ?? [])];
  const units = useMemo(() => [...addedU, ...(data?.units ?? [])].map(u => ({ ...u, ...edits[u.id] })), [addedU, data, edits]);
  const selected = units.find(u => u.id === selectedId) ?? units[0] ?? null;

  useEffect(() => { if (!selectedId && units[0]) setSelectedId(units[0].id); }, [units, selectedId]);

  const byState: Record<string, Building[]> = {};
  buildings.forEach(b => (byState[b.state] ??= []).push(b));
  const unitsOf = (bid: string) => units.filter(u => u.buildingId === bid);

  function patch(id: string, p: Partial<Unit>) { setEdits(e => ({ ...e, [id]: { ...e[id], ...p } })); }
  function save(u: Unit) {
    toast({ tone: 'success', title: 'Changes saved.', body: `${u.listingName || u.unitCode} updated.` });
    api.patch(`/units/${u.id}`, u).catch(() => {});
  }
  function addBuilding(b: Omit<Building, 'id'>) {
    const nb = { id: crypto.randomUUID(), ...b };
    setAddedB(l => [nb, ...l]); setCollapsed(c => ({ ...c, [nb.id]: false }));
    toast({ tone: 'success', title: 'Building added.', body: `${b.name} — add units to it.` });
    api.post('/properties', b).catch(() => {}); setModal(null);
  }
  function addUnit(buildingId: string) {
    const nu = mkUnit(crypto.randomUUID(), buildingId, '', '', buildings.find(b => b.id === buildingId)?.state ?? STATES[0], '', { ownerName: '' });
    setAddedU(l => [nu, ...l]); setSelectedId(nu.id); setTab('details');
    toast({ tone: 'success', title: 'Unit added.', body: 'Fill in its details on the right.' });
    setModal(null);
  }

  const totalUnits = units.length;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: text.small, color: color.textMuted, marginBottom: 4 }}>
        <span>Properties</span><Icon name="ChevronRight" size="sm" /><span style={{ color: color.ink, fontWeight: 500 }}>Buildings and units</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: text.pageTitle, fontWeight: 600, letterSpacing: '-0.01em' }}>Properties</h1>
          <div style={{ fontSize: text.small, color: color.textMuted, marginTop: 4 }}>{totalUnits} units · add a building, then add units to it</div>
        </div>
        <Button variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal({ kind: 'building' })}>Add building</Button>
      </div>

      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      {loading && units.length === 0 ? <Card><TableSkeleton rows={6} cols={3} /></Card> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px,340px) 1fr', gap: 20, alignItems: 'start' }}>
          {/* LEFT: building / unit tree */}
          <Card>
            <div style={{ padding: '13px 16px', borderBottom: `1px solid ${color.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: color.textMuted }}>{totalUnits} units · {buildings.length} buildings</span>
              <Button size="sm" variant="secondary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal({ kind: 'building' })}>Add building</Button>
            </div>
            <div style={{ maxHeight: '68vh', overflowY: 'auto' }}>
              {Object.entries(byState).map(([state, list]) => (
                <div key={state}>
                  <div style={{ padding: '9px 16px', background: color.page, borderBottom: `1px solid ${color.borderMuted}`, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: color.textMuted, display: 'flex', justifyContent: 'space-between' }}>
                    <span>{state.toUpperCase()}</span><span>{list.reduce((s, b) => s + unitsOf(b.id).length, 0)} units</span>
                  </div>
                  {list.map(b => {
                    const us = unitsOf(b.id); const open = !collapsed[b.id];
                    return (
                      <div key={b.id}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 10px 14px', borderBottom: `1px solid ${color.borderMuted}` }}>
                          <button onClick={() => setCollapsed(c => ({ ...c, [b.id]: open }))} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', textAlign: 'left', minWidth: 0, padding: 0 }}>
                            <span style={{ transition: 'transform 160ms', transform: `rotate(${open ? 90 : 0}deg)`, color: color.textMuted, display: 'flex' }}><Icon name="ChevronRight" size="sm" /></span>
                            <span style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</div>
                              <div style={{ fontSize: 11, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.city}</div>
                            </span>
                            <span style={{ fontSize: 11.5, color: color.textMuted, flex: 'none' }}>{us.length}</span>
                          </button>
                          <button onClick={() => setModal({ kind: 'unit', buildingId: b.id })} aria-label="Add unit" style={{ width: 26, height: 26, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: radius.control, border: `1px solid ${color.border}`, background: '#FFF', cursor: 'pointer', color: color.textMuted }}><Icon name="Plus" size="sm" /></button>
                        </div>
                        {open && us.map(u => {
                          const on = u.id === selected?.id;
                          return (
                            <button key={u.id} onClick={() => { setSelectedId(u.id); setTab('details'); }}
                              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 16px 9px 34px', border: 'none', borderBottom: `1px solid ${color.borderMuted}`, cursor: 'pointer', font: 'inherit', textAlign: 'left', background: on ? color.goldTint : '#FFF', boxShadow: on ? `inset 3px 0 0 ${color.gold}` : undefined }}>
                              <span style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12.5, fontWeight: on ? 600 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.unitCode || 'New unit'}</div>
                                <div style={{ fontSize: 11, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.ownerName || 'No owner yet'}</div>
                              </span>
                              <span style={{ fontSize: 9.5, fontWeight: 700, color: color.goldInk, flex: 'none' }}>{u.pkg.replace('Package ', 'Pkg ')}</span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </Card>

          {/* RIGHT: unit edit form */}
          {selected ? <UnitForm key={selected.id} u={selected} buildings={buildings}
            onChange={p => patch(selected.id, p)} onSave={() => save(selected)} tab={tab} setTab={setTab} /> : (
            <Card><div style={{ padding: 40, textAlign: 'center', color: color.textMuted, fontSize: 13.5 }}>Select a unit on the left, or add one.</div></Card>
          )}
        </div>
      )}

      {modal?.kind === 'building' && <AddBuildingModal onClose={() => setModal(null)} onSubmit={addBuilding} />}
      {modal?.kind === 'unit' && <ConfirmAddUnit building={buildings.find(b => b.id === modal.buildingId)?.name ?? ''} onClose={() => setModal(null)} onConfirm={() => addUnit(modal.buildingId)} />}
    </>
  );
}

function UnitForm({ u, buildings, onChange, onSave, tab, setTab }: {
  u: Unit; buildings: Building[]; onChange: (p: Partial<Unit>) => void; onSave: () => void;
  tab: 'details' | 'expenses' | 'contract'; setTab: (t: 'details' | 'expenses' | 'contract') => void;
}) {
  const buildingName = buildings.find(b => b.id === u.buildingId)?.name ?? '';
  return (
    <Card>
      <div style={{ padding: '18px 22px 0' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: color.textMuted }}>{buildingName.toUpperCase()} · {u.state}</div>
            <h2 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em' }}>{u.listingName || 'New unit'}</h2>
            <div style={{ display: 'flex', gap: 7, marginTop: 9, flexWrap: 'wrap' }}>
              <Badge tone="neutral" label={u.pkg} />
              <Badge tone="info" label={u.term} />
              <Badge tone={u.split === 'Not set' ? 'neutral' : 'success'} label={u.split === 'Not set' ? 'Split not set' : u.split.split(' ')[0]} />
            </div>
          </div>
          <Button variant="primary" size="sm" onClick={onSave}>Save changes</Button>
        </div>
        <div style={{ display: 'flex', gap: 2, marginTop: 16, borderBottom: `1px solid ${color.border}` }}>
          {([['details', 'Details'], ['expenses', 'Monthly expenses'], ['contract', 'Contract and documents']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} style={{ padding: '11px 4px', marginRight: 20, border: 'none', background: 'none', cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: tab === k ? 600 : 400, color: tab === k ? color.ink : color.textMuted, boxShadow: tab === k ? `inset 0 -2px 0 ${color.gold}` : 'none' }}>{label}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: 22 }}>
        {tab === 'details' && <>
          <SectionHead>Listing</SectionHead>
          <Grid3>
            <Labeled label="Listing name" hint="FREE TEXT" help="Exactly as published on the channels">
              <Field label="" value={u.listingName} onChange={e => onChange({ listingName: e.target.value })} />
            </Labeled>
            <Labeled label="Unit code" hint="FREE TEXT" help="Building prefix plus unit, created by The Conts">
              <Field label="" value={u.unitCode} onChange={e => onChange({ unitCode: e.target.value })} />
            </Labeled>
            <Labeled label="Building" hint="DROPDOWN">
              <Select value={u.buildingId} onChange={v => onChange({ buildingId: v })} options={buildings.map(b => ({ value: b.id, label: b.name }))} />
            </Labeled>
            <Labeled label="State" hint="DROPDOWN">
              <Select value={u.state} onChange={v => onChange({ state: v })} options={STATES.map(s => ({ value: s, label: s }))} />
            </Labeled>
            <Labeled label="Address" hint="FREE TEXT" span2>
              <Field label="" value={u.address} onChange={e => onChange({ address: e.target.value })} />
            </Labeled>
          </Grid3>

          <SectionHead>Owner</SectionHead>
          <Grid3>
            <Labeled label="Owner name" hint="FREE TEXT"><Field label="" value={u.ownerName} onChange={e => onChange({ ownerName: e.target.value })} /></Labeled>
            <Labeled label="IC or passport" hint="FREE TEXT" help="Accepts both formats"><Field label="" value={u.ic} onChange={e => onChange({ ic: e.target.value })} /></Labeled>
            <Labeled label="Bank name" hint="DROPDOWN"><Select value={u.bankName} onChange={v => onChange({ bankName: v })} options={BANKS.map(b => ({ value: b, label: b }))} /></Labeled>
            <Labeled label="Bank account" hint="FREE TEXT"><Field label="" value={u.bankAccount} onChange={e => onChange({ bankAccount: e.target.value })} /></Labeled>
            <Labeled label="Account holder" hint="FREE TEXT" span2><Field label="" value={u.accountHolder} onChange={e => onChange({ accountHolder: e.target.value })} /></Labeled>
          </Grid3>

          <SectionHead>Revenue model</SectionHead>
          <Grid3>
            <Labeled label="Package" hint="DROPDOWN"><Select value={u.pkg} onChange={v => onChange({ pkg: v })} options={PACKAGES.map(p => ({ value: p, label: p }))} /></Labeled>
            <Labeled label="Rental term" hint="DROPDOWN"><Select value={u.term} onChange={v => onChange({ term: v })} options={TERMS.map(t => ({ value: t, label: t }))} /></Labeled>
            <Labeled label="Split / GRR" hint="DROPDOWN"><Select value={u.split} onChange={v => onChange({ split: v })} options={SPLITS.map(s => ({ value: s, label: s }))} /></Labeled>
            {u.split.startsWith('GRR') && (
              <Labeled label="Guaranteed rent (RM / month)" hint="AMOUNT"><Field label="" type="number" numeric value={u.splitValue != null ? String(Math.round(u.splitValue / 100)) : ''} onChange={e => onChange({ splitValue: e.target.value ? Math.round(Number(e.target.value) * 100) : null })} /></Labeled>
            )}
          </Grid3>
        </>}

        {tab === 'expenses' && <MonthlyExpenses u={u} onChange={onChange} />}
        {tab === 'contract' && <ContractTab u={u} onChange={onChange} />}
      </div>
    </Card>
  );
}

function MonthlyExpenses({ u, onChange }: { u: Unit; onChange: (p: Partial<Unit>) => void }) {
  const total = u.expenses.reduce((s, e) => s + e.amount, 0);
  const setAmt = (id: string, rmv: string) => onChange({ expenses: u.expenses.map(e => e.id === id ? { ...e, amount: Math.round(Number(rmv || 0) * 100) } : e) });
  const add = () => onChange({ expenses: [...u.expenses, ex(crypto.randomUUID(), 'Other', 0)] });
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <SectionHead noMargin>Monthly expenses</SectionHead>
        <Button size="sm" variant="secondary" icon={<Icon name="Plus" size="sm" />} onClick={add}>Add expense</Button>
      </div>
      <div style={{ border: `1px solid ${color.border}`, borderRadius: radius.card, overflow: 'hidden' }}>
        {u.expenses.map(e => (
          <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 12, alignItems: 'center', padding: '10px 14px', borderBottom: `1px solid ${color.borderMuted}` }}>
            <input value={e.category} onChange={ev => onChange({ expenses: u.expenses.map(x => x.id === e.id ? { ...x, category: ev.target.value } : x) })} className="field-input" style={{ height: 38 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: color.textMuted }}>RM</span>
              <input type="number" value={String(Math.round(e.amount / 100))} onChange={ev => setAmt(e.id, ev.target.value)} className="field-input" style={{ height: 38, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} />
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 14px', background: color.muted }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Total monthly</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{rm(total)}</span>
        </div>
      </div>
      <p style={{ fontSize: 12, color: color.textMuted, marginTop: 10 }}>Deducted from the owner statement each month. Manual now; utilities API later.</p>
    </div>
  );
}

function ContractTab({ u, onChange }: { u: Unit; onChange: (p: Partial<Unit>) => void }) {
  const c = u.contract;
  return (
    <div>
      <SectionHead>Contract</SectionHead>
      <Grid3>
        <Labeled label="Management fee %" hint="AMOUNT"><Field label="" type="number" numeric value={String(c.feePct)} onChange={e => onChange({ contract: { ...c, feePct: Number(e.target.value) || 0 } })} /></Labeled>
        <Labeled label="Start date" hint="DATE"><Field label="" type="date" value={c.startedOn} onChange={e => onChange({ contract: { ...c, startedOn: e.target.value } })} /></Labeled>
        <Labeled label="Renews on" hint="DATE"><Field label="" type="date" value={c.renewsOn} onChange={e => onChange({ contract: { ...c, renewsOn: e.target.value } })} /></Labeled>
      </Grid3>
      <SectionHead>Documents</SectionHead>
      <div style={{ border: `1px solid ${color.border}`, borderRadius: radius.card, overflow: 'hidden' }}>
        {c.documents.map(d => (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: `1px solid ${color.borderMuted}` }}>
            <Icon name="FileText" size="sm" /><span style={{ fontSize: 13, flex: 1 }}>{d.name}</span>
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-accent)', fontSize: 12.5, fontWeight: 500, font: 'inherit' }}>Download</button>
          </div>
        ))}
        <button style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '11px 14px', background: color.page, border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 12.5, fontWeight: 500, color: color.textMuted }}>
          <Icon name="Upload" size="sm" /> Upload a document
        </button>
      </div>
    </div>
  );
}

/* ---- small building blocks ---- */
function SectionHead({ children, noMargin }: { children: ReactNode; noMargin?: boolean }) {
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: color.textMuted, margin: noMargin ? 0 : '4px 0 14px' }}>{String(children).toUpperCase()}</div>;
}
function Grid3({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16, marginBottom: 22 }}>{children}</div>;
}
function Labeled({ label, hint, help, span2, children }: { label: string; hint: string; help?: string; span2?: boolean; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, gridColumn: span2 ? 'span 2' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 'var(--text-small)', fontWeight: 500, color: 'var(--color-text-muted)' }}>{label}</span>
        <span style={FT}>{hint}</span>
      </div>
      {children}
      {help && <span style={{ fontSize: 11, color: color.textMuted }}>{help}</span>}
    </div>
  );
}
const selectStyle: CSSProperties = { height: 'var(--control-height)', width: '100%', boxSizing: 'border-box', padding: '0 12px', fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--color-text-primary)', background: 'var(--color-surface-card)', border: '1px solid var(--color-border-default)', borderRadius: 'var(--radius-control)', outline: 'none' };
function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return <select value={value} onChange={e => onChange(e.target.value)} style={selectStyle}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
}

function CentreModal({ title, sub, onClose, footer, children }: { title: string; sub?: string; onClose: () => void; footer: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLInputElement>('input,select')?.focus(); const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', padding: 24, background: 'var(--color-surface-scrim)' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0 }} />
      <div ref={ref} style={{ position: 'relative', width: '100%', maxWidth: 440, background: 'var(--color-surface-card)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-overlay)' }}>
        <div style={{ padding: '22px 22px 4px' }}><h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{title}</h2>{sub && <p style={{ margin: '5px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>{sub}</p>}</div>
        <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--color-border-default)', background: 'var(--color-surface-page)', display: 'flex', justifyContent: 'flex-end', gap: 9 }}>{footer}</div>
      </div>
    </div>
  );
}
function AddBuildingModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (b: Omit<Building, 'id'>) => void }) {
  const [name, setName] = useState(''); const [city, setCity] = useState(''); const [state, setState] = useState(STATES[0]);
  const ok = name.trim() !== '' && city.trim() !== '';
  return (
    <CentreModal title="Add building" sub="A building holds units. Add units to it next." onClose={onClose}
      footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button size="sm" variant="primary" disabled={!ok} disabledReason="Fill name and city" onClick={() => onSubmit({ name: name.trim(), city: city.trim(), state })}>Add building</Button></>}>
      <Field label="Building name" placeholder="e.g. Arte Mont Kiara" value={name} onChange={e => setName(e.target.value)} />
      <Field label="City / area" placeholder="e.g. Mont Kiara, 50480 KL" value={city} onChange={e => setCity(e.target.value)} />
      <Labeled label="State" hint="DROPDOWN"><Select value={state} onChange={setState} options={STATES.map(s => ({ value: s, label: s }))} /></Labeled>
    </CentreModal>
  );
}
function ConfirmAddUnit({ building, onClose, onConfirm }: { building: string; onClose: () => void; onConfirm: () => void }) {
  return (
    <CentreModal title={`Add a unit to ${building}`} sub="A blank unit will open on the right for you to fill in." onClose={onClose}
      footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button size="sm" variant="primary" onClick={onConfirm}>Add unit</Button></>}>
      <p style={{ margin: 0, fontSize: 13, color: color.textMuted }}>You will set the listing name, code, owner, package and GRR on the unit form.</p>
    </CentreModal>
  );
}
