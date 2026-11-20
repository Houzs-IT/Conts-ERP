/* The lines of a package, grouped by area (owner, 20 Nov 2026). Each line: product, quantity, today's SKU Master selling
   price greyed as a reference, and the two SLA days (both optional). Drag the dots to reorder lines and areas; a line can
   be dropped into another area. Products and kits are added through the same SKU search as the sales order. A package
   holds no price, so nothing here is typed as money, and no cost or margin is shown. */

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Plus, Search, X } from 'lucide-react';
import { searchProducts, type DocLine, type ProductPick } from '../../lib/renovation/api';
import { expandPackage, NO_AREA, searchPackages, type PackageHit, type PackageLine, type PackageSection } from '../../lib/renovation/renovationPackagesApi';
import { blankLine, ProductPicker } from './DocEditor';
import { inputCls, rm } from './shared';
import { DaysInput, dayCell, KindPill } from './renovationPackageParts';
import { cn } from '../../lib/utils';

export function emptyArea(heading = ''): PackageSection {
  return { heading, bandColor: null, lumpSumSen: null, pageBreakBefore: false, lines: [] };
}

export function lineFromProduct(p: ProductPick, qty = 1): PackageLine {
  return { ...blankLine('ITEM'), itemCode: p.code, description: p.name, uom: p.uom ?? 'UNIT', qty, skuName: p.name, skuPriceSen: p.sellPriceSen, skuActive: true };
}

/** A kit's lines, ready to drop into an area: products, quantities and SLA days, no price. */
export async function linesOfKit(id: string): Promise<PackageLine[]> {
  const k = await expandPackage(id);
  return k.sections.flatMap((s) => s.lines).map((l) => ({ ...blankLine(l.kind), ...l, unitPriceSen: 0, unitCostSen: 0, supplierId: null, fromPackageId: null, skuPriceSen: l.unitPriceSen, skuName: l.description }));
}

const priced = (l: DocLine) => l.kind === 'ITEM' || l.kind === 'CHILD';

/** A product line still waiting for its product ("+ Line" pressed, nothing picked yet). */
export const isBlankLine = (l: DocLine): boolean => priced(l) && !l.itemCode && !l.description.trim();

/** What is saved: lines added with "+ Line" but never given a product are left out. */
export const withoutBlankLines = (sections: PackageSection[]): PackageSection[] => sections.map((s) => ({ ...s, lines: s.lines.filter((l) => !isBlankLine(l)) }));

/** One ticked row of the add picker: a SKU, or a kit whose lines are fetched when added. */
type Tick = { key: string; label: string; sku?: ProductPick; kit?: PackageHit };

/* The SKU / kit search used to add products to a package (owner, 20 Nov 2026: add many lines fast). It works like a
   shopping list: tick as many SKUs and kits as needed, across several searches, then add them all in one go. The picker
   stays open afterwards, so the next batch can be ticked straight away. Lines go in the order they were ticked. */
export function PackageAddSearch({ onAdd, autoFocus }: { onAdd: (lines: PackageLine[], label: string) => void; autoFocus?: boolean }): ReactElement {
  const [q, setQ] = useState('');
  const [skus, setSkus] = useState<ProductPick[]>([]);
  const [kits, setKits] = useState<PackageHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let live = true;
    setBusy(true);
    const t = setTimeout(() => {
      Promise.all([searchProducts(q).catch(() => ({ products: [] })), searchPackages(q).catch(() => ({ packages: [] }))])
        .then(([p, k]) => { if (!live) return; setSkus(p.products.slice(0, 30)); setKits(k.packages.filter((x) => x.kind === 'KIT').slice(0, 8)); })
        .finally(() => { if (live) setBusy(false); });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  const on = (key: string) => ticks.some((t) => t.key === key);
  const toggle = (t: Tick) => setTicks((cur) => (cur.some((x) => x.key === t.key) ? cur.filter((x) => x.key !== t.key) : [...cur, t]));
  const addTicked = async () => {
    if (ticks.length === 0) return;
    setAdding(true);
    try {
      const parts = await Promise.all(ticks.map((t) => (t.kit ? linesOfKit(t.kit.id) : Promise.resolve([lineFromProduct(t.sku!)]))));
      const lines = parts.flat();
      onAdd(lines, `${lines.length} line${lines.length === 1 ? '' : 's'} (${ticks.map((t) => t.label).join(', ')})`);
      setTicks([]);
      inputRef.current?.focus();
    } finally { setAdding(false); }
  };
  const row = (t: Tick, title: ReactNode, sub: string, pill?: ReactNode) => (
    <label key={t.key} className={cn('flex w-full cursor-pointer items-start gap-2 border-b border-border-subtle px-2.5 py-2 text-left hover:bg-primary-soft', on(t.key) && 'bg-primary-soft')}>
      <input type="checkbox" className="mt-0.5" checked={on(t.key)} onChange={() => toggle(t)} aria-label={`Tick ${t.label}`} />
      {pill}
      <span className="min-w-0"><span className="block text-[12.5px] font-semibold text-ink">{title}</span><span className="block text-[11px] text-ink-muted">{sub}</span></span>
    </label>
  );
  return (
    <div className="min-w-0">
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
        <input ref={inputRef} autoFocus={autoFocus} aria-label="Search SKU or kit" className={cn(inputCls, 'w-full pl-8')} placeholder="Search SKU or kit, e.g. hiace, bed, KIT" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && ticks.length) { e.preventDefault(); void addTicked(); } }} />
      </div>
      <div className="mt-2 max-h-[340px] overflow-auto rounded-lg border border-border">
        {kits.length > 0 && <div className="bg-surface-2 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">Kits</div>}
        {kits.map((k) => row({ key: `kit:${k.id}`, label: k.code, kit: k }, `${k.code} · ${k.name}`, `adds ${k.lines} line${k.lines === 1 ? '' : 's'}`, <KindPill kind="KIT" />))}
        {skus.length > 0 && <div className="bg-surface-2 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">SKUs</div>}
        {skus.map((p) => row({ key: `sku:${p.code}`, label: p.code, sku: p }, p.code, [p.name, p.subCategory ?? p.group, p.sellPriceSen ? rm(p.sellPriceSen) : null].filter(Boolean).join(' · ')))}
        {!busy && skus.length === 0 && kits.length === 0 && <div className="px-3 py-4 text-center text-[12px] text-ink-muted">No match</div>}
        {busy && skus.length === 0 && kits.length === 0 && <div className="px-3 py-4 text-center text-[12px] text-ink-muted">Searching…</div>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-secondary" title={ticks.map((t) => t.label).join(', ')}>
          {ticks.length ? `${ticks.length} ticked: ${ticks.map((t) => t.label).join(', ')}` : 'Tick SKUs or kits, then add them together.'}
        </span>
        {ticks.length > 0 && <button type="button" onClick={() => setTicks([])} className="text-[12px] font-semibold text-ink-muted hover:text-ink">Clear</button>}
        <button type="button" disabled={ticks.length === 0 || adding} onClick={() => void addTicked()}
          className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-white disabled:opacity-40">
          <Plus size={13} /> {adding ? 'Adding…' : `Add ${ticks.length || ''} ticked`.replace('  ', ' ')}
        </button>
      </div>
    </div>
  );
}

type DragRef = { kind: 'line'; a: number; l: number } | { kind: 'area'; a: number };

function moveLine(sections: PackageSection[], from: { a: number; l: number }, to: { a: number; l: number }): PackageSection[] {
  const out = sections.map((s) => ({ ...s, lines: [...s.lines] }));
  const [line] = out[from.a].lines.splice(from.l, 1);
  if (!line) return sections;
  const at = from.a === to.a && from.l < to.l ? to.l - 1 : to.l;
  out[to.a].lines.splice(Math.max(0, Math.min(at, out[to.a].lines.length)), 0, line);
  return out;
}

function moveArea(sections: PackageSection[], from: number, to: number): PackageSection[] {
  if (from === to) return sections;
  const out = [...sections];
  const [s] = out.splice(from, 1);
  out.splice(from < to ? to - 1 : to, 0, s);
  return out;
}

export function PackageLinesTable({ sections, onChange, disabled, showAreas, showSla = true }: {
  sections: PackageSection[]; onChange: (s: PackageSection[]) => void; disabled?: boolean; showAreas: boolean; showSla?: boolean;
}): ReactElement {
  const [drag, setDrag] = useState<DragRef | null>(null);
  const setLine = (a: number, l: number, p: Partial<PackageLine>) => onChange(sections.map((s, i) => (i !== a ? s : { ...s, lines: s.lines.map((x, j) => (j === l ? { ...x, ...p } : x)) })));
  const removeLine = (a: number, l: number) => onChange(sections.map((s, i) => (i !== a ? s : { ...s, lines: s.lines.filter((_, j) => j !== l) })));
  /* "+ Line" works like the sales order's: each press adds a blank line at once, nothing opens, so it can be pressed
     as often as needed; each line then takes its product from its own Pick product search. */
  const addBlank = (a: number) => {
    const base = sections.length ? sections : [emptyArea('')];
    onChange(base.map((s, i) => (i !== a ? s : { ...s, lines: [...s.lines, blankLine('ITEM') as PackageLine] })));
  };
  const pickSku = (a: number, l: number, p: ProductPick) => setLine(a, l, { ...lineFromProduct(p, sections[a].lines[l].qty || 1), processingAfterDays: sections[a].lines[l].processingAfterDays, deliveryAfterDays: sections[a].lines[l].deliveryAfterDays });
  const pickKit = (a: number, l: number, h: PackageHit) => void linesOfKit(h.id).then((ls) => {
    const { sections: ss, onChange: change } = live.current;
    change(ss.map((s, i) => (i !== a ? s : { ...s, lines: [...s.lines.slice(0, l), ...ls, ...s.lines.slice(l + 1)] })));
  });
  const [over, setOver] = useState<string | null>(null);
  /* Pointer events, not HTML drag and drop: the same grip works with a mouse, a pen and a finger. Rows carry data-drop
     ("line:a:l" or "area:a"); letting go over one moves the dragged line (or area) there. */
  const live = useRef({ sections, onChange, drag });
  live.current = { sections, onChange, drag };
  useEffect(() => {
    if (!drag) return;
    const targetAt = (x: number, y: number) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('[data-drop]')?.getAttribute('data-drop') ?? null;
    const move = (e: PointerEvent) => { e.preventDefault(); setOver(targetAt(e.clientX, e.clientY)); };
    const up = (e: PointerEvent) => {
      const t = targetAt(e.clientX, e.clientY);
      const { sections: ss, onChange: change, drag: d } = live.current;
      setDrag(null); setOver(null);
      if (!t || !d) return;
      const [kind, x, y] = t.split(':');
      const a = Number(x);
      if (d.kind === 'area') change(moveArea(ss, d.a, a));
      else if (kind === 'area') change(moveLine(ss, d, { a, l: ss[a].lines.length }));
      else change(moveLine(ss, d, { a, l: Number(y) }));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [drag]);
  const cols = showSla ? 9 : 7;
  const grip = (ref: DragRef) => !disabled && (
    <span onPointerDown={(e) => { e.preventDefault(); setDrag(ref); }} style={{ touchAction: 'none' }}
      className="inline-flex cursor-grab select-none p-0.5 text-ink-muted active:cursor-grabbing" title="Drag to move" aria-hidden="true"><GripVertical size={15} /></span>
  );
  const total = sections.reduce((t, s) => t + s.lines.reduce((u, l) => u + (priced(l) ? (l.skuPriceSen ?? 0) * l.qty : 0), 0), 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-[12.5px]">
        <thead className="bg-surface-2 text-[10.5px] uppercase tracking-wide text-ink-muted">
          <tr>
            <th className="w-8" /><th className="py-2">Code</th><th>Description</th><th className="w-[70px] text-right">Qty</th>
            <th className="w-[110px] text-right">SKU price</th><th className="w-[110px] text-right">Amount</th>
            {showSla && <th className="w-[118px] text-right" title="Days after the project start date, optional">Order after (days)</th>}
            {showSla && <th className="w-[118px] text-right" title="Days after the project start date, optional">Deliver after (days)</th>}
            <th className="w-[96px]" />
          </tr>
        </thead>
        <tbody>
          {sections.map((s, a) => (
            <AreaRows key={a}>
              {showAreas && (
                <tr data-drop={`area:${a}`} className={cn('border-t border-border bg-surface-2/60', over === `area:${a}` && 'outline outline-2 -outline-offset-2 outline-primary')}>
                  <td className="pl-2">{grip({ kind: 'area', a })}</td>
                  <td colSpan={cols - 2} className="py-1.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <input aria-label="Area name" disabled={disabled} className={cn(inputCls, 'h-8 w-[220px] font-semibold')} value={s.heading} placeholder={NO_AREA}
                        onChange={(e) => onChange(sections.map((x, i) => (i === a ? { ...x, heading: e.target.value } : x)))} />
                      <span className="text-[11.5px] text-ink-muted">{s.lines.length} line{s.lines.length === 1 ? '' : 's'}</span>
                    </span>
                  </td>
                  <td className="pr-2 text-right">
                    {!disabled && (
                      <span className="inline-flex gap-0.5">
                        <button type="button" onClick={() => addBlank(a)} className="rounded border border-border px-1.5 py-0.5 text-[11.5px] font-semibold text-ink-secondary hover:border-primary hover:text-primary">+ Line</button>
                        <button type="button" aria-label="Remove area" title={s.lines.length ? 'Remove the area and its lines' : 'Remove the area'} onClick={() => onChange(sections.filter((_, i) => i !== a))} className="rounded p-1 text-ink-muted hover:bg-err-bg hover:text-err"><X size={14} /></button>
                      </span>
                    )}
                  </td>
                </tr>
              )}
              {s.lines.map((l, i) => (
                <tr key={i} data-drop={`line:${a}:${i}`} className={cn('border-t border-border-subtle', drag?.kind === 'line' && drag.a === a && drag.l === i && 'opacity-40',
                  over === `line:${a}:${i}` && 'border-t-2 border-t-primary')}>
                  <td className="pl-2">{grip({ kind: 'line', a, l: i })}</td>
                  <td className="w-[132px] py-1.5 pr-2 font-mono text-[12px] font-semibold text-ink">{priced(l) && !disabled
                    ? <ProductPicker value={l.itemCode} onPick={(p) => pickSku(a, i, p)} onPickPackage={(h) => pickKit(a, i, h)} packageKind="KIT" />
                    : l.itemCode ?? <span className="font-sans font-normal text-ink-muted">{l.kind === 'TEXT' ? 'Text' : '—'}</span>}</td>
                  <td className="min-w-[180px]">
                    <span className={cn(l.kind === 'CHILD' && 'pl-3')}>{l.description || l.skuName || (isBlankLine(l) ? <span className="text-ink-muted">Pick a product or kit</span> : null)}</span>
                    {l.skuActive === false && <span className="ml-1 text-[11px] text-err">not in SKU Master</span>}
                  </td>
                  <td className="text-right">{priced(l) && <input aria-label="Qty" type="number" min={1} inputMode="numeric" disabled={disabled} className={dayCell}
                    value={l.qty} onChange={(e) => setLine(a, i, { qty: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })} />}</td>
                  <td className="text-right tabular-nums text-ink-muted">{priced(l) ? rm(l.skuPriceSen ?? null) : ''}</td>
                  <td className="text-right tabular-nums">{priced(l) ? rm((l.skuPriceSen ?? 0) * l.qty) : ''}</td>
                  {showSla && <td className="text-right">{priced(l) && <DaysInput label="Order after days" disabled={disabled} value={l.processingAfterDays} onChange={(v) => setLine(a, i, { processingAfterDays: v })} />}</td>}
                  {showSla && <td className="text-right">{priced(l) && <DaysInput label="Deliver after days" disabled={disabled} value={l.deliveryAfterDays} onChange={(v) => setLine(a, i, { deliveryAfterDays: v })} />}</td>}
                  <td className="pr-2 text-right">
                    {!disabled && (
                      <span className="inline-flex gap-0.5 text-ink-muted">
                        <button type="button" aria-label="Move up" className="rounded p-1 hover:bg-surface-dim md:hidden" onClick={() => i > 0 && onChange(moveLine(sections, { a, l: i }, { a, l: i - 1 }))}><ArrowUp size={13} /></button>
                        <button type="button" aria-label="Move down" className="rounded p-1 hover:bg-surface-dim md:hidden" onClick={() => i < s.lines.length - 1 && onChange(moveLine(sections, { a, l: i }, { a, l: i + 2 }))}><ArrowDown size={13} /></button>
                        <button type="button" aria-label="Remove line" className="rounded p-1 hover:bg-err-bg hover:text-err" onClick={() => removeLine(a, i)}><X size={14} /></button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {s.lines.length === 0 && <tr data-drop={`area:${a}`} className="border-t border-border-subtle"><td /><td colSpan={cols - 1} className="py-3 text-[12px] text-ink-muted">No lines in this area yet.</td></tr>}
            </AreaRows>
          ))}
          {sections.length === 0 && <tr><td colSpan={cols} className="py-6 text-center text-[12.5px] text-ink-muted">No lines yet. Add a product or a kit.</td></tr>}
        </tbody>
      </table>
      {!disabled && !showAreas && (
        <div className="border-t border-border-subtle px-3 py-2">
          <button type="button" onClick={() => addBlank(0)} className="rounded border border-border px-2 py-0.5 text-[12px] font-semibold text-ink-secondary hover:border-primary hover:text-primary">+ Line</button>
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-4 border-t border-border-subtle px-3 py-2 text-[12.5px] text-ink-secondary">
        <span>Lines <b className="text-ink">{sections.reduce((t, s) => t + s.lines.filter((l) => priced(l) && !isBlankLine(l)).length, 0)}</b></span>
        <span>At today's SKU prices <b className="tabular-nums text-ink">{rm(total)}</b></span>
      </div>
      <p className="px-3 pb-2 text-right text-[12px] text-ink-muted">Prices are not kept in the package: each line takes the SKU Master price when it is added to a sales order, and can be changed there.</p>
    </div>
  );
}

function AreaRows({ children }: { children: ReactNode }): ReactElement {
  return <>{children}</>;
}

/** "+ Area" with the quick names from the design. */
export function AddAreaBar({ onAdd, existing }: { onAdd: (name: string) => void; existing: string[] }): ReactElement {
  const quick = ['Living room', 'Dining', 'Master bedroom', 'Bedroom 2', 'Bedroom 3', 'Kitchen', 'Study', 'Balcony'].filter((n) => !existing.includes(n));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" onClick={() => onAdd('')} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] font-semibold text-ink-secondary hover:border-primary hover:text-primary"><Plus size={13} /> Area</button>
      <span className="text-[11.5px] text-ink-muted">Quick add:</span>
      {quick.map((n) => <button key={n} type="button" onClick={() => onAdd(n)} className="rounded-full border border-border px-2 py-0.5 text-[11.5px] text-ink-secondary hover:border-primary hover:text-primary">+ {n}</button>)}
    </div>
  );
}
