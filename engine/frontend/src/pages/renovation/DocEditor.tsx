/* The section / line editor shared by quotations, package templates and the
   add side of a variation order. Desktop: one row per line with a details
   drawer; phone: one card per line. Amounts come from the shared money module,
   so the screen and the server agree to the sen. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Search, Trash2 } from 'lucide-react';
import { formatRm, lineAmounts, parseMeasureMilli, type RenoLineKind } from '../../vendor/shared/renovation-money';
import { RENO_STAGES, STAGE_LABEL } from '../../vendor/shared/renovation-stages';
import { useSuppliers } from '../../vendor/scm/lib/suppliers-queries';
import { searchProducts, type DocLine, type DocSection, type ProductPick } from '../../lib/renovation/api';
import { cn } from '../../lib/utils';
import { cellBaseCls, cellInputCls, inputCls, MoneyInput, PercentInput, rm } from './shared';

export const BAND_COLOURS: Array<{ value: string | null; label: string }> = [
  { value: null, label: 'None' },
  { value: '#4a90d9', label: 'Blue' },
  { value: '#bfe3f5', label: 'Light blue' },
  { value: '#4cd964', label: 'Green' },
  { value: '#ffe08a', label: 'Yellow' },
  { value: '#f5c6e6', label: 'Pink' },
  { value: '#d9d9d9', label: 'Grey' },
];

const MEASURE_UOMS = ['FT', 'SQFT'];
const UOMS = ['UNIT', 'PCS', 'SET', 'LOT', 'POINT', 'FULL'];

export function blankLine(kind: RenoLineKind): DocLine {
  return {
    kind, room: '', itemCode: null, description: '', qty: 1, measure: null, measureUom: null, uom: kind === 'ITEM' || kind === 'CHILD' ? 'UNIT' : null,
    unitPriceSen: 0, listPriceSen: null, discountBp: 0, amountOverrideSen: null, isFoc: false, supplyByOwner: false, highlight: 'NONE',
    supplierId: null, unitCostSen: 0, stageCode: null, pageBreakBefore: false,
  };
}

export function blankSection(heading = ''): DocSection {
  return { heading, bandColor: null, lumpSumSen: null, pageBreakBefore: false, lines: [blankLine('ITEM')] };
}

export function amountsOf(l: DocLine) {
  const measureMilli = l.measure ? parseMeasureMilli(l.measure) : null;
  return lineAmounts({
    kind: l.kind, qty: l.qty, measureMilli: measureMilli !== null && !Number.isNaN(measureMilli) ? measureMilli : null,
    measureUom: l.measureUom, uom: l.uom, unitPriceSen: l.unitPriceSen, discountBp: l.discountBp, amountOverrideSen: l.amountOverrideSen, isFoc: l.isFoc,
  });
}

function move<T>(arr: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const out = [...arr];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

const KIND_LABEL: Record<RenoLineKind, string> = { ITEM: 'Item', CHILD: 'Add-on', DETAIL: 'Dimension', TEXT: 'Text' };

export function ProductPicker({ value, onPick, disabled }: { value: string | null; onPick: (p: ProductPick) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<ProductPick[]>([]);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setBusy(true);
    const t = setTimeout(() => {
      searchProducts(q).then((r) => { if (live) setRows(r.products); }).catch(() => { if (live) setRows([]); }).finally(() => { if (live) setBusy(false); });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [q, open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button" disabled={disabled} onClick={() => setOpen((o) => !o)}
        className={cn('flex h-8 w-full items-center gap-1 rounded border px-1.5 text-left text-[11.5px] font-semibold', value ? 'border-border bg-surface-2 text-primary-ink' : 'border-dashed border-err/50 text-err', disabled && 'opacity-70')}
        title={value ? `Product ${value}` : 'Pick the product for this line'}
      >
        <Search size={12} className="shrink-0" />
        <span className="truncate">{value ?? 'Pick product'}</span>
      </button>
      {open && (
        <div className="absolute left-0 top-9 z-30 w-[340px] max-w-[85vw] rounded-lg border border-border bg-surface p-2 shadow-lg">
          <input autoFocus className={`${inputCls} w-full`} placeholder="Search code or name (RN- for generic works)" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="mt-2 max-h-64 overflow-auto">
            {busy && rows.length === 0 && <div className="px-2 py-3 text-[12px] text-ink-muted">Searching…</div>}
            {!busy && rows.length === 0 && <div className="px-2 py-3 text-[12px] text-ink-muted">No active product matches.</div>}
            {rows.map((p) => (
              <button key={p.code} type="button" onClick={() => { onPick(p); setOpen(false); }}
                className="flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-primary-soft">
                <span className="text-[12.5px] font-semibold text-ink">{p.code} <span className="font-normal text-ink-secondary">{p.name}</span></span>
                <span className="text-[11px] text-ink-muted">{[p.group, p.subCategory, p.supplierName, p.costSen ? `cost ${rm(p.costSen)}` : null].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MeasureInput({ line, onChange, disabled }: { line: DocLine; onChange: (p: Partial<DocLine>) => void; disabled?: boolean }) {
  const bad = line.measure ? Number.isNaN(parseMeasureMilli(line.measure)) : false;
  return (
    <div className="flex gap-1">
      <input
        aria-label="Measure" inputMode="decimal" disabled={disabled} placeholder="—"
        className={cn(cellBaseCls, 'w-16 text-right tabular-nums', bad && 'border-err text-err')}
        value={line.measure ?? ''}
        onChange={(e) => onChange({ measure: e.target.value.trim() === '' ? null : e.target.value.trim(), measureUom: line.measureUom ?? 'FT' })}
      />
      {line.measure && (
        <select aria-label="Measure unit" disabled={disabled} className={cn(cellBaseCls, 'w-[60px] px-0')} value={line.measureUom ?? 'FT'} onChange={(e) => onChange({ measureUom: e.target.value })}>
          {MEASURE_UOMS.map((u) => <option key={u}>{u}</option>)}
        </select>
      )}
    </div>
  );
}

interface LineProps {
  line: DocLine;
  no: string;
  disabled?: boolean;
  showCost: boolean;
  inLumpSum: boolean;
  onChange: (p: Partial<DocLine>) => void;
  onMove: (d: -1 | 1) => void;
  onDelete: () => void;
  suppliers: Array<{ id: string; code: string; name: string }>;
}

function LineExtras({ line, disabled, showCost, onChange, suppliers }: Pick<LineProps, 'line' | 'disabled' | 'showCost' | 'onChange' | 'suppliers'>) {
  const priced = line.kind === 'ITEM' || line.kind === 'CHILD';
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <label className="flex flex-col gap-0.5 text-[11px] text-ink-muted">Room
        <input className={inputCls} disabled={disabled} value={line.room} onChange={(e) => onChange({ room: e.target.value })} placeholder="e.g. MASTER" />
      </label>
      {priced && (
        <label className="flex flex-col gap-0.5 text-[11px] text-ink-muted">Unit
          <select className={inputCls} disabled={disabled} value={line.uom ?? 'UNIT'} onChange={(e) => onChange({ uom: e.target.value })}>
            {UOMS.map((u) => <option key={u} value={u}>{u === 'LOT' ? 'LS (lump sum)' : u === 'FULL' ? 'FULL UNIT' : u}</option>)}
          </select>
        </label>
      )}
      {priced && (
        <label className="flex flex-col gap-0.5 text-[11px] text-ink-muted">Standard price
          <MoneyInput nullable value={line.listPriceSen} disabled={disabled} onChange={(v) => onChange({ listPriceSen: v })} placeholder="—" />
        </label>
      )}
      {priced && (
        <label className="flex flex-col gap-0.5 text-[11px] text-ink-muted">Typed amount
          <MoneyInput nullable value={line.amountOverrideSen} disabled={disabled || line.isFoc} onChange={(v) => onChange({ amountOverrideSen: v })} placeholder="computed" />
        </label>
      )}
      <label className="flex flex-col gap-0.5 text-[11px] text-ink-muted">Highlight
        <select className={inputCls} disabled={disabled} value={line.highlight} onChange={(e) => onChange({ highlight: e.target.value as DocLine['highlight'] })}>
          <option value="NONE">None</option><option value="GREY">Grey</option><option value="PINK">Pink (waived)</option>
        </select>
      </label>
      {priced && (
        <label className="flex flex-col gap-0.5 text-[11px] text-ink-muted">Stage
          <select className={inputCls} disabled={disabled} value={line.stageCode ?? ''} onChange={(e) => onChange({ stageCode: e.target.value || null })}>
            <option value="">From product</option>
            {RENO_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </select>
        </label>
      )}
      {priced && showCost && (
        <label className="col-span-2 flex flex-col gap-0.5 text-[11px] text-ink-muted sm:col-span-2">Supplier (PO party)
          <select className={inputCls} disabled={disabled} value={line.supplierId ?? ''} onChange={(e) => onChange({ supplierId: e.target.value || null })}>
            <option value="">— none —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
          </select>
        </label>
      )}
      {priced && showCost && (
        <label className="flex flex-col gap-0.5 text-[11px] text-ink-muted">Unit cost
          <MoneyInput value={line.unitCostSen} disabled={disabled} onChange={(v) => onChange({ unitCostSen: v ?? 0 })} />
        </label>
      )}
      {priced && (
        <div className="col-span-2 flex flex-wrap items-end gap-3 pb-1 text-[12px] text-ink-secondary sm:col-span-3">
          <label className="flex items-center gap-1.5"><input type="checkbox" disabled={disabled} checked={line.isFoc} onChange={(e) => onChange({ isFoc: e.target.checked, amountOverrideSen: e.target.checked ? null : line.amountOverrideSen })} /> FOC</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" disabled={disabled} checked={line.supplyByOwner} onChange={(e) => onChange({ supplyByOwner: e.target.checked })} /> Supply by owner</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" disabled={disabled} checked={line.pageBreakBefore} onChange={(e) => onChange({ pageBreakBefore: e.target.checked })} /> New page before</label>
        </div>
      )}
    </div>
  );
}

function LineRow(p: LineProps) {
  const { line, disabled, inLumpSum } = p;
  const [open, setOpen] = useState(false);
  const priced = line.kind === 'ITEM' || line.kind === 'CHILD';
  const a = amountsOf(line);
  const sub = line.kind === 'CHILD' || line.kind === 'DETAIL';
  const pick = (prod: ProductPick) => p.onChange({
    itemCode: prod.code,
    description: line.description || prod.name,
    unitPriceSen: line.unitPriceSen || prod.sellPriceSen,
    unitCostSen: prod.costSen || line.unitCostSen,
    supplierId: prod.supplierId ?? line.supplierId,
    uom: prod.uom ?? line.uom,
  });
  return (
    <>
      <tr className={cn('border-t border-border-subtle align-top', line.highlight === 'PINK' && 'bg-[#fbe1d6]/60', line.highlight === 'GREY' && 'bg-surface-dim/60')}>
        <td className="w-8 py-1.5 pl-2 text-center text-[12px] font-semibold text-ink-muted">{p.no}</td>
        <td className={cn('py-1', sub && 'pl-4')}>
          <div className="flex items-center gap-1">
            {line.kind !== 'ITEM' && <span className="shrink-0 rounded bg-surface-2 px-1 py-0.5 text-[10px] font-semibold uppercase text-ink-muted">{KIND_LABEL[line.kind]}</span>}
            <input aria-label="Description" className={cn(cellInputCls, line.kind === 'ITEM' && 'font-semibold')} disabled={disabled} value={line.description}
              placeholder={line.kind === 'DETAIL' ? 'W : 8.2 FT X D : 2 FT X H : 9.5 FT' : line.kind === 'TEXT' ? 'Text line' : 'Description'}
              onChange={(e) => p.onChange({ description: e.target.value })} />
          </div>
        </td>
        <td className="w-[112px] py-1">{priced && <ProductPicker value={line.itemCode} onPick={pick} disabled={disabled} />}</td>
        <td className="w-[52px] py-1">{priced && <input aria-label="Qty" inputMode="numeric" className={cn(cellInputCls, 'text-center tabular-nums')} disabled={disabled || Boolean(line.measure)} value={line.qty} onChange={(e) => p.onChange({ qty: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} />}</td>
        <td className="w-[128px] py-1">{priced && <MeasureInput line={line} onChange={p.onChange} disabled={disabled} />}</td>
        <td className="w-[92px] py-1">{priced && !inLumpSum && <MoneyInput className={cellInputCls} ariaLabel="Unit price" value={line.unitPriceSen} disabled={disabled} onChange={(v) => p.onChange({ unitPriceSen: v ?? 0 })} />}</td>
        <td className="w-[56px] py-1">{priced && !inLumpSum && <PercentInput className={cellInputCls} ariaLabel="Discount %" value={line.discountBp} disabled={disabled} onChange={(bp) => p.onChange({ discountBp: bp })} />}</td>
        <td className="w-[96px] py-1.5 pr-2 text-right text-[12.5px] font-semibold tabular-nums">
          {priced && !inLumpSum && (line.isFoc ? <span className="text-synced">FOC</span> : <span className={a.overridden ? 'text-warning-text' : a.netSen < 0 ? 'text-err' : 'text-ink'} title={a.overridden ? 'Typed amount: differs from the computed amount' : undefined}>{formatRm(a.netSen)}{a.overridden ? ' *' : ''}</span>)}
          {priced && inLumpSum && <span className="text-[11px] font-normal text-ink-muted">in lump sum</span>}
        </td>
        <td className="w-[88px] py-1 pr-1">
          <div className="flex justify-end gap-0.5 text-ink-muted">
            <button type="button" aria-label="Details" onClick={() => setOpen((o) => !o)} className="rounded p-1 hover:bg-surface-dim">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
            {!disabled && <button type="button" aria-label="Move up" onClick={() => p.onMove(-1)} className="rounded p-1 hover:bg-surface-dim"><ArrowUp size={14} /></button>}
            {!disabled && <button type="button" aria-label="Move down" onClick={() => p.onMove(1)} className="rounded p-1 hover:bg-surface-dim"><ArrowDown size={14} /></button>}
            {!disabled && <button type="button" aria-label="Delete line" onClick={p.onDelete} className="rounded p-1 hover:bg-err-bg hover:text-err"><Trash2 size={14} /></button>}
          </div>
        </td>
      </tr>
      {open && (
        <tr className="bg-surface-2/60">
          <td />
          <td colSpan={8} className="px-2 py-2"><LineExtras {...p} /></td>
        </tr>
      )}
    </>
  );
}

function LineCard(p: LineProps) {
  const { line, disabled, inLumpSum } = p;
  const [open, setOpen] = useState(false);
  const priced = line.kind === 'ITEM' || line.kind === 'CHILD';
  const a = amountsOf(line);
  const pick = (prod: ProductPick) => p.onChange({
    itemCode: prod.code, description: line.description || prod.name, unitPriceSen: line.unitPriceSen || prod.sellPriceSen,
    unitCostSen: prod.costSen || line.unitCostSen, supplierId: prod.supplierId ?? line.supplierId, uom: prod.uom ?? line.uom,
  });
  return (
    <div className={cn('rounded-lg border border-border-subtle p-2.5', line.kind !== 'ITEM' && line.kind !== 'TEXT' && 'ml-4', line.highlight === 'PINK' && 'bg-[#fbe1d6]/60')}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase text-ink-muted">{p.no ? `${p.no} · ` : ''}{KIND_LABEL[line.kind]}</span>
        <div className="flex gap-0.5 text-ink-muted">
          {!disabled && <button type="button" aria-label="Move up" onClick={() => p.onMove(-1)} className="rounded p-1"><ArrowUp size={14} /></button>}
          {!disabled && <button type="button" aria-label="Move down" onClick={() => p.onMove(1)} className="rounded p-1"><ArrowDown size={14} /></button>}
          {!disabled && <button type="button" aria-label="Delete line" onClick={p.onDelete} className="rounded p-1"><Trash2 size={14} /></button>}
        </div>
      </div>
      <input aria-label="Description" className={cn(inputCls, 'mt-1 w-full', line.kind === 'ITEM' && 'font-semibold')} disabled={disabled} value={line.description} placeholder="Description" onChange={(e) => p.onChange({ description: e.target.value })} />
      {priced && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="col-span-2"><ProductPicker value={line.itemCode} onPick={pick} disabled={disabled} /></div>
          <label className="flex flex-col gap-0.5 text-[11px] text-ink-muted">Qty
            <input inputMode="numeric" className={inputCls} disabled={disabled || Boolean(line.measure)} value={line.qty} onChange={(e) => p.onChange({ qty: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} />
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] text-ink-muted">Measure
            <MeasureInput line={line} onChange={p.onChange} disabled={disabled} />
          </label>
          {!inLumpSum && (
            <label className="flex flex-col gap-0.5 text-[11px] text-ink-muted">Unit price
              <MoneyInput value={line.unitPriceSen} disabled={disabled} onChange={(v) => p.onChange({ unitPriceSen: v ?? 0 })} />
            </label>
          )}
          {!inLumpSum && (
            <label className="flex flex-col gap-0.5 text-[11px] text-ink-muted">Disc %
              <PercentInput value={line.discountBp} disabled={disabled} onChange={(bp) => p.onChange({ discountBp: bp })} />
            </label>
          )}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between">
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-[12px] font-semibold text-primary">{open ? 'Hide details' : 'More details'}</button>
        {priced && !inLumpSum && <span className={cn('text-[13px] font-semibold tabular-nums', a.overridden && 'text-warning-text')}>{line.isFoc ? 'FOC' : rm(a.netSen)}{a.overridden ? ' *' : ''}</span>}
      </div>
      {open && <div className="mt-2"><LineExtras {...p} /></div>}
    </div>
  );
}

export function numberLines(section: DocSection): string[] {
  let n = 0;
  const lump = section.lumpSumSen !== null;
  return section.lines.map((l) => (l.kind === 'ITEM' || (lump && l.kind === 'DETAIL' && !l.parentId) ? String(++n) : ''));
}

export function SectionCard({ section, index, count, disabled, showCost, onChange, onMove, onDelete, suppliers, allowLumpSum = true }: {
  section: DocSection; index: number; count: number; disabled?: boolean; showCost: boolean; allowLumpSum?: boolean;
  onChange: (s: DocSection) => void; onMove: (d: -1 | 1) => void; onDelete: () => void; suppliers: Array<{ id: string; code: string; name: string }>;
}) {
  const nos = useMemo(() => numberLines(section), [section]);
  const lump = section.lumpSumSen !== null;
  const subtotal = section.lines.reduce((s, l) => s + (lump ? 0 : amountsOf(l).netSen), 0) + (section.lumpSumSen ?? 0);
  const setLine = (i: number, p: Partial<DocLine>) => onChange({ ...section, lines: section.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) });
  const add = (kind: RenoLineKind) => onChange({ ...section, lines: [...section.lines, blankLine(kind)] });
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-2" style={section.bandColor ? { background: `${section.bandColor}40` } : undefined}>
        <span className="text-[11px] font-semibold uppercase text-ink-muted">Section {index + 1}</span>
        <input aria-label="Section heading" className={cn(inputCls, 'h-8 min-w-[200px] flex-1 basis-[240px] font-semibold uppercase')} disabled={disabled} value={section.heading}
          placeholder="e.g. CARPENTRY WORK @ KITCHEN AREA" onChange={(e) => onChange({ ...section, heading: e.target.value })} />
        <select aria-label="Band colour" className={cn(inputCls, 'h-8 w-[120px]')} disabled={disabled} value={section.bandColor ?? ''} onChange={(e) => onChange({ ...section, bandColor: e.target.value || null })}>
          {BAND_COLOURS.map((c) => <option key={c.label} value={c.value ?? ''}>{c.label}</option>)}
        </select>
        {allowLumpSum && (
          <label className="flex items-center gap-1.5 text-[12px] text-ink-secondary">
            <input type="checkbox" disabled={disabled} checked={lump} onChange={(e) => onChange({ ...section, lumpSumSen: e.target.checked ? subtotal : null })} /> Lump sum
          </label>
        )}
        {lump && <MoneyInput className={cn(inputCls, 'h-8 w-[120px]')} ariaLabel="Lump-sum price" value={section.lumpSumSen} disabled={disabled} onChange={(v) => onChange({ ...section, lumpSumSen: v ?? 0 })} />}
        <label className="flex items-center gap-1.5 text-[12px] text-ink-secondary">
          <input type="checkbox" disabled={disabled} checked={section.pageBreakBefore} onChange={(e) => onChange({ ...section, pageBreakBefore: e.target.checked })} /> New page
        </label>
        <span className="ml-auto text-[12.5px] font-semibold tabular-nums text-ink">{rm(subtotal)}</span>
        {!disabled && (
          <div className="flex gap-0.5 text-ink-muted">
            <button type="button" aria-label="Move section up" disabled={index === 0} onClick={() => onMove(-1)} className="rounded p-1 hover:bg-surface-dim disabled:opacity-30"><ArrowUp size={15} /></button>
            <button type="button" aria-label="Move section down" disabled={index === count - 1} onClick={() => onMove(1)} className="rounded p-1 hover:bg-surface-dim disabled:opacity-30"><ArrowDown size={15} /></button>
            <button type="button" aria-label="Delete section" onClick={onDelete} className="rounded p-1 hover:bg-err-bg hover:text-err"><Trash2 size={15} /></button>
          </div>
        )}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[860px] table-fixed text-left">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wide text-ink-muted">
              <th className="w-8 py-1 pl-2">No</th><th>Description</th><th className="w-[112px]">Product</th>
              <th className="w-[52px] text-center">Qty</th><th className="w-[128px]">Measure</th><th className="w-[92px] text-right">Unit price</th>
              <th className="w-[56px] text-right">Disc %</th><th className="w-[96px] pr-2 text-right">Amount (RM)</th><th className="w-[88px]" />
            </tr>
          </thead>
          <tbody>
            {section.lines.map((l, i) => (
              <LineRow key={i} line={l} no={nos[i]} disabled={disabled} showCost={showCost} inLumpSum={lump} suppliers={suppliers}
                onChange={(p) => setLine(i, p)} onMove={(d) => onChange({ ...section, lines: move(section.lines, i, d) })}
                onDelete={() => onChange({ ...section, lines: section.lines.filter((_, j) => j !== i) })} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-2 p-2 md:hidden">
        {section.lines.map((l, i) => (
          <LineCard key={i} line={l} no={nos[i]} disabled={disabled} showCost={showCost} inLumpSum={lump} suppliers={suppliers}
            onChange={(p) => setLine(i, p)} onMove={(d) => onChange({ ...section, lines: move(section.lines, i, d) })}
            onDelete={() => onChange({ ...section, lines: section.lines.filter((_, j) => j !== i) })} />
        ))}
      </div>
      {!disabled && (
        <div className="flex flex-wrap gap-2 border-t border-border-subtle px-3 py-2">
          {(['ITEM', 'CHILD', 'DETAIL', 'TEXT'] as RenoLineKind[]).map((k) => (
            <button key={k} type="button" onClick={() => add(k)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] font-semibold text-ink-secondary hover:border-primary hover:text-primary">
              <Plus size={13} /> {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DocEditor({ sections, onChange, disabled, showCost = true, allowLumpSum = true }: {
  sections: DocSection[]; onChange: (s: DocSection[]) => void; disabled?: boolean; showCost?: boolean; allowLumpSum?: boolean;
}) {
  const sq = useSuppliers({ status: 'ACTIVE' });
  const suppliers = useMemo(() => (sq.data ?? []).map((s) => ({ id: s.id, code: s.code, name: s.name })), [sq.data]);
  return (
    <div className="space-y-3">
      {sections.length === 0 && <div className="rounded-xl border border-dashed border-border p-6 text-center text-[13px] text-ink-muted">No sections yet.</div>}
      {sections.map((s, i) => (
        <SectionCard key={i} section={s} index={i} count={sections.length} disabled={disabled} showCost={showCost} suppliers={suppliers} allowLumpSum={allowLumpSum}
          onChange={(ns) => onChange(sections.map((x, j) => (j === i ? ns : x)))}
          onMove={(d) => onChange(move(sections, i, d))}
          onDelete={() => onChange(sections.filter((_, j) => j !== i))} />
      ))}
      {!disabled && (
        <button type="button" onClick={() => onChange([...sections, blankSection()])}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2.5 text-[13px] font-semibold text-ink-secondary hover:border-primary hover:text-primary">
          <Plus size={15} /> Add section
        </button>
      )}
    </div>
  );
}
