import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { color, radius, text } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { Field } from '../components/Field';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';
import { rm, date } from '../lib/format';
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

const COLS = 'minmax(190px,1.9fr) minmax(140px,1.2fr) minmax(96px,0.8fr) minmax(138px,1fr) minmax(96px,0.8fr) minmax(120px,0.95fr) minmax(150px,1.3fr)';
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

  const units = useMemo(() => {
    const seen = new Map<string, string>();
    all.forEach(i => { if (!seen.has(i.unitNumber)) seen.set(i.unitNumber, `${i.propertyName} ${i.unitNumber}`); });
    return [...seen.entries()].map(([unitNumber, label]) => ({ unitNumber, label, propertyName: all.find(i => i.unitNumber === unitNumber)!.propertyName }));
  }, [all]);

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
    api.patch('/inventory', { id, ...p }).catch(() => {});
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
    api.post('/inventory', input).catch(() => {});
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        <Stat label="Invested in-house" value={rm(invested, { cents: false })} hint="Total fit-out value" />
        <Stat label="Needs attention" value={String(attention)} tone={attention ? 'warning' : undefined}
          active={condFilter === 'attention'} onClick={() => setCondFilter(f => f === 'attention' ? 'all' : 'attention')} hint="Replace soon or damaged" />
        <Stat label="Due for replacement" value={String(dueCount)} tone={dueCount ? 'warning' : undefined}
          active={dueOnly} onClick={() => setDueOnly(v => !v)} hint={`On schedule within ${DUE_WINDOW_DAYS} days`} />
        <Stat label="Units furnished" value={String(units.length)} hint="With items on the register" />
      </div>

      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="inv-unit" style={{ fontSize: text.small, fontWeight: 500, color: color.textMuted }}>Unit</label>
          <select id="inv-unit" value={unitFilter} onChange={e => setUnitFilter(e.target.value)}
            style={{ ...controlStyle, minWidth: 220, cursor: 'pointer' }}>
            <option value="all">All units</option>
            {units.map(u => <option key={u.unitNumber} value={u.unitNumber}>{u.label}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: text.small, fontWeight: 500, color: color.textMuted }}>Condition</span>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            <Chip label="All" active={condFilter === 'all'} onClick={() => setCondFilter('all')} />
            <Chip label="Needs attention" active={condFilter === 'attention'} onClick={() => setCondFilter('attention')} />
            {CONDITIONS.map(c => <Chip key={c} label={COND_LABEL[c]} active={condFilter === c} onClick={() => setCondFilter(c)} />)}
          </div>
        </div>

        {filtersOn && (
          <button onClick={clearFilters}
            style={{ height: 32, padding: '0 12px', borderRadius: radius.pill, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', font: 'inherit', border: `1px solid ${color.border}`, background: 'transparent', color: color.textMuted }}>
            Clear filters
          </button>
        )}
      </div>

      <Card>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 1060 }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '9px 22px', background: color.muted, borderBottom: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>
              <div>Item</div><div>Unit</div><div>Category</div><div>Condition</div><div style={{ textAlign: 'right' }}>Value</div><div>Replace by</div><div>Notes</div>
            </div>

            {loading && all.length === 0 ? (
              <TableSkeleton rows={6} cols={7} />
            ) : rows.length === 0 ? (
              <div style={{ padding: '38px 22px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{filtersOn ? 'No items match these filters.' : 'No fit-out items recorded yet.'}</span>
                <span style={{ fontSize: 12.5, color: color.textMuted, maxWidth: 380 }}>
                  {filtersOn ? 'Adjust the unit or condition filter to see more of the register.' : 'Add the furniture, appliances, linen and electronics supplied for each unit to track their condition and replacement.'}
                </span>
                {filtersOn
                  ? <button onClick={clearFilters} style={linkBtn}>Clear filters</button>
                  : <div style={{ marginTop: 6 }}><Button variant="secondary" size="sm" icon={<Icon name="Plus" size="sm" />} onClick={() => setAdding(true)}>Add item</Button></div>}
              </div>
            ) : rows.map(i => {
              const sTone = scheduleTone(i.replaceBy);
              return (
                <div key={i.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', minHeight: 54, padding: '9px 22px', borderBottom: `1px solid ${color.borderMuted}` }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5 }}>{i.name}</span>
                    <span style={{ fontSize: 11.5, color: color.textMuted }}>
                      {i.quantity}{i.suppliedInHouse ? ' · Supplied by The Conts' : ''}{i.installedOn ? ` · installed ${date(i.installedOn)}` : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13 }}>{i.unitNumber}</span>
                    <span style={{ fontSize: 11.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.propertyName}</span>
                  </div>
                  <span style={{ fontSize: 12.5, color: color.inkSecondary }}>{CAT_LABEL[i.category]}</span>
                  <div>
                    <select value={i.condition} onChange={e => setCondition(i, e.target.value as Condition)}
                      aria-label={`Condition of ${i.name}`}
                      style={{ height: 30, padding: '0 8px', fontSize: 12, font: 'inherit', cursor: 'pointer', borderRadius: radius.pill, border: 'none', appearance: 'none', textAlign: 'center', ...condPill(i.condition) }}>
                      {CONDITIONS.map(c => <option key={c} value={c}>{COND_LABEL[c]}</option>)}
                    </select>
                  </div>
                  <span style={{ fontSize: 13, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{i.purchaseCost != null ? rm(i.purchaseCost, { cents: false }) : '—'}</span>
                  <span style={{ fontSize: 12.5, color: sTone ? tonePair(sTone).fg : color.textMuted, fontWeight: sTone ? 600 : 400 }}>
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

const controlStyle: CSSProperties = {
  height: 36, boxSizing: 'border-box', padding: '0 12px', fontFamily: 'inherit', fontSize: 13,
  color: color.ink, background: color.card, border: `1px solid ${color.border}`, borderRadius: radius.control, outline: 'none',
};
const linkBtn: CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 12.5, fontWeight: 600, color: color.goldInk };

/** Selected uses brand black (selection, never a status tone). */
function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      style={{ height: 32, padding: '0 13px', borderRadius: radius.pill, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', font: 'inherit',
        border: `1px solid ${active ? color.black : color.border}`, background: active ? color.black : '#FFFFFF', color: active ? '#FFFFFF' : color.textMuted }}>
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
      style={{
        display: 'flex', flexDirection: 'column', gap: 3, padding: '13px 15px', borderRadius: radius.card,
        background: color.card, border: `1px solid ${active ? color.black : color.border}`,
        cursor: interactive ? 'pointer' : 'default',
      }}>
      <span style={{ fontSize: 19, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: tone ? tonePair(tone).fg : color.ink }}>{value}</span>
      <span style={{ fontSize: 12, fontWeight: 500 }}>{label}</span>
      {hint && <span style={{ fontSize: 11, color: color.textMuted }}>{hint}</span>}
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
        style={{ ...controlStyle, height: 30, width: '100%', fontSize: 12 }} />
    );
  }
  return (
    <button onClick={() => setEditing(true)} title="Edit note"
      style={{ textAlign: 'left', width: '100%', minHeight: 30, padding: '5px 8px', borderRadius: radius.sm, border: `1px solid ${value ? 'transparent' : color.borderMuted}`,
        background: 'transparent', cursor: 'text', font: 'inherit', fontSize: 12, color: value ? color.inkSecondary : color.faint,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      {value || 'Add note'}
    </button>
  );
}

/* condition pill / tone helpers (mirrors theme.tone; no gold used for status) */
function tonePair(t: Tone): { bg: string; fg: string } {
  switch (t) {
    case 'success': return { bg: '#E9F5EF', fg: '#11694A' };
    case 'warning': return { bg: '#FFF4D8', fg: '#8A5A12' };
    case 'critical': return { bg: '#FCECEB', fg: '#A8352F' };
    case 'info': return { bg: '#EAF2FA', fg: '#2E6DA4' };
    default: return { bg: '#F1F0ED', fg: '#706D67' };
  }
}
function condPill(c: Condition): CSSProperties { const p = tonePair(COND_TONE[c]); return { background: p.bg, color: p.fg }; }

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
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', padding: 24, background: 'var(--color-surface-scrim)', animation: 'fade-in var(--motion-standard) var(--ease-out) both' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0 }} />
      <div ref={ref} style={{ position: 'relative', width: '100%', maxWidth: 500, maxHeight: '88vh', overflowY: 'auto', background: 'var(--color-surface-card)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-overlay)' }}>
        <form onSubmit={e => { e.preventDefault(); if (canSubmit) submit(); }}>
          <div style={{ padding: '22px 22px 4px', display: 'flex', flexDirection: 'column', gap: 5 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Add inventory item</h2>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>Record a piece of fit-out supplied for a unit, its condition and when it is due for replacement.</p>
          </div>
          <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Item" placeholder="e.g. Queen bed frame and mattress" value={f.name} onChange={set('name')} />

            <Sel label="Unit" value={f.unitNumber} onChange={set('unitNumber')}
              options={[...units.map(u => ({ value: u.unitNumber, label: u.label })), { value: '__new', label: 'Add a new unit…' }]} />
            {addingNewUnit && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Property" placeholder="e.g. Arte Mont Kiara" value={f.newProperty} onChange={set('newProperty')} />
                <Field label="Unit number" placeholder="e.g. #MK2-09-16" value={f.newUnit} onChange={set('newUnit')} />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Sel label="Category" value={f.category} onChange={set('category')} options={CATEGORIES.map(c => ({ value: c, label: CAT_LABEL[c] }))} />
              <Field label="Quantity" placeholder="e.g. 1 set" value={f.quantity} onChange={set('quantity')} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Sel label="Condition" value={f.condition} onChange={set('condition')} options={CONDITIONS.map(c => ({ value: c, label: COND_LABEL[c] }))} />
              <Field label="Purchase value (RM)" type="number" min={0} step="0.01" numeric placeholder="e.g. 3200" value={f.value} onChange={set('value')} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Installed on" type="date" value={f.installedOn} onChange={set('installedOn')} />
              <Field label="Replace by" type="date" value={f.replaceBy} onChange={set('replaceBy')} help="Optional — sets the replacement schedule." />
            </div>

            <Field label="Notes" placeholder="Optional — condition detail, warranty, supplier" value={f.notes} onChange={set('notes')} />
          </div>
          <div style={{ padding: '14px 22px', borderTop: '1px solid var(--color-border-default)', background: 'var(--color-surface-page)', display: 'flex', justifyContent: 'flex-end', gap: 9 }}>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <label style={{ fontSize: 'var(--text-small)', fontWeight: 500, color: 'var(--color-text-muted)' }}>{label}</label>
      <select value={value} onChange={onChange}
        style={{ height: 'var(--control-height)', width: '100%', boxSizing: 'border-box', padding: '0 12px', fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--color-text-primary)', background: 'var(--color-surface-card)', border: '1px solid var(--color-border-default)', borderRadius: 'var(--radius-control)', outline: 'none', cursor: 'pointer' }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
