/* Packages in the sales order and VO (owner, 20 Nov 2026).
   - PackagePickerDialog / FromPackageButton: find an active package or kit (grouped Packages / Kits). From the sales order
     page it opens a new VO with the package (?package=<id>); lines added to a contract always go through a VO.
   - PackageConfirmDialog: before the lines go in, untick lines, change qty, rename areas; shows price and SLA days. The
     lines go into the VO's Add part as additions, each remembering the package (fromPackageId), at the SKU Master price of
     this moment. A kit with no area goes into the area the user is in.
   - SaveAsPackageDialog: on the sales order page, tick areas and lines and save them as a new package (quantities and
     SLA days copied, prices not). */

import { useEffect, useMemo, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileDown, Package, Search } from 'lucide-react';
import { Button } from '../../components/Button';
import { ModalOverlay } from '../../components/scm-v2/DocumentRelationshipMapModal';
import { refusalOf, type ContractView, type DocLine, type DocSection } from '../../lib/renovation/api';
import {
  createPackage, expandPackage, KIND_LONG, NO_AREA, nextPackageCode, searchPackages, type ExpandedPackage, type PackageHit, type PackageKind,
} from '../../lib/renovation/renovationPackagesApi';
import { amountsOf } from './DocEditor';
import { chosenPackageSections } from './renovationPackageAdd';
import { ErrorBanner, Field, inputCls, rm } from './shared';
import { dayCell, KindPill } from './renovationPackageParts';
import { cn } from '../../lib/utils';

/** Grouped results: packages first, then kits. Shared by the picker dialog and the line product search. */
export function PackageHits({ hits, onPick }: { hits: PackageHit[]; onPick: (h: PackageHit) => void }): ReactElement | null {
  if (hits.length === 0) return null;
  const group = (kind: PackageKind, title: string) => {
    const rows = hits.filter((h) => h.kind === kind);
    if (rows.length === 0) return null;
    return (
      <>
        <div className="px-2 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">{title}</div>
        {rows.map((h) => (
          <button key={h.id} type="button" onClick={() => onPick(h)} className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-primary-soft">
            <KindPill kind={h.kind} className="mt-0.5" />
            <span className="min-w-0">
              <span className="block text-[12.5px] font-semibold text-ink">{h.code} · {h.name}</span>
              <span className="block truncate text-[11px] text-ink-muted">
                {h.kind === 'PACKAGE' ? `${h.areas} area${h.areas === 1 ? '' : 's'} · ` : ''}{h.lines} line{h.lines === 1 ? '' : 's'}
                {h.kind === 'KIT' && h.itemCodes.length ? ` · ${h.itemCodes.slice(0, 4).join(', ')}` : ''} · {rm(h.totalSen)}
                {h.building ? ` · ${h.building}` : ''}
              </span>
            </span>
          </button>
        ))}
      </>
    );
  };
  return <>{group('PACKAGE', 'Packages')}{group('KIT', 'Kits')}</>;
}

/** Package search with live results, debounced. */
export function usePackageSearch(q: string, enabled: boolean): PackageHit[] {
  const [hits, setHits] = useState<PackageHit[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const t = setTimeout(() => { searchPackages(q).then((r) => { if (live) setHits(r.packages); }).catch(() => { if (live) setHits([]); }); }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [q, enabled]);
  return hits;
}

export function PackagePickerDialog({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (h: PackageHit) => void }): ReactElement {
  const [q, setQ] = useState('');
  const hits = usePackageSearch(q, open);
  return (
    <ModalOverlay open={open} onClose={onClose} title="From package" icon={<Package size={16} />}>
      <div className="space-y-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
          {open && <input autoFocus aria-label="Search packages" className={cn(inputCls, 'w-full pl-8')} placeholder="Search code, name, building or a product" value={q} onChange={(e) => setQ(e.target.value)} />}
        </div>
        <div className="max-h-[50vh] overflow-auto">
          <PackageHits hits={hits} onPick={onPick} />
          {hits.length === 0 && <p className="px-2 py-4 text-center text-[12.5px] text-ink-muted">No active package or kit matches.</p>}
        </div>
      </div>
    </ModalOverlay>
  );
}

/** On the sales order: pick a package, then a new VO opens with it in its confirm dialog. */
export function FromPackageButton({ docNo, className, style }: { docNo: string; onError: (text: string) => void; className?: string; style?: CSSProperties }): ReactElement {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const pick = (h: PackageHit) => navigate(`/scm/renovation/variation-orders/new?so=${encodeURIComponent(docNo)}&package=${encodeURIComponent(h.id)}`);
  return (
    <>
      <button type="button" className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...style }} onClick={() => setOpen(true)}
        title="Add a package's or kit's products to this sales order, through a new VO">
        <Package size={15} aria-hidden="true" />From package
      </button>
      <PackagePickerDialog open={open} onClose={() => setOpen(false)} onPick={pick} />
    </>
  );
}

interface LinePick { on: boolean; qty: number }
const priced = (l: Pick<DocLine, 'kind'>) => l.kind === 'ITEM' || l.kind === 'CHILD';

/** What came in from one package: the dialog's answer, kept to reopen it (Change picks). */
export interface PackageAdd { packageId: string; code: string; name: string; total: number; sections: DocSection[] }

export function PackageConfirmDialog({ packageId, defaultArea, initial, onClose, onAdd }: {
  packageId: string | null; defaultArea: string; initial?: DocSection[]; onClose: () => void; onAdd: (a: PackageAdd) => void;
}): ReactElement {
  const [pkg, setPkg] = useState<ExpandedPackage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, LinePick>>({});
  const [areaNames, setAreaNames] = useState<string[]>([]);
  useEffect(() => {
    if (!packageId) { setPkg(null); return; }
    let live = true;
    setError(null);
    expandPackage(packageId).then((p) => {
      if (!live) return;
      setPkg(p);
      // Reopened (Change picks): what is on the VO now is ticked, with its quantities; the rest unticked.
      const kept = initial ? initial.flatMap((s) => s.lines.filter((l) => priced(l))) : null;
      const next: Record<string, LinePick> = {};
      p.sections.forEach((s, si) => s.lines.forEach((l, li) => {
        if (!priced(l)) return;
        const k = kept?.findIndex((x) => x.itemCode === l.itemCode) ?? -1;
        const hit = kept && k >= 0 ? kept.splice(k, 1)[0] : null;
        next[`${si}_${li}`] = { on: kept ? Boolean(hit) : true, qty: hit?.qty ?? l.qty };
      }));
      setPicks(next);
      const named = initial?.map((s) => s.heading) ?? [];
      setAreaNames(p.sections.map((s, i) => (p.kind === 'KIT' && !s.heading.trim() ? defaultArea : named[i] ?? s.heading)));
    }).catch((e) => { if (live) setError(refusalOf(e).message); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per package opened
  }, [packageId]);
  const all = pkg ? pkg.sections.flatMap((s) => s.lines.filter((l) => priced(l))) : [];
  const chosen = useMemo(() => (pkg ? chosenPackageSections(pkg, picks, areaNames) : []), [pkg, picks, areaNames]);
  const n = chosen.reduce((t, s) => t + s.lines.filter((l) => priced(l)).length, 0);
  const total = chosen.reduce((t, s) => t + s.lines.reduce((u, l) => u + (priced(l) ? amountsOf(l).netSen : 0), 0), 0);
  const title = pkg ? `Add ${pkg.code} · ${pkg.name}` : 'Add package';
  return (
    <ModalOverlay open={Boolean(packageId)} onClose={onClose} size="lg" title={title} icon={<Package size={16} />}
      footer={(
        <div className="flex w-full flex-wrap items-center gap-2">
          <span className="text-[12.5px] text-ink-secondary">{n} of {all.length} lines · {rm(total)}</span>
          <span className="flex-1" />
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!pkg || n === 0} onClick={() => pkg && onAdd({ packageId: pkg.id, code: pkg.code, name: pkg.name, total, sections: chosen })}>Add {n} line{n === 1 ? '' : 's'}</Button>
        </div>
      )}>
      <ErrorBanner error={error} />
      {!pkg && !error && <p className="py-6 text-center text-[13px] text-ink-muted">Loading…</p>}
      {pkg && (
        <div className="space-y-2">
          <p className="text-[12.5px] text-ink-secondary">{all.length} lines{pkg.kind === 'PACKAGE' ? ` in ${pkg.sections.length} area${pkg.sections.length === 1 ? '' : 's'}` : ''}. Untick what this project does not need. Prices are today's SKU Master prices and can be changed on the VO.</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[12.5px]">
              <thead className="bg-surface-2 text-[10.5px] uppercase tracking-wide text-ink-muted">
                <tr><th className="w-8 py-2" /><th>Code</th><th>Description</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Order after (days)</th><th className="pr-2 text-right">Deliver after (days)</th></tr>
              </thead>
              <tbody>
                {pkg.sections.map((s, si) => (
                  <SectionRows key={si}>
                    <tr className="border-t border-border bg-surface-2/60">
                      <td colSpan={7} className="px-2 py-1.5">
                        <input aria-label="Area name" className={cn(inputCls, 'h-8 w-[240px] font-semibold')} value={areaNames[si] ?? ''} placeholder={NO_AREA}
                          onChange={(e) => setAreaNames(areaNames.map((a, i) => (i === si ? e.target.value : a)))} />
                      </td>
                    </tr>
                    {s.lines.map((l, li) => {
                      if (!priced(l)) return null;
                      const k = `${si}_${li}`; const p = picks[k] ?? { on: true, qty: l.qty };
                      return (
                        <tr key={k} className={cn('border-t border-border-subtle', !p.on && 'opacity-45')}>
                          <td className="pl-2"><input type="checkbox" aria-label={`Include ${l.itemCode}`} checked={p.on} onChange={(e) => setPicks({ ...picks, [k]: { ...p, on: e.target.checked } })} /></td>
                          <td className="py-1.5 font-mono text-[12px] font-semibold">{l.itemCode}</td>
                          <td>{l.description}{l.skuActive === false && <span className="ml-1 text-[11px] text-err">not in SKU Master</span>}</td>
                          <td className="text-right"><input aria-label="Qty" type="number" min={1} className={dayCell} value={p.qty} onChange={(e) => setPicks({ ...picks, [k]: { ...p, qty: Math.max(1, Math.trunc(Number(e.target.value) || 1)) } })} /></td>
                          <td className="text-right tabular-nums">{rm(l.unitPriceSen)}</td>
                          <td className="text-right text-ink-secondary">{l.processingAfterDays != null ? `${l.processingAfterDays} days` : '-'}</td>
                          <td className="pr-2 text-right text-ink-secondary">{l.deliveryAfterDays != null ? `${l.deliveryAfterDays} days` : '-'}</td>
                        </tr>
                      );
                    })}
                  </SectionRows>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </ModalOverlay>
  );
}

function SectionRows({ children }: { children: ReactNode }): ReactElement { return <>{children}</>; }

/** Save the ticked areas and lines of a sales order as a new package. Quantities and SLA days are copied, prices not. */
export function SaveAsPackageDialog({ contract, open, onClose, onSaved }: { contract: ContractView; open: boolean; onClose: () => void; onSaved: (id: string, code: string, openIt: boolean) => void }): ReactElement {
  const live = useMemo(() => contract.sections
    .map((s) => ({ ...s, lines: s.lines.filter((l) => priced(l) && l.itemCode && !l.omittedByVoId && !l.soItemCancelled) }))
    .filter((s) => s.lines.length > 0), [contract.sections]);
  const [kind, setKind] = useState<PackageKind>('PACKAGE');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [openIt, setOpenIt] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setTicked(Object.fromEntries(live.flatMap((s, si) => s.lines.map((_, li) => [`${si}_${li}`, true]))));
    setName(`${contract.header.building || contract.debtorName} ${contract.header.unitNo ?? ''}`.trim());
    setError(null);
  }, [open, live, contract]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    nextPackageCode(kind).then((r) => { if (alive) setCode(r.code); }).catch(() => undefined);
    return () => { alive = false; };
  }, [open, kind]);
  const n = Object.values(ticked).filter(Boolean).length;
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const sections: DocSection[] = live.map((s, si) => ({
        heading: kind === 'KIT' ? '' : s.heading, bandColor: null, lumpSumSen: null, pageBreakBefore: false,
        lines: s.lines.filter((_, li) => ticked[`${si}_${li}`]).map((l) => ({ ...l, id: undefined, parentId: undefined, soItemId: null, kind: l.kind === 'CHILD' ? 'ITEM' : l.kind })),
      })).filter((s) => s.lines.length > 0);
      const merged = kind === 'KIT' ? [{ ...sections[0], lines: sections.flatMap((s) => s.lines) }] : sections;
      const r = await createPackage({ kind, code: code.trim(), name: name.trim(), status: 'DRAFT', sections: merged, fromSoDocNo: contract.docNo });
      onSaved(r.id, r.code, openIt);
    } catch (e) { setError(refusalOf(e).message); } finally { setBusy(false); }
  };
  return (
    <ModalOverlay open={open} onClose={onClose} size="lg" title={`Save ${contract.docNo} as a package`} icon={<FileDown size={16} />}
      footer={(
        <div className="flex w-full flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[12.5px] text-ink-secondary"><input type="checkbox" checked={openIt} onChange={(e) => setOpenIt(e.target.checked)} /> Open it after saving to fill SLA days</label>
          <span className="flex-1" />
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || n === 0 || !code.trim() || !name.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save package'}</Button>
        </div>
      )}>
      <div className="space-y-3">
        <p className="text-[12.5px] text-ink-secondary">Tick the areas and lines to keep. Quantities and SLA days come from the sales order; prices are not kept (each line takes the SKU Master price when it is used). It is saved as a draft.</p>
        <ErrorBanner error={error} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Code"><input className={cn(inputCls, 'font-mono uppercase')} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></Field>
          <Field label="Name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Type"><select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as PackageKind)}><option value="PACKAGE">{KIND_LONG.PACKAGE}</option><option value="KIT">{KIND_LONG.KIT}</option></select></Field>
        </div>
        <div className="max-h-[42vh] overflow-auto rounded-lg border border-border">
          <table className="w-full text-left text-[12.5px]">
            <thead className="sticky top-0 bg-surface-2 text-[10.5px] uppercase tracking-wide text-ink-muted"><tr><th className="w-8 py-2" /><th>Code</th><th>Description</th><th className="pr-3 text-right">Qty</th></tr></thead>
            <tbody>
              {live.map((s, si) => {
                const keys = s.lines.map((_, li) => `${si}_${li}`);
                const allOn = keys.every((k) => ticked[k]);
                return (
                  <SectionRows key={si}>
                    <tr className="border-t border-border bg-surface-2/60">
                      <td className="pl-2"><input type="checkbox" aria-label={`Keep area ${s.heading || NO_AREA}`} checked={allOn} onChange={(e) => setTicked({ ...ticked, ...Object.fromEntries(keys.map((k) => [k, e.target.checked])) })} /></td>
                      <td colSpan={3} className="py-1.5 font-semibold">{s.heading || NO_AREA}</td>
                    </tr>
                    {s.lines.map((l, li) => (
                      <tr key={li} className="border-t border-border-subtle">
                        <td className="pl-2"><input type="checkbox" aria-label={`Keep ${l.itemCode}`} checked={Boolean(ticked[`${si}_${li}`])} onChange={(e) => setTicked({ ...ticked, [`${si}_${li}`]: e.target.checked })} /></td>
                        <td className="py-1.5 font-mono text-[12px] font-semibold">{l.itemCode}</td>
                        <td>{l.description}</td>
                        <td className="pr-3 text-right tabular-nums">{l.qty}</td>
                      </tr>
                    ))}
                  </SectionRows>
                );
              })}
              {live.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-ink-muted">This sales order has no product line to save.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="text-[12px] text-ink-muted">{n} line{n === 1 ? '' : 's'} ticked.</p>
      </div>
    </ModalOverlay>
  );
}
