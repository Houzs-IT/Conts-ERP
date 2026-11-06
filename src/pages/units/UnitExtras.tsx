import { useState } from 'react';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { NumberInput } from '../../components/inputs';
import Icon from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';
import { PURPOSE_LABEL, codeName, codeLabel, type ContractType, type UnitPurpose, type ContractCode } from '../../lib/revenueModel';
import { Select, useBedSizes, type Bed, type Bay, type LayoutTypeOption } from './shared';

/** Staff sheet UNIT (17 Oct 2026): beds and mattresses, car park bays, and the badges for what a unit is for and its
 *  contract code. Saved with the unit (PATCH /api/units/:id, migration 0125). */

const sizeLabel = (sizes: readonly LayoutTypeOption[], key: string): string => sizes.find(s => s.key === key)?.label ?? key;
/** "1 King · 2 Single", as the server writes it (names from the bed size list on Unit settings). */
export const bedsText = (beds: Bed[] | undefined, sizes: readonly LayoutTypeOption[]) => (beds ?? []).map(b => `${b.quantity} ${sizeLabel(sizes, b.size)}`).join(' · ');
/** "LEVEL 5-LOT-100 (Tandem)", as the server writes it (bayLabel in functions/_lib/unitPurpose.ts). */
const bayText = (b: Bay) => {
  const lot = b.lotNumber.trim(), level = b.level?.trim().replace(/^(level|lvl|l)\s*(?=\d)/i, ''), note = b.note?.trim();
  return `${level ? `LEVEL ${level}-LOT-${lot}` : lot}${note ? ` (${note})` : ''}`;
};
/** "2 bays: LEVEL 2-LOT-105, LEVEL 2-LOT-106". */
export const baysText = (bays: Bay[] | undefined) => {
  const l = (bays ?? []).filter(b => b.lotNumber.trim());
  return l.length ? `${l.length} ${l.length === 1 ? 'bay' : 'bays'}: ${l.map(bayText).join(', ')}` : '';
};

const removeBtn = 'grid place-items-center w-9 h-9 max-md:w-11 max-md:h-11 flex-none rounded-control bg-card border border-solid border-line cursor-pointer text-muted-ink hover:text-ink disabled:cursor-default disabled:opacity-50';
/** Column names over the rows: a placeholder is gone once something is typed. Screen readers get each box's own label. */
const colHead = 'text-caption font-medium text-muted-ink';

/** One line per bed size: size, how many, remove. A size already listed is not offered again. Sizes come from the bed
 *  size list on Unit settings; a hidden size is offered only on the line that already has it. */
export function BedsEditor({ beds, onChange, disabled }: { beds: Bed[]; onChange: (b: Bed[]) => void; disabled?: boolean }) {
  const sizes = useBedSizes().data?.data ?? [];
  const options = (keep?: string) => sizes.filter(s => s.key === keep || (s.isActive && !beds.some(b => b.size === s.key))).map(s => ({ value: s.key, label: s.isActive ? s.label : `${s.label} (hidden)` }));
  const free = options();
  return (
    <div className="flex flex-col gap-2 min-w-0">
      {beds.length === 0 && <span className="text-copy text-muted-ink">No beds recorded yet.</span>}
      {beds.length > 0 && (
        <div aria-hidden className="flex items-center gap-2 min-w-0">
          <span className={`${colHead} flex-1 max-w-[220px]`}>Bed size</span>
          <span className={`${colHead} w-[96px] flex-none`}>How many</span>
          <span className="w-9 max-md:w-11 flex-none" />
        </div>
      )}
      {beds.map((b, i) => (
        <div key={b.size} className="flex items-center gap-2 min-w-0">
          <div className="flex-1 min-w-0 max-w-[220px]">
            <Select label="Bed size" value={b.size} disabled={disabled}
              onChange={v => onChange(beds.map((x, j) => (j === i ? { ...x, size: v } : x)))}
              options={options(b.size)} />
          </div>
          <div className="w-[96px] flex-none">
            <NumberInput label="" aria-label={`How many ${sizeLabel(sizes, b.size)} beds`} min={1} max={20} value={b.quantity}
              onChange={n => onChange(beds.map((x, j) => (j === i ? { ...x, quantity: n ?? 1 } : x)))} />
          </div>
          <button type="button" aria-label={`Remove ${sizeLabel(sizes, b.size)}`} disabled={disabled} className={removeBtn}
            onClick={() => onChange(beds.filter((_, j) => j !== i))}><Icon name="X" size="sm" /></button>
        </div>
      ))}
      {free.length > 0 && !disabled && (
        <div><Button size="sm" variant="secondary" className="max-md:min-h-11" icon={<Icon name="Plus" size="sm" />} onClick={() => onChange([...beds, { size: free[0].value, quantity: 1 }])}>Add a bed size</Button></div>
      )}
    </div>
  );
}

/** Any number of car park bays: level, lot number (required) and a note, in the order they are read: LEVEL 5-LOT-100A (Tandem). */
export function BaysEditor({ bays, onChange, disabled }: { bays: Bay[]; onChange: (b: Bay[]) => void; disabled?: boolean }) {
  const set = (i: number, p: Partial<Bay>) => onChange(bays.map((x, j) => (j === i ? { ...x, ...p } : x)));
  // A fresh row stays calm: the missing-lot error shows once a box in the row has been left or the row has other content.
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
  const markLeft = (key: string) => setLeft(prev => (prev.has(key) ? prev : new Set(prev).add(key)));
  // Only a bay added just now takes the cursor; rows already there when the form opens do not.
  const [added, setAdded] = useState<number | null>(null);
  // Phone: Level | Lot no. | remove, with the note on its own line below; from tablet width all four sit in one line.
  const cols = 'grid grid-cols-[minmax(64px,0.7fr)_minmax(0,1fr)_44px] md:grid-cols-[minmax(64px,0.6fr)_minmax(0,1fr)_minmax(0,1.4fr)_36px] gap-x-2 min-w-0';
  return (
    <div className="flex flex-col gap-2 min-w-0">
      {bays.length === 0 && <span className="text-copy text-muted-ink">No car park bays recorded.</span>}
      {bays.length > 0 && (
        <div aria-hidden className={cols}>
          <span className={colHead}>Level</span>
          <span className={colHead}>Lot no.</span>
          <span className={`${colHead} max-md:hidden`}>Note (optional)</span>
        </div>
      )}
      {bays.map((b, i) => {
        const key = b.id ?? `new-${i}`;
        const missingLot = !b.lotNumber.trim() && (left.has(key) || !!b.level?.trim() || !!b.note?.trim());
        return (
        <div key={key} onBlur={() => markLeft(key)} className={`${cols} items-start gap-y-2`}>
          <Field aria-label={`Bay ${i + 1} level`} placeholder="e.g. 5" value={b.level ?? ''} maxLength={40} autoFocus={added === i} onChange={e => set(i, { level: e.target.value })} />
          <Field aria-label={`Bay ${i + 1} lot number`} placeholder="e.g. 100A" value={b.lotNumber} maxLength={40}
            error={missingLot ? 'Lot number needed.' : undefined} onChange={e => set(i, { lotNumber: e.target.value })} />
          <span className="max-md:order-last max-md:col-span-2"><Field aria-label={`Bay ${i + 1} note`} placeholder="Note (optional), e.g. Tandem" value={b.note ?? ''} maxLength={200} onChange={e => set(i, { note: e.target.value })} /></span>
          <button type="button" aria-label={`Remove bay ${b.lotNumber || i + 1}`} disabled={disabled} className={removeBtn}
            onClick={() => { setAdded(null); onChange(bays.filter((_, j) => j !== i)); }}><Icon name="X" size="sm" /></button>
        </div>
        );
      })}
      {!disabled && bays.length < 30 && (
        <div><Button size="sm" variant="secondary" className="max-md:min-h-11" icon={<Icon name="Plus" size="sm" />}
          onClick={() => { setAdded(bays.length); onChange([...bays, { lotNumber: '', level: null, note: null }]); }}>Add a bay</Button></div>
      )}
    </div>
  );
}

/** "Showroom" / "Warehouse" next to the unit's name; nothing for a rental unit (the usual case). */
export function PurposeBadge({ purpose }: { purpose?: UnitPurpose | null }) {
  if (!purpose || purpose === 'rental') return null;
  return <span title="Not connected to the channels"><StatusBadge tone="info" label={PURPOSE_LABEL[purpose]} /></span>;
}

/** The contract's short code, e.g. "PS GRR", with its meaning on hover. */
export function CodeBadge({ code, types, size }: { code?: ContractCode | null; types: readonly ContractType[]; size?: 'sm' }) {
  if (!code) return null;
  return <span title={codeLabel(types, code)}><StatusBadge tone="accent" label={codeName(types, code)} size={size} /></span>;
}
