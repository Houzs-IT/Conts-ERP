import { useState } from 'react';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { NumberInput } from '../../components/inputs';
import Icon from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';
import { BED_SIZES, PURPOSE_LABEL, CODE, codeName, type UnitPurpose, type ContractCode } from '../../lib/revenueModel';
import { Select, type Bed, type Bay } from './shared';

/** Staff sheet UNIT (17 Oct 2026): beds and mattresses, car park bays, and the badges for what a unit is for and its
 *  contract code. Saved with the unit (PATCH /api/units/:id, migration 0125). */

const BED_LABEL = Object.fromEntries(BED_SIZES.map(b => [b.value, b.label]));
/** "1 King · 2 Single", as the server writes it. */
export const bedsText = (beds: Bed[] | undefined) => (beds ?? []).map(b => `${b.quantity} ${BED_LABEL[b.size] ?? b.size}`).join(' · ');
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

const removeBtn = 'grid place-items-center w-9 h-9 flex-none rounded-control bg-card border border-solid border-line cursor-pointer text-muted-ink hover:text-ink disabled:cursor-default disabled:opacity-50';

/** One line per bed size: size, how many, remove. A size already listed is not offered again. */
export function BedsEditor({ beds, onChange, disabled }: { beds: Bed[]; onChange: (b: Bed[]) => void; disabled?: boolean }) {
  const free = BED_SIZES.filter(s => !beds.some(b => b.size === s.value));
  return (
    <div className="flex flex-col gap-2 min-w-0">
      {beds.length === 0 && <span className="text-copy text-muted-ink">No beds recorded yet.</span>}
      {beds.map((b, i) => (
        <div key={b.size} className="flex items-center gap-2 min-w-0">
          <div className="flex-1 min-w-0 max-w-[220px]">
            <Select label="Bed size" value={b.size} disabled={disabled}
              onChange={v => onChange(beds.map((x, j) => (j === i ? { ...x, size: v } : x)))}
              options={BED_SIZES.filter(s => s.value === b.size || !beds.some(x => x.size === s.value))} />
          </div>
          <div className="w-[96px] flex-none">
            <NumberInput label="" aria-label={`How many ${BED_LABEL[b.size] ?? ''} beds`} min={1} max={20} value={b.quantity}
              onChange={n => onChange(beds.map((x, j) => (j === i ? { ...x, quantity: n ?? 1 } : x)))} />
          </div>
          <button type="button" aria-label={`Remove ${BED_LABEL[b.size] ?? 'bed'}`} disabled={disabled} className={removeBtn}
            onClick={() => onChange(beds.filter((_, j) => j !== i))}><Icon name="X" size="sm" /></button>
        </div>
      ))}
      {free.length > 0 && !disabled && (
        <div><Button size="sm" variant="tertiary" icon={<Icon name="Plus" size="sm" />} onClick={() => onChange([...beds, { size: free[0].value, quantity: 1 }])}>Add a bed size</Button></div>
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
  return (
    <div className="flex flex-col gap-2 min-w-0">
      {bays.length === 0 && <span className="text-copy text-muted-ink">No car park bays recorded.</span>}
      {bays.map((b, i) => {
        const key = b.id ?? `new-${i}`;
        const missingLot = !b.lotNumber.trim() && (left.has(key) || !!b.level?.trim() || !!b.note?.trim());
        return (
        <div key={key} onBlur={() => markLeft(key)} className="grid grid-cols-[minmax(64px,0.7fr)_minmax(0,1fr)_36px] sm:grid-cols-[minmax(64px,0.6fr)_minmax(0,1fr)_minmax(0,1.4fr)_36px] items-start gap-2 min-w-0">
          <Field aria-label={`Bay ${i + 1} level`} placeholder="Level" title="Level, e.g. 5" value={b.level ?? ''} maxLength={40} onChange={e => set(i, { level: e.target.value })} />
          <Field aria-label={`Bay ${i + 1} lot number`} placeholder="Lot no." title="Lot number, e.g. 100A" value={b.lotNumber} maxLength={40}
            error={missingLot ? 'Lot number needed.' : undefined} onChange={e => set(i, { lotNumber: e.target.value })} />
          <span className="max-sm:hidden"><Field aria-label={`Bay ${i + 1} note`} placeholder="Note (optional)" value={b.note ?? ''} maxLength={200} onChange={e => set(i, { note: e.target.value })} /></span>
          <button type="button" aria-label={`Remove bay ${b.lotNumber || i + 1}`} disabled={disabled} className={removeBtn}
            onClick={() => onChange(bays.filter((_, j) => j !== i))}><Icon name="X" size="sm" /></button>
        </div>
        );
      })}
      {!disabled && bays.length < 30 && (
        <div><Button size="sm" variant="tertiary" icon={<Icon name="Plus" size="sm" />} onClick={() => onChange([...bays, { lotNumber: '', level: null, note: null }])}>Add a bay</Button></div>
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
export function CodeBadge({ code, size }: { code?: ContractCode | null; size?: 'sm' }) {
  if (!code) return null;
  return <span title={CODE[code]?.label}><StatusBadge tone="accent" label={codeName(code)} size={size} /></span>;
}
