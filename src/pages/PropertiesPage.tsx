import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { cx } from '../lib/design-tokens';

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
    api.post('/units', nu).catch(() => {}); setModal(null);
  }

  const totalUnits = units.length;

  return (
    <>
      <div className="flex items-center gap-[7px] text-[12px] text-muted-ink mb-1">
        <span>Properties</span><Icon name="ChevronRight" size="sm" /><span className="text-ink font-medium">Buildings and units</span>
      </div>
      <div className="flex items-end justify-between gap-5 flex-wrap mb-4">
        <div>
          <h1 className="m-0 text-[28px] font-semibold tracking-[-0.01em]">Properties</h1>
          <div className="text-[12px] text-muted-ink mt-1">{totalUnits} units · add a building, then add units to it</div>
        </div>
        <Button variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal({ kind: 'building' })}>Add building</Button>
      </div>

      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      {loading && units.length === 0 ? <Card><TableSkeleton rows={6} cols={3} /></Card> : (
        <div className="grid grid-cols-[minmax(280px,340px)_1fr] gap-5 items-start">
          {/* LEFT: building / unit tree */}
          <Card>
            <div className="py-[13px] px-4 [border-bottom:1px_solid_var(--color-line)] flex items-center justify-between">
              <span className="text-[12.5px] font-semibold text-muted-ink">{totalUnits} units · {buildings.length} buildings</span>
              <Button size="sm" variant="secondary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal({ kind: 'building' })}>Add building</Button>
            </div>
            <div className="max-h-[68vh] overflow-y-auto">
              {Object.entries(byState).map(([state, list]) => (
                <div key={state}>
                  <div className="py-[9px] px-4 bg-page [border-bottom:1px_solid_var(--color-line-soft)] text-[10.5px] font-bold tracking-[0.08em] text-muted-ink flex justify-between">
                    <span>{state.toUpperCase()}</span><span>{list.reduce((s, b) => s + unitsOf(b.id).length, 0)} units</span>
                  </div>
                  {list.map(b => {
                    const us = unitsOf(b.id); const open = !collapsed[b.id];
                    return (
                      <div key={b.id}>
                        <div className="flex items-center gap-2 py-[10px] pr-3 pl-[14px] [border-bottom:1px_solid_var(--color-line-soft)]">
                          <button onClick={() => setCollapsed(c => ({ ...c, [b.id]: open }))} className="flex items-center gap-2 flex-1 bg-transparent [border:none] cursor-pointer [font:inherit] text-left min-w-0 p-0">
                            <span className="[transition:transform_160ms] text-muted-ink flex" style={{ transform: `rotate(${open ? 90 : 0}deg)` }}><Icon name="ChevronRight" size="sm" /></span>
                            <span className="min-w-0">
                              <div className="text-[13px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{b.name}</div>
                              <div className="text-[11px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{b.city}</div>
                            </span>
                            <span className="text-[11.5px] text-muted-ink flex-none">{us.length}</span>
                          </button>
                          <button onClick={() => setModal({ kind: 'unit', buildingId: b.id })} aria-label="Add unit" className="w-[26px] h-[26px] flex-none grid place-items-center rounded-control border border-solid border-line bg-card cursor-pointer text-muted-ink"><Icon name="Plus" size="sm" /></button>
                        </div>
                        {open && us.map(u => {
                          const on = u.id === selected?.id;
                          return (
                            <button key={u.id} onClick={() => { setSelectedId(u.id); setTab('details'); }}
                              className={cx('flex items-center gap-[10px] w-full py-[9px] pr-4 pl-[34px] [border:none] [border-bottom:1px_solid_var(--color-line-soft)]! cursor-pointer [font:inherit] text-left', on ? 'bg-gold-tint shadow-[inset_3px_0_0_var(--color-gold)]' : 'bg-card')}>
                              <span className="flex-1 min-w-0">
                                <div className={cx('text-[12.5px] whitespace-nowrap overflow-hidden text-ellipsis', on ? 'font-semibold' : 'font-medium')}>{u.unitCode || 'New unit'}</div>
                                <div className="text-[11px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{u.ownerName || 'No owner yet'}</div>
                              </span>
                              <span className="text-[9.5px] font-bold text-gold-ink flex-none">{u.pkg.replace('Package ', 'Pkg ')}</span>
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
            <Card><div className="p-10 text-center text-muted-ink text-[13.5px]">Select a unit on the left, or add one.</div></Card>
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
      <div className="pt-[18px] px-[22px] pb-0">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="text-[11px] font-bold tracking-[0.06em] text-muted-ink">{buildingName.toUpperCase()} · {u.state}</div>
            <h2 className="mt-1 mb-0 text-[20px] font-semibold tracking-[-0.01em]">{u.listingName || 'New unit'}</h2>
            <div className="flex gap-[7px] mt-[9px] flex-wrap">
              <Badge tone="neutral" label={u.pkg} />
              <Badge tone="info" label={u.term} />
              <Badge tone={u.split === 'Not set' ? 'neutral' : 'success'} label={u.split === 'Not set' ? 'Split not set' : u.split.split(' ')[0]} />
            </div>
          </div>
          <Button variant="primary" size="sm" onClick={onSave}>Save changes</Button>
        </div>
        <div className="flex gap-0.5 mt-4 [border-bottom:1px_solid_var(--color-line)]">
          {([['details', 'Details'], ['expenses', 'Monthly expenses'], ['contract', 'Contract and documents']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={cx('py-[11px] px-1 mr-5 [border:none] bg-transparent cursor-pointer font-sans text-[13px]', tab === k ? 'font-semibold text-ink shadow-[inset_0_-2px_0_var(--color-gold)]' : 'font-normal text-muted-ink shadow-none')}>{label}</button>
          ))}
        </div>
      </div>

      <div className="p-[22px]">
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
  const toast = useToast();
  const total = u.expenses.reduce((s, e) => s + e.amount, 0);
  const setAmt = (id: string, rmv: string) => onChange({ expenses: u.expenses.map(e => e.id === id ? { ...e, amount: Math.round(Number(rmv || 0) * 100) } : e) });
  const add = () => onChange({ expenses: [...u.expenses, ex(crypto.randomUUID(), 'Other', 0)] });
  function generateReport() {
    const period = new Date().toISOString().slice(0, 7);
    toast({ tone: 'info', title: 'Preparing report', body: `Expenses for ${u.unitCode || 'this unit'} — served as a download.` });
    api.get('/expenses/report', { unitId: u.id, period }).catch(() => { /* dev: no backend / binary body */ });
  }
  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <SectionHead noMargin>Monthly expenses</SectionHead>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" icon={<Icon name="Download" size="sm" />} onClick={generateReport}>Generate report</Button>
          <Button size="sm" variant="secondary" icon={<Icon name="Plus" size="sm" />} onClick={add}>Add expense</Button>
        </div>
      </div>
      <div className="border border-solid border-line rounded-card overflow-hidden">
        {u.expenses.map(e => (
          <div key={e.id} className="grid grid-cols-[1fr_160px] gap-3 items-center py-[10px] px-[14px] [border-bottom:1px_solid_var(--color-line-soft)]">
            <input value={e.category} onChange={ev => onChange({ expenses: u.expenses.map(x => x.id === e.id ? { ...x, category: ev.target.value } : x) })} className="field-input h-[38px]!" />
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] text-muted-ink">RM</span>
              <input type="number" value={String(Math.round(e.amount / 100))} onChange={ev => setAmt(e.id, ev.target.value)} className="field-input h-[38px]! text-right tabular-nums" />
            </div>
          </div>
        ))}
        <div className="flex justify-between py-3 px-[14px] bg-muted">
          <span className="text-[13px] font-semibold">Total monthly</span>
          <span className="text-[13px] font-semibold">{rm(total)}</span>
        </div>
      </div>
      <p className="text-[12px] text-muted-ink mt-[10px]">Deducted from the owner statement each month. Manual now; utilities API later.</p>
    </div>
  );
}

function ContractTab({ u, onChange }: { u: Unit; onChange: (p: Partial<Unit>) => void }) {
  const c = u.contract;
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  function download(d: { id: string; name: string }) {
    toast({ tone: 'info', title: 'Preparing download', body: `${d.name} — served as a signed link.` });
    api.get(`/documents/${d.id}/download`).catch(() => { /* dev: no backend / binary body */ });
  }
  function upload(file: File) {
    const doc = { id: crypto.randomUUID(), name: file.name };
    onChange({ contract: { ...c, documents: [...c.documents, doc] } });
    toast({ tone: 'success', title: 'Document uploaded.', body: `${file.name} added to this unit.` });
    const fd = new FormData();
    fd.append('file', file); fd.append('unitId', u.id); fd.append('kind', 'contract');
    api.post('/documents', fd).catch(() => { /* dev: no backend */ });
  }
  return (
    <div>
      <SectionHead>Contract</SectionHead>
      <Grid3>
        <Labeled label="Management fee %" hint="AMOUNT"><Field label="" type="number" numeric value={String(c.feePct)} onChange={e => onChange({ contract: { ...c, feePct: Number(e.target.value) || 0 } })} /></Labeled>
        <Labeled label="Start date" hint="DATE"><Field label="" type="date" value={c.startedOn} onChange={e => onChange({ contract: { ...c, startedOn: e.target.value } })} /></Labeled>
        <Labeled label="Renews on" hint="DATE"><Field label="" type="date" value={c.renewsOn} onChange={e => onChange({ contract: { ...c, renewsOn: e.target.value } })} /></Labeled>
      </Grid3>
      <SectionHead>Documents</SectionHead>
      <div className="border border-solid border-line rounded-card overflow-hidden">
        {c.documents.map(d => (
          <div key={d.id} className="flex items-center gap-[10px] py-[11px] px-[14px] [border-bottom:1px_solid_var(--color-line-soft)]">
            <Icon name="FileText" size="sm" /><span className="text-[13px] flex-1">{d.name}</span>
            <button onClick={() => download(d)} className="bg-transparent [border:none] cursor-pointer text-gold-ink [font:inherit]">Download</button>
          </div>
        ))}
        <button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 w-full py-[11px] px-[14px] bg-page [border:none] cursor-pointer font-sans text-[12.5px] font-medium text-muted-ink">
          <Icon name="Upload" size="sm" /> Upload a document
        </button>
        <input ref={fileRef} type="file" className="hidden" onChange={e => { const f = e.currentTarget.files?.item(0); if (f) upload(f); e.currentTarget.value = ''; }} />
      </div>
    </div>
  );
}

/* ---- small building blocks ---- */
function SectionHead({ children, noMargin }: { children: ReactNode; noMargin?: boolean }) {
  return <div className={cx('text-[11px] font-bold tracking-[0.08em] text-muted-ink', noMargin ? 'm-0' : 'mt-1 mb-[14px]')}>{String(children).toUpperCase()}</div>;
}
function Grid3({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4 mb-[22px]">{children}</div>;
}
function Labeled({ label, hint, help, span2, children }: { label: string; hint: string; help?: string; span2?: boolean; children: ReactNode }) {
  return (
    <div className={cx('flex flex-col gap-1.5', span2 && '[grid-column:span_2]')}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-muted-ink">{label}</span>
        <span className="text-[9px] font-bold tracking-[0.08em] text-faint">{hint}</span>
      </div>
      {children}
      {help && <span className="text-[11px] text-muted-ink">{help}</span>}
    </div>
  );
}
function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return <select value={value} onChange={e => onChange(e.target.value)} className="h-[var(--control-height)] w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none">{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
}

function CentreModal({ title, sub, onClose, footer, children }: { title: string; sub?: string; onClose: () => void; footer: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLInputElement>('input,select')?.focus(); const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[60] grid place-items-center p-6 bg-[var(--color-surface-scrim)]">
      <div onClick={onClose} className="absolute inset-0" />
      <div ref={ref} className="relative w-full max-w-[440px] bg-card rounded-card shadow-[var(--shadow-overlay)]">
        <div className="pt-[22px] px-[22px] pb-1"><h2 className="m-0 text-[18px] font-semibold">{title}</h2>{sub && <p className="mt-[5px] mb-0 text-[13px] text-muted-ink">{sub}</p>}</div>
        <div className="py-4 px-[22px] flex flex-col gap-[14px]">{children}</div>
        <div className="py-[14px] px-[22px] [border-top:1px_solid_var(--color-line)] bg-page flex justify-end gap-[9px]">{footer}</div>
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
      <p className="m-0 text-[13px] text-muted-ink">You will set the listing name, code, owner, package and GRR on the unit form.</p>
    </CentreModal>
  );
}
