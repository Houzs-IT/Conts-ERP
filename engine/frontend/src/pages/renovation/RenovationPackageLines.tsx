/* The lines of a package, grouped by area (owner, 20 Nov 2026). Each line: product, quantity, today's SKU Master selling
   price greyed as a reference, and the two SLA days (both optional). Drag the dots to reorder lines and areas; a line can
   be dropped into another area. Products and kits are added through the same SKU search as the sales order. A package
   holds no price, so nothing here is typed as money, and no cost or margin is shown. */

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Plus, Search, X } from 'lucide-react';
import { searchProducts, type DocLine, type ProductPick } from '../../lib/renovation/api';
import { expandPackage, NO_AREA, searchPackages, type PackageHit, type PackageLine, type PackageSection } from '../../lib/renovation/renovationPackagesApi';
import { blankLine } from './DocEditor';
import { inputCls, rm } from './shared';
import { dayCell, KindPill, slaDaysOf } from './renovationPackageParts';
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

/** The SKU / kit search used to add products to a package. */
export function PackageAddSearch({ onAdd, autoFocus }: { onAdd: (lines: PackageLine[], label: string) => void; autoFocus?: boolean }): ReactElement {
  const [q, setQ] = useState('');
  const [skus, setSkus] = useState<ProductPick[]>([]);
  const [kits, setKits] = useState<PackageHit[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setBusy(true);
    const t = setTimeout(() => {
      Promise.all([searchProducts(q).catch(() => ({ products: [] })), searchPackages(q).catch(() => ({ packages: [] }))])
        .then(([p, k]) => { if (!live) return; setSkus(p.products.slice(0, 12)); setKits(k.packages.filter((x) => x.kind === 'KIT').slice(0, 6)); })
        .finally(() => { if (live) setBusy(false); });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  return (
    <div className="min-w-0">
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
        <input autoFocus={autoFocus} aria-label="Search SKU or kit" className={cn(inputCls, 'w-full pl-8')} placeholder="Search SKU or kit, e.g. hiace, bed, KIT" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="mt-2 max-h-[340px] overflow-auto rounded-lg border border-border">
        {kits.length > 0 && <div className="bg-surface-2 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">组合 (kits)</div>}
        {kits.map((k) => (
          <button key={k.id} type="button" className="flex w-full items-start gap-2 border-b border-border-subtle px-2.5 py-2 text-left hover:bg-primary-soft"
            onClick={() => void linesOfKit(k.id).then((ls) => onAdd(ls, `${k.code} (${ls.length} lines)`))}>
            <KindPill kind="KIT" />
            <span className="min-w-0"><span className="block text-[12.5px] font-semibold text-ink">{k.code} · {k.name}</span><span className="block text-[11px] text-ink-muted">adds {k.lines} line{k.lines === 1 ? '' : 's'}</span></span>
          </button>
        ))}
        {skus.length > 0 && <div className="bg-surface-2 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">SKUs</div>}
        {skus.map((p) => (
          <button key={p.code} type="button" className="flex w-full flex-col border-b border-border-subtle px-2.5 py-2 text-left hover:bg-primary-soft" onClick={() => onAdd([lineFromProduct(p)], p.code)}>
            <span className="text-[12.5px] font-semibold text-ink">{p.code}</span>
            <span className="text-[11px] text-ink-muted">{[p.name, p.subCategory ?? p.group, p.sellPriceSen ? rm(p.sellPriceSen) : null].filter(Boolean).join(' · ')}</span>
          </button>
        ))}
        {!busy && skus.length === 0 && kits.length === 0 && <div className="px-3 py-4 text-center text-[12px] text-ink-muted">No match</div>}
        {busy && skus.length === 0 && kits.length === 0 && <div className="px-3 py-4 text-center text-[12px] text-ink-muted">Searching…</div>}
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

export function PackageLinesTable({ sections, onChange, disabled, showAreas, showSla = true, onAddLine }: {
  sections: PackageSection[]; onChange: (s: PackageSection[]) => void; disabled?: boolean; showAreas: boolean; showSla?: boolean;
  /** "+ Line" on an area header: the editor opens its search for that area. */
  onAddLine?: (areaIndex: number) => void;
}): ReactElement {
  const [drag, setDrag] = useState<DragRef | null>(null);
  const setLine = (a: number, l: number, p: Partial<PackageLine>) => onChange(sections.map((s, i) => (i !== a ? s : { ...s, lines: s.lines.map((x, j) => (j === l ? { ...x, ...p } : x)) })));
  const removeLine = (a: number, l: number) => onChange(sections.map((s, i) => (i !== a ? s : { ...s, lines: s.lines.filter((_, j) => j !== l) })));
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
            {showSla && <th className="w-[96px] text-right" title="Days after the project start date, optional">Order after</th>}
            {showSla && <th className="w-[96px] text-right" title="Days after the project start date, optional">Deliver after</th>}
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
                        {onAddLine && <button type="button" onClick={() => onAddLine(a)} className="rounded border border-border px-1.5 py-0.5 text-[11.5px] font-semibold text-ink-secondary hover:border-primary hover:text-primary">+ Line</button>}
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
                  <td className="py-1.5 font-mono text-[12px] font-semibold text-ink">{l.itemCode ?? <span className="font-sans font-normal text-ink-muted">{l.kind === 'TEXT' ? 'Text' : '—'}</span>}</td>
                  <td className="min-w-[180px]">
                    <span className={cn(l.kind === 'CHILD' && 'pl-3')}>{l.description || l.skuName}</span>
                    {l.skuActive === false && <span className="ml-1 text-[11px] text-err">not in SKU Master</span>}
                  </td>
                  <td className="text-right">{priced(l) && <input aria-label="Qty" type="number" min={1} inputMode="numeric" disabled={disabled} className={dayCell}
                    value={l.qty} onChange={(e) => setLine(a, i, { qty: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })} />}</td>
                  <td className="text-right tabular-nums text-ink-muted">{priced(l) ? rm(l.skuPriceSen ?? null) : ''}</td>
                  <td className="text-right tabular-nums">{priced(l) ? rm((l.skuPriceSen ?? 0) * l.qty) : ''}</td>
                  {showSla && <td className="text-right">{priced(l) && <input aria-label="Order after days" type="number" min={0} inputMode="numeric" placeholder="-" disabled={disabled} className={dayCell}
                    value={l.processingAfterDays ?? ''} onChange={(e) => setLine(a, i, { processingAfterDays: slaDaysOf(e.target.value) })} />}</td>}
                  {showSla && <td className="text-right">{priced(l) && <input aria-label="Deliver after days" type="number" min={0} inputMode="numeric" placeholder="-" disabled={disabled} className={dayCell}
                    value={l.deliveryAfterDays ?? ''} onChange={(e) => setLine(a, i, { deliveryAfterDays: slaDaysOf(e.target.value) })} />}</td>}
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
      <div className="flex flex-wrap justify-end gap-4 border-t border-border-subtle px-3 py-2 text-[12.5px] text-ink-secondary">
        <span>Lines <b className="text-ink">{sections.reduce((t, s) => t + s.lines.filter(priced).length, 0)}</b></span>
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
