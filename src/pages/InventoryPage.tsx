import { useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { Field } from '../components/Field';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { useUnitRoster } from '../lib/useUnitRoster';
import { api, notifyFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import { rm, date } from '../lib/format';
import { TONE, cx } from '../lib/design-tokens';
import type { Tone } from '../lib/types';

type Condition = 'good' | 'fair' | 'replace_soon' | 'damaged';
const COND_LABEL: Record<Condition, string> = { good: 'Good', fair: 'Fair', replace_soon: 'Replace soon', damaged: 'Damaged' };
const COND_TONE: Record<Condition, Tone> = { good: 'success', fair: 'neutral', replace_soon: 'warning', damaged: 'critical' };
const CONDITIONS = Object.keys(COND_LABEL) as Condition[];

type Category = 'furniture' | 'appliance' | 'electronics' | 'linen' | 'kitchenware' | 'fittings';
const CAT_LABEL: Record<Category, string> = {
  furniture: 'Furniture', appliance: 'Appliance', electronics: 'Electronics',
  linen: 'Linen', kitchenware: 'Kitchenware', fittings: 'Fittings',
};
const CATEGORIES = Object.keys(CAT_LABEL) as Category[];

interface Item {
  id: string; unitNumber: string; propertyName: string; name: string; category: Category; quantity: string;
  condition: Condition; suppliedInHouse: boolean; purchaseCost: number | null;
  installedOn: string | null; lastChecked: string | null; replaceBy: string | null; notes: string;
}
interface Payload { data: Item[]; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'i1', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', name: 'Queen bed frame and mattress', category: 'furniture', quantity: '1 set', condition: 'good', suppliedInHouse: true, purchaseCost: 320000, installedOn: '2025-03-01', lastChecked: '2026-09-12', replaceBy: '2030-03-01', notes: '' },
    { id: 'i2', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', name: 'Three-seater fabric sofa', category: 'furniture', quantity: '1', condition: 'fair', suppliedInHouse: true, purchaseCost: 185000, installedOn: '2025-03-01', lastChecked: '2026-09-12', replaceBy: '2027-06-01', notes: 'Left armrest fabric worn; steam-cleaned Sep.' },
    { id: 'i3', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', name: 'Blackout curtains', category: 'fittings', quantity: '3 windows', condition: 'replace_soon', suppliedInHouse: true, purchaseCost: 89000, installedOn: '2025-03-01', lastChecked: '2026-09-12', replaceBy: '2026-11-01', notes: 'Bedroom set sun-faded.' },
    { id: 'i4', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', name: 'Smart lock, Yale YDM4109', category: 'electronics', quantity: '1', condition: 'good', suppliedInHouse: true, purchaseCost: 145000, installedOn: '2025-03-01', lastChecked: '2026-09-12', replaceBy: null, notes: '' },
    { id: 'i5', unitNumber: '#B-08-11', propertyName: 'Arcoris', name: 'Living room blind', category: 'fittings', quantity: '1', condition: 'damaged', suppliedInHouse: true, purchaseCost: 42000, installedOn: '2025-06-05', lastChecked: '2026-09-16', replaceBy: '2026-09-30', notes: 'Cord snapped; guest reported.' },
    { id: 'i6', unitNumber: '#B-08-11', propertyName: 'Arcoris', name: 'Kitchenware bundle', category: 'kitchenware', quantity: '1 set', condition: 'good', suppliedInHouse: true, purchaseCost: 68000, installedOn: '2025-06-05', lastChecked: '2026-09-10', replaceBy: null, notes: '' },
    { id: 'i7', unitNumber: '#2207', propertyName: 'Tribeca', name: 'Dining table and 4 chairs', category: 'furniture', quantity: '1 set', condition: 'good', suppliedInHouse: true, purchaseCost: 240000, installedOn: '2024-11-05', lastChecked: '2026-09-08', replaceBy: '2029-11-05', notes: '' },
  ],
};

// Shared grid-template-columns for the table header and each row. Mirrors the
// former COLS inline value as a Tailwind arbitrary grid-cols.
const COLS_CLASS = 'grid-cols-[minmax(190px,1.9fr)_minmax(140px,1.2fr)_minmax(96px,0.8fr)_minmax(138px,1fr)_minmax(96px,0.8fr)_minmax(120px,0.95fr)_minmax(150px,1.3fr)]';
const DUE_WINDOW_DAYS = 90;

const isAttention = (i: Item) => i.condition === 'replace_soon' || i.condition === 'damaged';
/** null when not on a schedule / far out, warning within the window, critical once overdue. */
function scheduleTone(replaceBy: string | null): Tone | null {
  if (!replaceBy) return null;
  const days = (new Date(replaceBy).getTime() - Date.now()) / 86400000;
  if (days < 0) return 'critical';
  if (days <= DUE_WINDOW_DAYS) return 'warning';
  return null;
}
const isDue = (i: Item) => scheduleTone(i.replaceBy) !== null;

/** Condition pill — tint background + AA foreground, routed through TONE so the
 *  status colours resolve to the -fg foreground, never the pale root tint. */
const condPill = (c: Condition) => cx(TONE[COND_TONE[c]].bg, TONE[COND_TONE[c]].text);

type CondFilter = 'all' | 'attention' | Condition;

export default function InventoryPage() {
  const { data, loading, error, reload } = useApi<Payload>('/inventory', FALLBACK);
  const toast = useToast();

  const [added, setAdded] = useState<Item[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Item>>>({});
  const [unitFilter, setUnitFilter] = useState('all');
  const [condFilter, setCondFilter] = useState<CondFilter>('all');
  const [dueOnly, setDueOnly] = useState(false);
  const [adding, setAdding] = useState(false);

  const all = useMemo(
    () => [...added, ...(data?.data ?? [])].map(i => ({ ...i, ...edits[i.id] })),
    [added, data, edits],
  );

  const roster = useUnitRoster();
  const units = useMemo(
    () => roster.map(u => ({ unitNumber: u.unitNumber, propertyName: u.propertyName, label: `${u.propertyName} ${u.unitNumber}` })),
    [roster],
  );

  const rows = all.filter(i =>
    (unitFilter === 'all' || i.unitNumber === unitFilter) &&
    (condFilter === 'all' || (condFilter === 'attention' ? isAttention(i) : i.condition === condFilter)) &&
    (!dueOnly || isDue(i)),
  );

  const invested = all.reduce((s, i) => s + (i.purchaseCost ?? 0), 0);
  const attention = all.filter(isAttention).length;
  const dueCount = all.filter(isDue).length;
  const filtersOn = unitFilter !== 'all' || condFilter !== 'all' || dueOnly;

  function patchItem(id: string, p: Partial<Item>) {
    setEdits(e => ({ ...e, [id]: { ...e[id], ...p } }));
    // Dev has no backend; keep the optimistic edit and let the banner explain staleness.
    api.patch('/inventory', { id, ...p }).catch(notifyFailure);
  }
  function setCondition(item: Item, condition: Condition) {
    patchItem(item.id, { condition });
    toast({ tone: 'success', title: 'Condition updated.', body: `${item.name} marked ${COND_LABEL[condition].toLowerCase()}.` });
  }
  function saveNote(item: Item, notes: string) {
    patchItem(item.id, { notes });
    toast({ tone: 'success', title: notes ? 'Note saved.' : 'Note cleared.', body: item.name });
  }
  function addItem(input: Item) {
    setAdded(a => [input, ...a]);
    toast({ tone: 'success', title: 'Item added.', body: `${input.name} recorded for ${input.propertyName} ${input.unitNumber}.` });
    api.post('/inventory', input).catch(notifyFailure);
    setAdding(false);
  }
  function clearFilters() { setUnitFilter('all'); setCondFilter('all'); setDueOnly(false); }

  return (
    <>
      <PageHeader
        title="Inventory"
        sub={`${all.length} items across ${units.length} ${units.length === 1 ? 'unit' : 'units'} · fit-out register`}
        right={<Button variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setAdding(true)}>Add item</Button>}
      />

      {error && <StaleBanner message={`Showing the last register we have. ${error}`} onRetry={reload} />}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
        <Stat label="Invested in-house" value={rm(invested, { cents: false })} hint="Total fit-out value" />
        <Stat label="Needs attention" value={String(attention)} tone={attention ? 'warning' : undefined}
          active={condFilter === 'attention'} onClick={() => setCondFilter(f => f === 'attention' ? 'all' : 'attention')} hint="Replace soon or damaged" />
        <Stat label="Due for replacement" value={String(dueCount)} tone={dueCount ? 'warning' : undefined}
          active={dueOnly} onClick={() => setDueOnly(v => !v)} hint={`On schedule within ${DUE_WINDOW_DAYS} days`} />
        <Stat label="Units furnished" value={String(units.length)} hint="With items on the register" />
      </div>

      <div className="flex gap-[14px] items-end flex-wrap">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="inv-unit" className="text-[12px] font-medium text-muted-ink">Unit</label>
          <select id="inv-unit" value={unitFilter} onChange={e => setUnitFilter(e.target.value)}
            className="h-9 box-border px-3 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none min-w-[220px] cursor-pointer">
            <option value="all">All units</option>
            {units.map(u => <option key={u.unitNumber} value={u.unitNumber}>{u.label}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-muted-ink">Condition</span>
          <div className="flex gap-[7px] flex-wrap">
            <Chip label="All" active={condFilter === 'all'} onClick={() => setCondFilter('all')} />
            <Chip label="Needs attention" active={condFilter === 'attention'} onClick={() => setCondFilter('attention')} />
            {CONDITIONS.map(c => <Chip key={c} label={COND_LABEL[c]} active={condFilter === c} onClick={() => setCondFilter(c)} />)}
          </div>
        </div>

        {filtersOn && (
          <button onClick={clearFilters}
            className="h-8 flex items-center px-3 py-0 rounded-full cursor-pointer font-sans text-[16px] font-normal border border-solid border-line bg-transparent text-muted-ink">
            Clear filters
          </button>
        )}
      </div>

      <Card>
        <div className="overflow-x-auto">
          <div className="min-w-[1060px]">
            <div className={cx('grid', COLS_CLASS, 'gap-[14px] py-[9px] px-[22px] bg-muted [border-bottom:1px_solid_var(--color-line,#DEDAD3)] text-[12px] font-semibold text-muted-ink')}>
              <div>Item</div><div>Unit</div><div>Category</div><div>Condition</div><div className="text-right">Value</div><div>Replace by</div><div>Notes</div>
            </div>

            {loading && all.length === 0 ? (
              <TableSkeleton rows={6} cols={7} />
            ) : rows.length === 0 ? (
              <div className="py-[38px] px-[22px] text-center flex flex-col gap-1.5 items-center">
                <span className="text-[14px] font-semibold">{filtersOn ? 'No items match these filters.' : 'No fit-out items recorded yet.'}</span>
                <span className="text-[12.5px] text-muted-ink max-w-[380px]">
                  {filtersOn ? 'Adjust the unit or condition filter to see more of the register.' : 'Add the furniture, appliances, linen and electronics supplied for each unit to track their condition and replacement.'}
                </span>
                {filtersOn
                  ? <button onClick={clearFilters} className="bg-transparent border-none cursor-pointer font-sans text-[12.5px] font-semibold text-gold-ink">Clear filters</button>
                  : <div className="mt-1.5"><Button variant="secondary" size="sm" icon={<Icon name="Plus" size="sm" />} onClick={() => setAdding(true)}>Add item</Button></div>}
              </div>
            ) : rows.map(i => {
              const sTone = scheduleTone(i.replaceBy);
              return (
                <div key={i.id} className={cx('grid', COLS_CLASS, 'gap-[14px] items-center min-h-[54px] py-[9px] px-[22px] [border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)]')}>
                  <div className="flex flex-col gap-px min-w-0">
                    <span className="text-[13.5px]">{i.name}</span>
                    <span className="text-[11.5px] text-muted-ink">
                      {i.quantity}{i.suppliedInHouse ? ' · Supplied by The Conts' : ''}{i.installedOn ? ` · installed ${date(i.installedOn)}` : ''}
                    </span>
                  </div>
                  <div className="flex flex-col gap-px min-w-0">
                    <span className="text-[13px]">{i.unitNumber}</span>
                    <span className="text-[11.5px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{i.propertyName}</span>
                  </div>
                  <span className="text-[12.5px] text-[var(--color-ink-2)]">{CAT_LABEL[i.category]}</span>
                  <div>
                    <select value={i.condition} onChange={e => setCondition(i, e.target.value as Condition)}
                      aria-label={`Condition of ${i.name}`}
                      className={cx('h-[30px] px-2 py-0 font-sans text-[16px] font-normal cursor-pointer rounded-full border-none appearance-none text-center', condPill(i.condition))}>
                      {CONDITIONS.map(c => <option key={c} value={c}>{COND_LABEL[c]}</option>)}
                    </select>
                  </div>
                  <span className="text-[13px] text-right tabular-nums">{i.purchaseCost != null ? rm(i.purchaseCost, { cents: false }) : '—'}</span>
                  <span className={cx('text-[12.5px]', sTone ? cx(TONE[sTone].text, 'font-semibold') : 'text-muted-ink font-normal')}>
                    {i.replaceBy ? date(i.replaceBy) : '—'}
                  </span>
                  <NoteCell value={i.notes} onSave={v => saveNote(i, v)} label={i.name} />
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {adding && <AddItemModal units={units} onClose={() => setAdding(false)} onSubmit={addItem} />}
    </>
  );
}

/* ---------- small local primitives ---------- */

/** Selected uses brand black (selection, never a status tone). */
function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      className={cx('h-8 flex items-center px-[13px] py-0 rounded-full cursor-pointer font-sans text-[16px] font-normal border border-solid',
        active ? 'border-black bg-black text-white' : 'border-line bg-card text-muted-ink')}>
      {label}
    </button>
  );
}

function Stat({ label, value, hint, tone, active, onClick }: { label: string; value: string; hint?: string; tone?: Tone; active?: boolean; onClick?: () => void }) {
  const interactive = !!onClick;
  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? active : undefined}
      onClick={onClick}
      onKeyDown={interactive ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick!(); } } : undefined}
      className={cx('flex flex-col gap-[3px] py-[13px] px-[15px] rounded-card bg-card border border-solid',
        active ? 'border-black' : 'border-line',
        interactive ? 'cursor-pointer' : 'cursor-default')}>
      <span className={cx('text-[19px] font-semibold tabular-nums', tone ? TONE[tone].text : 'text-ink')}>{value}</span>
      <span className="text-[12px] font-medium">{label}</span>
      {hint && <span className="text-[11px] text-muted-ink">{hint}</span>}
    </div>
  );
}

function NoteCell({ value, onSave, label }: { value: string; onSave: (v: string) => void; label: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);

  if (editing) {
    return (
      <input autoFocus value={v} onChange={e => setV(e.target.value)}
        aria-label={`Note for ${label}`}
        placeholder="Add a note"
        onBlur={() => { setEditing(false); if (v.trim() !== value) onSave(v.trim()); }}
        onKeyDown={e => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { setV(value); setEditing(false); }
        }}
        className="h-[30px] w-full box-border px-3 py-0 font-sans text-[12px] text-ink bg-card border border-solid border-line rounded-control outline-none" />
    );
  }
  return (
    <button onClick={() => setEditing(true)} title="Edit note"
      className={cx('text-left w-full min-h-[30px] py-[5px] px-2 rounded-[6px] border border-solid bg-transparent cursor-text font-sans text-[12px] font-normal whitespace-nowrap overflow-hidden text-ellipsis',
        value ? 'border-transparent text-[var(--color-ink-2)]' : 'border-line-soft text-faint')}>
      {value || 'Add note'}
    </button>
  );
}

/* ---------- Add item modal ---------- */

interface UnitOption { unitNumber: string; propertyName: string; label: string }

function AddItemModal({ units, onClose, onSubmit }: { units: UnitOption[]; onClose: () => void; onSubmit: (i: Item) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [f, setF] = useState({
    name: '', unitNumber: units[0]?.unitNumber ?? '', newProperty: '', newUnit: '',
    category: 'furniture' as Category, quantity: '1', condition: 'good' as Condition,
    value: '', installedOn: '', replaceBy: '', notes: '',
  });
  const set = <K extends keyof typeof f>(k: K) => (e: { target: { value: string } }) => setF(s => ({ ...s, [k]: e.target.value }));
  const addingNewUnit = f.unitNumber === '__new';

  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('input,select')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const canSubmit = f.name.trim() !== '' && (addingNewUnit ? f.newProperty.trim() !== '' && f.newUnit.trim() !== '' : f.unitNumber !== '');

  function submit() {
    const unit = addingNewUnit
      ? { unitNumber: f.newUnit.trim(), propertyName: f.newProperty.trim() }
      : units.find(u => u.unitNumber === f.unitNumber)!;
    const valNum = Number(f.value);
    onSubmit({
      id: crypto.randomUUID(),
      unitNumber: unit.unitNumber, propertyName: unit.propertyName,
      name: f.name.trim(), category: f.category, quantity: f.quantity.trim() || '1',
      condition: f.condition, suppliedInHouse: true,
      purchaseCost: f.value.trim() !== '' && !Number.isNaN(valNum) ? Math.round(valNum * 100) : null,
      installedOn: f.installedOn || null,
      lastChecked: new Date().toISOString().slice(0, 10),
      replaceBy: f.replaceBy || null,
      notes: f.notes.trim(),
    });
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Add inventory item"
      className="fixed inset-0 z-[60] grid place-items-center p-6 bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={onClose} className="absolute inset-0" />
      <div ref={ref} className="relative w-full max-w-[500px] max-h-[88vh] overflow-y-auto bg-card rounded-card [box-shadow:var(--shadow-overlay)]">
        <form onSubmit={e => { e.preventDefault(); if (canSubmit) submit(); }}>
          <div className="pt-[22px] px-[22px] pb-1 flex flex-col gap-[5px]">
            <h2 className="m-0 text-[18px] font-semibold">Add inventory item</h2>
            <p className="m-0 text-[13px] text-muted-ink">Record a piece of fit-out supplied for a unit, its condition and when it is due for replacement.</p>
          </div>
          <div className="py-4 px-[22px] flex flex-col gap-[14px]">
            <Field label="Item" placeholder="e.g. Queen bed frame and mattress" value={f.name} onChange={set('name')} />

            <Sel label="Unit" value={f.unitNumber} onChange={set('unitNumber')}
              options={[...units.map(u => ({ value: u.unitNumber, label: u.label })), { value: '__new', label: 'Add a new unit…' }]} />
            {addingNewUnit && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Property" placeholder="e.g. Arte Mont Kiara" value={f.newProperty} onChange={set('newProperty')} />
                <Field label="Unit number" placeholder="e.g. #MK2-09-16" value={f.newUnit} onChange={set('newUnit')} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Sel label="Category" value={f.category} onChange={set('category')} options={CATEGORIES.map(c => ({ value: c, label: CAT_LABEL[c] }))} />
              <Field label="Quantity" placeholder="e.g. 1 set" value={f.quantity} onChange={set('quantity')} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Sel label="Condition" value={f.condition} onChange={set('condition')} options={CONDITIONS.map(c => ({ value: c, label: COND_LABEL[c] }))} />
              <Field label="Purchase value (RM)" type="number" min={0} step="0.01" numeric placeholder="e.g. 3200" value={f.value} onChange={set('value')} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Installed on" type="date" value={f.installedOn} onChange={set('installedOn')} />
              <Field label="Replace by" type="date" value={f.replaceBy} onChange={set('replaceBy')} help="Optional — sets the replacement schedule." />
            </div>

            <Field label="Notes" placeholder="Optional — condition detail, warranty, supplier" value={f.notes} onChange={set('notes')} />
          </div>
          <div className="py-[14px] px-[22px] [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page flex justify-end gap-[9px]">
            <Button size="sm" variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button size="sm" variant="primary" type="submit" disabled={!canSubmit} disabledReason="Add an item name and pick a unit first">Add item</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Sel({ label, value, onChange, options }: { label: string; value: string; onChange: (e: { target: { value: string } }) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="flex flex-col gap-[7px]">
      <label className="text-[12px] font-medium text-muted-ink">{label}</label>
      <select value={value} onChange={onChange}
        className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
