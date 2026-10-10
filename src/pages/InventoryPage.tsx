import { useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { SearchSelect, Select } from '../components/Select';
import { Dot } from '../components/Badge';
import { EmptyState } from '../components/States';
import { Chip } from './finance/listKit';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { Field } from '../components/Field';
import { MoneyInput, DateField } from '../components/inputs';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { useUnitRoster } from '../lib/useUnitRoster';
import { api, notifyFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import { rm, date, todayMyt, plural } from '../lib/format';
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

type CondFilter = 'all' | 'attention' | Condition;

export default function InventoryPage() {
  const { data, loading, error, reload } = useApi<Payload>('/inventory', FALLBACK);
  const toast = useToast();

  const [edits, setEdits] = useState<Record<string, Partial<Item>>>({});
  const [unitFilter, setUnitFilter] = useState('all');
  const [condFilter, setCondFilter] = useState<CondFilter>('all');
  const [dueOnly, setDueOnly] = useState(false);
  const [adding, setAdding] = useState(false);

  const all = useMemo(
    () => (data?.data ?? []).map(i => ({ ...i, ...edits[i.id] })),
    [data, edits],
  );

  const roster = useUnitRoster();
  const units = useMemo(
    () => roster.map(u => ({ unitNumber: u.unitNumber, propertyName: u.propertyName, label: `${u.propertyName} ${u.unitNumber}` })),
    [roster],
  );
  // Units the header/stat report are the distinct units actually present in the
  // register — derived from the items themselves, not the unit roster, which is
  // empty when its own endpoint is unavailable (leaving a wrong "0 units").
  const unitCount = useMemo(() => new Set(all.map(i => i.unitNumber)).size, [all]);

  const rows = all.filter(i =>
    (unitFilter === 'all' || `${i.propertyName}|${i.unitNumber}` === unitFilter) &&
    (condFilter === 'all' || (condFilter === 'attention' ? isAttention(i) : i.condition === condFilter)) &&
    (!dueOnly || isDue(i)),
  );

  const invested = all.reduce((s, i) => s + (i.purchaseCost ?? 0), 0);
  const attention = all.filter(isAttention).length;
  const dueCount = all.filter(isDue).length;
  const filtersOn = unitFilter !== 'all' || condFilter !== 'all' || dueOnly;

  /** Show the change now; toast once saved, or put the old value back if the server refuses. */
  function patchItem(id: string, p: Partial<Item>, ok: () => void) {
    const prev = edits[id];
    setEdits(e => ({ ...e, [id]: { ...e[id], ...p } }));
    api.patch('/inventory', { id, ...p })
      .then(() => { ok(); reload(); })
      .catch(err => { setEdits(e => ({ ...e, [id]: prev ?? {} })); notifyFailure(err); });
  }
  function setCondition(item: Item, condition: Condition) {
    patchItem(item.id, { condition }, () => toast({ tone: 'success', title: 'Condition updated.', body: `${item.name} marked ${COND_LABEL[condition].toLowerCase()}.` }));
  }
  function saveNote(item: Item, notes: string) {
    patchItem(item.id, { notes }, () => toast({ tone: 'success', title: notes ? 'Note saved.' : 'Note cleared.', body: item.name }));
  }
  async function addItem(input: Item) {
    try {
      await api.post('/inventory', input);
      toast({ tone: 'success', title: 'Item added.', body: `${input.name} recorded for ${input.propertyName} ${input.unitNumber}.` });
      setAdding(false);
      reload();
    } catch (e) { notifyFailure(e); }
  }
  function clearFilters() { setUnitFilter('all'); setCondFilter('all'); setDueOnly(false); }

  return (
    <>
      <PageHeader
        title="Fit-out register"
        sub={`${plural(all.length, 'item')} across ${plural(unitCount, 'unit')}`}
        primary={<Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setAdding(true)}>Add item</Button>}
      />

      {error && <StaleBanner message={`Showing the last register we have. ${error}`} onRetry={reload} />}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
        <Stat label="Invested in-house" value={rm(invested, { cents: false })} hint="Total fit-out value" />
        <Stat label="Needs attention" value={String(attention)} tone={attention ? 'warning' : undefined}
          active={condFilter === 'attention'} onClick={() => setCondFilter(f => f === 'attention' ? 'all' : 'attention')} hint="Replace soon or damaged" />
        <Stat label="Due for replacement" value={String(dueCount)} tone={dueCount ? 'warning' : undefined}
          active={dueOnly} onClick={() => setDueOnly(v => !v)} hint={`On schedule within ${DUE_WINDOW_DAYS} days`} />
        <Stat label="Units furnished" value={String(unitCount)} hint="With items on the register" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <SearchSelect label="Unit" className="w-[260px] max-w-full" allLabel="All units" placeholder="Search unit or building"
          value={unitFilter === 'all' ? '' : unitFilter} onChange={v => setUnitFilter(v || 'all')}
          options={units.map(u => ({ value: `${u.propertyName}|${u.unitNumber}`, label: u.unitNumber, group: u.propertyName }))} />
        <Chip on={condFilter === 'all'} onClick={() => setCondFilter('all')} count={all.length}>All</Chip>
        <Chip on={condFilter === 'attention'} onClick={() => setCondFilter('attention')} count={attention}>Needs attention</Chip>
        {CONDITIONS.map(c => <Chip key={c} on={condFilter === c} onClick={() => setCondFilter(c)} count={all.filter(i => i.condition === c).length}>{COND_LABEL[c]}</Chip>)}
        {filtersOn && <Button size="sm" variant="tertiary" onClick={clearFilters}>Clear filters</Button>}
      </div>

      <Card>
        {!loading && rows.length === 0 ? (
          filtersOn
            ? <EmptyState bare kind="filtered" title="No items match these filters." action={{ label: 'Clear filters', onClick: clearFilters }} />
            : <EmptyState bare icon="Sofa" title="No fit-out items recorded yet"
                body="Add the furniture, appliances, linen and electronics supplied for each unit to track their condition and replacement."
                action={{ label: 'Add item', onClick: () => setAdding(true) }} />
        ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[1060px]">
            <div className={cx('grid', COLS_CLASS, 'gap-[14px] py-[9px] px-[22px] bg-muted [border-bottom:1px_solid_var(--color-line,#DEDAD3)] text-meta font-semibold text-muted-ink')}>
              <div>Item</div><div>Unit</div><div>Category</div><div>Condition</div><div className="text-right">Value</div><div>Replace by</div><div>Notes</div>
            </div>

            {loading && all.length === 0 ? (
              <TableSkeleton rows={6} cols={7} />
            ) : rows.map(i => {
              const sTone = scheduleTone(i.replaceBy);
              return (
                <div key={i.id} className={cx('grid', COLS_CLASS, 'gap-[14px] items-center min-h-[54px] py-[9px] px-[22px] [border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)]')}>
                  <div className="flex flex-col gap-px min-w-0">
                    <span className="text-copy">{i.name}</span>
                    <span className="text-meta text-muted-ink">
                      {i.quantity}{i.suppliedInHouse ? ' · Supplied by The Conts' : ''}{i.installedOn ? ` · installed ${date(i.installedOn)}` : ''}
                    </span>
                  </div>
                  <div className="flex flex-col gap-px min-w-0">
                    <span className="text-copy">{i.unitNumber}</span>
                    <span className="text-meta text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{i.propertyName}</span>
                  </div>
                  <span className="text-copy text-[var(--color-ink-2)]">{CAT_LABEL[i.category]}</span>
                  <div className="flex items-center gap-2 min-w-0">
                    <Dot tone={COND_TONE[i.condition]} />
                    <Select label={`Condition of ${i.name}`} className="flex-1" value={i.condition} onChange={v => setCondition(i, v as Condition)}
                      options={CONDITIONS.map(c => ({ value: c, label: COND_LABEL[c] }))} />
                  </div>
                  <span className="text-copy text-right tabular-nums">{i.purchaseCost != null ? rm(i.purchaseCost, { cents: false }) : '—'}</span>
                  <span className={cx('text-copy', sTone ? cx(TONE[sTone].text, 'font-semibold') : 'text-muted-ink font-normal')}>
                    {i.replaceBy ? date(i.replaceBy) : '—'}
                  </span>
                  <NoteCell value={i.notes} onSave={v => saveNote(i, v)} label={i.name} />
                </div>
              );
            })}
          </div>
        </div>
        )}
      </Card>

      {adding && <AddItemModal units={units} onClose={() => setAdding(false)} onSubmit={addItem} />}
    </>
  );
}

/* ---------- small local primitives ---------- */

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
      <span className={cx('text-title font-semibold tabular-nums', tone ? TONE[tone].text : 'text-ink')}>{value}</span>
      <span className="text-meta font-medium">{label}</span>
      {hint && <span className="text-caption text-muted-ink">{hint}</span>}
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
        className="h-[30px] w-full box-border px-3 py-0 font-sans text-meta text-ink bg-card border border-solid border-line rounded-control outline-none" />
    );
  }
  return (
    <button onClick={() => setEditing(true)} title="Edit note"
      className={cx('text-left w-full min-h-[30px] py-[5px] px-2 rounded-[6px] border border-solid bg-transparent cursor-text font-sans text-meta font-normal whitespace-nowrap overflow-hidden text-ellipsis',
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
    installedOn: '', replaceBy: '', notes: '',
  });
  const [valueSen, setValueSen] = useState<number | null>(null);
  const set = <K extends keyof typeof f>(k: K) => (e: { target: { value: string } }) => setF(s => ({ ...s, [k]: e.target.value }));
  const addingNewUnit = f.unitNumber === '__new';

  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('input,select')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const canSubmit = f.name.trim() !== '' && (addingNewUnit ? f.newProperty.trim() !== '' && f.newUnit.trim() !== '' : f.unitNumber !== '')
    && (!f.installedOn || f.installedOn <= todayMyt()) && (!f.replaceBy || !f.installedOn || f.replaceBy >= f.installedOn);

  function submit() {
    const unit = addingNewUnit
      ? { unitNumber: f.newUnit.trim(), propertyName: f.newProperty.trim() }
      : units.find(u => u.unitNumber === f.unitNumber)!;
    onSubmit({
      id: crypto.randomUUID(),
      unitNumber: unit.unitNumber, propertyName: unit.propertyName,
      name: f.name.trim(), category: f.category, quantity: f.quantity.trim() || '1',
      condition: f.condition, suppliedInHouse: true,
      purchaseCost: valueSen,
      installedOn: f.installedOn || null,
      lastChecked: todayMyt(),
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
            <h2 className="m-0 text-title font-semibold">Add fit-out item</h2>
            <p className="m-0 text-copy text-muted-ink">Record a piece of fit-out supplied for a unit, its condition and when it is due for replacement.</p>
          </div>
          <div className="py-4 px-[22px] flex flex-col gap-[14px]">
            <Field label="Item" placeholder="e.g. Queen bed frame and mattress" value={f.name} onChange={set('name')} />

            <SearchSelect label="Unit" showLabel value={f.unitNumber} onChange={v => set('unitNumber')({ target: { value: v } })} placeholder="Search unit or building"
              options={[...units.map(u => ({ value: u.unitNumber, label: u.unitNumber, group: u.propertyName })), { value: '__new', label: 'Add a new unit…' }]} />
            {addingNewUnit && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Property" placeholder="e.g. Arte Mont Kiara" value={f.newProperty} onChange={set('newProperty')} />
                <Field label="Unit number" placeholder="e.g. #MK2-09-16" value={f.newUnit} onChange={set('newUnit')} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Select size="md" showLabel label="Category" value={f.category} onChange={v => set('category')({ target: { value: v } })} options={CATEGORIES.map(c => ({ value: c, label: CAT_LABEL[c] }))} />
              <Field label="Quantity" placeholder="e.g. 1 set" value={f.quantity} onChange={set('quantity')} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Select size="md" showLabel label="Condition" value={f.condition} onChange={v => set('condition')({ target: { value: v } })} options={CONDITIONS.map(c => ({ value: c, label: COND_LABEL[c] }))} />
              <MoneyInput label="Purchase value (RM)" placeholder="e.g. 3,200.00" valueSen={valueSen} onChangeSen={setValueSen} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <DateField label="Installed on" value={f.installedOn} onChange={v => setF(s => ({ ...s, installedOn: v }))} max={todayMyt()} />
              <DateField label="Replace by" value={f.replaceBy} onChange={v => setF(s => ({ ...s, replaceBy: v }))} min={f.installedOn || undefined} help="Optional — sets the replacement schedule." />
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
