import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { DataTable, type Column } from '../components/DataTable';
import { Drawer } from '../components/Dialog';
import { Select } from '../components/Select';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState, Skeleton } from '../components/States';
import { StaleBanner } from '../components/DataState';
import { MoneyInput, NumberInput, DateField } from '../components/inputs';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { useApi } from '../lib/useApi';
import { api, errorMessage, downloadFile } from '../lib/api';
import { cx } from '../lib/design-tokens';
import { rm, date as dayText } from '../lib/format';
import { csvObjects, readXlsx, sheetObjects, type SheetRow } from '../lib/sheets';
import { Modal, LabeledField, INPUT_CX, LABEL_CX } from './MaintenanceCatalog';

/* GET /api/operations/service-prices (functions/api/operations/service-prices). Amounts in sen; null = not set. */
type Domain = 'cleaning' | 'maintenance';
interface Cell { ownerPrice: number | null; internalCost: number | null; effectiveFrom: string | null }
export interface ServiceItem {
  id: string; code: string; name: string; domain: Domain; category: string; uom: string; cleanKind: string | null; byLayout: boolean;
  active: boolean; notes: string; trackStock: boolean; stockOnHand: number;
  current: Record<string, Cell>; next: { effectiveFrom: string; rows: Record<string, Cell> } | null;
}
interface ListPayload {
  ready: boolean; mayEdit: boolean; mayPrice: boolean; today: string; layouts: string[]; uoms: string[]; cleanTypes: string[];
  categories: Record<Domain, string[]>; items: ServiceItem[];
}
interface Detail extends ServiceItem {
  today: string; jobs: number;
  history: { effectiveFrom: string; status: 'scheduled' | 'current' | 'past'; note: string | null; setBy: string | null; setAt: string; rows: { layout: string; ownerPrice: number | null; internalCost: number | null }[] }[];
}

export const DOMAIN_LABEL: Record<Domain, string> = { cleaning: 'Cleaning', maintenance: 'Maintenance' };
export const SUB_LABEL: Record<string, string> = {
  turnover: 'Standard clean', deep_clean: 'Deep clean', light_clean: 'Light clean', laundry: 'Laundry', aircon: 'Aircon', plumbing: 'Plumbing',
  electrical: 'Electrical', furniture: 'Furniture', appliance: 'Appliance', cleaning: 'Cleaning', general: 'General', other: 'Other',
};
export const LAYOUT_LABEL: Record<string, string> = {
  all: 'Every unit', studio: 'Studio', '1_bedroom': '1 bedroom', '2_bedroom': '2 bedroom', '3_bedroom': '3 bedroom', '4_plus_bedroom': '4+ bedroom',
  duplex: 'Duplex', dual_key: 'Dual key', penthouse: 'Penthouse', other: 'Other',
};
const UOM_LABEL: Record<string, string> = { job: 'Per job', unit: 'Per unit', hour: 'Per hour', visit: 'Per visit', set: 'Per set' };
const CLEAN_TYPE_LABEL: Record<string, string> = { turnover: 'Standard clean', deep_clean: 'Deep clean', light_clean: 'Light clean' };

const layoutsOf = (i: { byLayout: boolean }, all: string[]) => (i.byLayout ? all : ['all']);
const priced = (cells: Cell[]) => cells.filter(c => c.ownerPrice != null || c.internalCost != null);
/** "RM 80.00" or "RM 80.00 – 200.00" across the layouts that have a figure. */
function range(cells: (number | null)[]): string | null {
  const v = cells.filter((x): x is number => x != null);
  if (!v.length) return null;
  const lo = Math.min(...v), hi = Math.max(...v);
  return lo === hi ? rm(lo) : `${rm(lo)} – ${(hi / 100).toFixed(2)}`;
}
const margin = (o: number | null, i: number | null) => (o == null || i == null ? null : o - i);
const marginText = (o: number | null, i: number | null) => {
  const m = margin(o, i);
  if (m == null) return null;
  return o ? `${rm(m)} · ${Math.round((m / o) * 100)}%` : rm(m);
};

/** Service prices: one list of the cleaning and maintenance services we sell (Houzs product maintenance shape), each with
 *  the owner price and the internal cost, effective-dated. `domain` scopes it for Cleaning > Prices and Maintenance >
 *  Item catalog; Settings shows both. */
export function ServicePrices({ domain, above, onChanged }: { domain?: Domain; above?: ReactNode; onChanged?: () => void }) {
  const list = useApi<ListPayload>(`/operations/service-prices${domain ? `?domain=${domain}` : ''}`);
  const changed = () => { list.reload(); onChanged?.(); };
  const toast = useToast();
  const [type, setType] = useState<'all' | Domain>('all');
  const [showRetired, setShowRetired] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const d = list.data;
  const items = useMemo(() => (d?.items ?? []).filter(i => (showRetired || i.active) && (domain || type === 'all' || i.domain === type)), [d, showRetired, type, domain]);
  const layouts = d?.layouts ?? [];

  const columns = useMemo<Column<ServiceItem>[]>(() => [
    { key: 'code', label: 'Code', type: 'ref', value: i => i.code, width: 130, phone: 'badge' },
    { key: 'name', label: 'Item', value: i => i.name, hideable: false, width: 220, phone: 'title', sub: i => i.notes || null, render: i => <span className="font-semibold">{i.name}</span> },
    ...(domain ? [] : [{ key: 'domain', label: 'Type', type: 'status' as const, value: (i: ServiceItem) => i.domain, status: (i: ServiceItem) => ({ label: DOMAIN_LABEL[i.domain], tone: (i.domain === 'cleaning' ? 'gold' : 'neutral') as 'gold' | 'neutral' }), width: 120 }]),
    { key: 'category', label: 'Sub-category', value: i => SUB_LABEL[i.category] ?? i.category, width: 130,
      sub: i => (i.cleanKind ? `Prices reservation ${CLEAN_TYPE_LABEL[i.cleanKind].toLowerCase()}s` : null) },
    { key: 'uom', label: 'Unit of measure', value: i => UOM_LABEL[i.uom] ?? i.uom, width: 110, sub: i => (i.byLayout ? 'By layout' : null) },
    { key: 'owner', label: 'Owner price', type: 'money', width: 150, align: 'right', phone: 'right',
      value: i => Math.min(...layoutsOf(i, layouts).map(l => i.current[l]?.ownerPrice ?? Infinity)) === Infinity ? null : Math.min(...layoutsOf(i, layouts).map(l => i.current[l]?.ownerPrice ?? Infinity)),
      render: i => { const t = range(layoutsOf(i, layouts).map(l => i.current[l]?.ownerPrice ?? null)); return t ? <span className="tabular-nums">{t}</span> : <span className="text-warning">Not set</span>; } },
    { key: 'internal', label: 'Internal cost', type: 'money', width: 150, align: 'right',
      value: i => { const v = layoutsOf(i, layouts).map(l => i.current[l]?.internalCost).filter((x): x is number => x != null); return v.length ? Math.min(...v) : null; },
      render: i => { const t = range(layoutsOf(i, layouts).map(l => i.current[l]?.internalCost ?? null)); return t ? <span className="tabular-nums">{t}</span> : <span className="text-warning">Not set</span>; } },
    { key: 'margin', label: 'Margin', type: 'money', width: 150, align: 'right', title: 'Owner price less internal cost: what The Conts keeps.',
      value: i => { const v = layoutsOf(i, layouts).map(l => margin(i.current[l]?.ownerPrice ?? null, i.current[l]?.internalCost ?? null)).filter((x): x is number => x != null); return v.length ? Math.min(...v) : null; },
      render: i => {
        const v = layoutsOf(i, layouts).map(l => margin(i.current[l]?.ownerPrice ?? null, i.current[l]?.internalCost ?? null));
        const t = range(v);
        return t ? <span className={cx('tabular-nums', v.some(x => x != null && x < 0) && 'text-danger')}>{t}</span> : <span className="text-muted-ink">–</span>;
      } },
    { key: 'next', label: 'Next change', type: 'date', width: 130, value: i => i.next?.effectiveFrom ?? null,
      render: i => (i.next ? <StatusBadge tone="gold" size="sm" label={`From ${dayText(i.next.effectiveFrom)}`} /> : <span className="text-muted-ink">None</span>) },
    { key: 'active', label: 'Status', type: 'status', width: 100, value: i => (i.active ? 'active' : 'retired'), status: i => ({ label: i.active ? 'Active' : 'Retired', tone: i.active ? 'success' : 'warning' }) },
  ], [domain, layouts]);

  if (d && !d.ready) return <EmptyState icon="Tag" title="Service prices are not switched on yet." body="They need a database update (migration 0127). Until then the old cleaning price table and maintenance catalog are used." />;
  const unset = items.filter(i => i.active && !priced(layoutsOf(i, layouts).map(l => i.current[l] ?? { ownerPrice: null, internalCost: null, effectiveFrom: null })).length).length;

  return (
    <div className="flex flex-col gap-3">
      {list.error && <StaleBanner message={list.error} onRetry={list.reload} />}
      {above}
      <DataTable<ServiceItem>
        id={`service-prices${domain ? `.${domain}` : ''}`} urlPrefix="sp." columns={columns} rows={!d ? null : items} rowKey={i => i.id}
        pageSize={0} noun={['item', 'items']} exportName="service-prices" defaultSort="code:asc"
        rowTone={i => (i.active ? null : 'muted')} onRowClick={i => setOpenId(i.id)}
        renderCard={i => {
          const ls = layoutsOf(i, layouts);
          const owner = range(ls.map(l => i.current[l]?.ownerPrice ?? null)), cost = range(ls.map(l => i.current[l]?.internalCost ?? null));
          const marg = range(ls.map(l => margin(i.current[l]?.ownerPrice ?? null, i.current[l]?.internalCost ?? null)));
          return (
            <span className="flex flex-col gap-0.5 min-w-0" data-item={i.code}>
              <span className="flex items-baseline gap-2">
                <span className="text-copy font-semibold flex-1 min-w-0 truncate">{i.name}</span>
                {owner ? <span className="text-copy font-semibold tabular-nums">{owner}</span> : <span className="text-warning text-meta">Not set</span>}
              </span>
              <span className="text-meta text-muted-ink">{i.code} · {SUB_LABEL[i.category] ?? i.category} · {UOM_LABEL[i.uom] ?? i.uom}{i.byLayout ? ' · by layout' : ''}</span>
              <span className="text-meta text-muted-ink tabular-nums">Internal cost {cost ?? 'not set'}{marg ? ` · margin ${marg}` : ''}{i.next ? ` · changes ${dayText(i.next.effectiveFrom)}` : ''}{i.active ? '' : ' · retired'}</span>
            </span>
          );
        }}
        filtered={!showRetired && (d?.items.some(i => !i.active) ?? false)} onClearFilters={() => setShowRetired(true)}
        toolbar={<div className="flex items-center gap-3 flex-wrap">
          {!domain && <Select label="Type" value={type} onChange={v => setType(v as 'all' | Domain)} options={[{ value: 'all', label: 'Cleaning and maintenance' }, { value: 'cleaning', label: 'Cleaning' }, { value: 'maintenance', label: 'Maintenance' }]} />}
          <span className="text-copy text-muted-ink">{items.filter(i => i.active).length} active{unset ? ` · ${unset} without a price` : ''}</span>
        </div>}
        actions={<>
          <label className="flex items-center gap-1.5 text-meta text-muted-ink cursor-pointer">
            <input type="checkbox" checked={showRetired} onChange={e => setShowRetired(e.target.checked)} />
            Show retired
          </label>
          <Button size="sm" variant="secondary" icon={<Icon name="Download" size="sm" />} onClick={() => { downloadFile('/operations/service-prices/export', { domain }).catch(e => toast({ tone: 'critical', title: 'Not downloaded.', body: errorMessage(e) })); }}>Price sheet</Button>
          {d?.mayEdit && <Button size="sm" variant="secondary" icon={<Icon name="Upload" size="sm" />} onClick={() => setImporting(true)}>Import prices</Button>}
          {d?.mayEdit && <Button size="sm" variant="primary" onClick={() => setCreating(true)}>New item</Button>}
        </>}
        empty={{ title: 'No service items yet', icon: 'Tag', body: d?.mayEdit ? 'Add an item, or import a spreadsheet of items and prices.' : 'Items appear here once operations adds them.',
          action: d?.mayEdit ? { label: 'New item', onClick: () => setCreating(true) } : undefined }}
      />
      {openId && d && <ItemDrawer id={openId} list={d} onClose={() => setOpenId(null)} onChanged={changed} />}
      {creating && d && <NewItemModal list={d} domain={domain ?? (type === 'all' ? undefined : type)} onClose={() => setCreating(false)} onSaved={id => { setCreating(false); changed(); setOpenId(id); }} />}
      {importing && d && <ImportModal domain={domain} mayPrice={d.mayPrice} today={d.today} onClose={() => setImporting(false)} onDone={() => { setImporting(false); changed(); }} />}
    </div>
  );
}

/* ---- One item: details, prices in force, a dated change, the history ---------------------------------------------- */

function ItemDrawer({ id, list, onClose, onChanged }: { id: string; list: ListPayload; onClose: () => void; onChanged: () => void }) {
  const q = useApi<Detail>(`/operations/service-prices/${id}`);
  const toast = useToast();
  const i = q.data;
  const reload = () => { q.reload(); onChanged(); };
  return (
    <Drawer open onClose={onClose} width={620}>
      <div className="px-5 pt-5 pb-3 flex items-start gap-3 [border-bottom:1px_solid_var(--color-line)]">
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <span className="text-meta text-muted-ink">{i ? `${i.code} · ${DOMAIN_LABEL[i.domain]} · ${SUB_LABEL[i.category] ?? i.category}` : 'Loading'}</span>
          <h2 className="m-0 text-title font-semibold text-pretty">{i?.name ?? ' '}</h2>
          {i && <div className="flex gap-2 flex-wrap">
            <StatusBadge tone={i.active ? 'success' : 'warning'} size="sm" label={i.active ? 'Active' : 'Retired'} />
            {i.cleanKind && <StatusBadge tone="gold" size="sm" label={`Prices reservation ${CLEAN_TYPE_LABEL[i.cleanKind].toLowerCase()}s`} />}
            <span className="text-meta text-muted-ink">{i.jobs} {i.jobs === 1 ? 'job' : 'jobs'} priced from it</span>
          </div>}
        </div>
        <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
      </div>
      {q.error && <div className="px-5 pt-3"><StaleBanner message={q.error} onRetry={q.reload} /></div>}
      {!i ? <div className="p-5"><Skeleton height={220} /></div> : (
        <div className="p-5 flex flex-col gap-6">
          <section className="flex flex-col gap-2">
            <h3 className="m-0 text-copy font-semibold">Prices today</h3>
            <PriceTable layouts={layoutsOf(i, list.layouts)} cells={i.current} />
            {i.next && <span className="text-meta text-gold-ink">A change is scheduled from {dayText(i.next.effectiveFrom)}: see the history below.</span>}
          </section>
          {list.mayPrice
            ? <PriceChange key={`${i.id}:${q.data?.history.length}`} item={i} layouts={layoutsOf(i, list.layouts)} today={i.today} onSaved={() => { toast({ tone: 'success', title: 'Prices saved.' }); reload(); }} />
            : <span className="text-meta text-muted-ink">Only management changes prices.</span>}
          <History item={i} />
          {list.mayEdit && <ItemDetails key={`${i.id}:${i.name}:${i.active}:${i.category}:${i.uom}:${i.cleanKind}:${i.notes}:${i.stockOnHand}:${i.trackStock}`} item={i} list={list} onSaved={reload} />}
        </div>
      )}
    </Drawer>
  );
}

function PriceTable({ layouts, cells }: { layouts: string[]; cells: Record<string, Cell> }) {
  return (
    <div className="grid grid-cols-[minmax(0,1.1fr)_repeat(3,minmax(0,1fr))] gap-x-3 text-copy">
      <span className="text-meta font-semibold text-muted-ink pb-1.5">{layouts.length > 1 ? 'Layout' : ''}</span>
      <span className="text-meta font-semibold text-muted-ink pb-1.5 text-right">Owner price</span>
      <span className="text-meta font-semibold text-muted-ink pb-1.5 text-right">Internal cost</span>
      <span className="text-meta font-semibold text-muted-ink pb-1.5 text-right">Margin</span>
      {layouts.map(l => {
        const c = cells[l] ?? { ownerPrice: null, internalCost: null, effectiveFrom: null };
        const m = margin(c.ownerPrice, c.internalCost);
        return (
          <div key={l} className="contents">
            <span className="py-1.5 [border-top:1px_solid_var(--color-line-soft)]">{LAYOUT_LABEL[l] ?? l}</span>
            <span className="py-1.5 [border-top:1px_solid_var(--color-line-soft)] text-right tabular-nums">{c.ownerPrice != null ? rm(c.ownerPrice) : <span className="text-warning">Not set</span>}</span>
            <span className="py-1.5 [border-top:1px_solid_var(--color-line-soft)] text-right tabular-nums">{c.internalCost != null ? rm(c.internalCost) : <span className="text-warning">Not set</span>}</span>
            <span className={cx('py-1.5 [border-top:1px_solid_var(--color-line-soft)] text-right tabular-nums', m != null && m < 0 ? 'text-danger' : m == null && 'text-muted-ink')}>{marginText(c.ownerPrice, c.internalCost) ?? '–'}</span>
          </div>
        );
      })}
    </div>
  );
}

function PriceChange({ item, layouts, today, onSaved }: { item: Detail; layouts: string[]; today: string; onSaved: () => void }) {
  const toast = useToast();
  const [from, setFrom] = useState(today);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const start = useMemo(() => Object.fromEntries(layouts.map(l => [l, { ownerPrice: item.current[l]?.ownerPrice ?? null, internalCost: item.current[l]?.internalCost ?? null }])), [item, layouts]);
  const [grid, setGrid] = useState<Record<string, { ownerPrice: number | null; internalCost: number | null }>>(start);
  const changed = layouts.filter(l => grid[l].ownerPrice !== start[l].ownerPrice || grid[l].internalCost !== start[l].internalCost);
  const set = (l: string, p: Partial<{ ownerPrice: number | null; internalCost: number | null }>) => setGrid(g => ({ ...g, [l]: { ...g[l], ...p } }));
  async function save() {
    setBusy(true);
    try {
      await api.post(`/operations/service-prices/${item.id}/prices`, { effectiveFrom: from, note: note.trim() || undefined, rows: changed.map(l => ({ layout: l, ...grid[l] })) });
      onSaved();
    } catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(e) }); setBusy(false); }
  }
  return (
    <section className="flex flex-col gap-3 p-4 rounded-card bg-page border border-solid border-line">
      <div className="flex flex-col gap-0.5">
        <h3 className="m-0 text-copy font-semibold">Change prices</h3>
        <span className="text-meta text-muted-ink">The new prices apply to jobs on or after the date. Jobs before it, and every finished job, keep the prices they had.</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-2 items-center text-copy">
        <span className="text-meta font-semibold text-muted-ink">{layouts.length > 1 ? 'Layout' : ''}</span>
        <span className="text-meta font-semibold text-muted-ink">Owner price</span>
        <span className="text-meta font-semibold text-muted-ink">Internal cost</span>
        {layouts.map(l => (
          <div key={l} className="contents">
            <span>{LAYOUT_LABEL[l] ?? l}</span>
            <MoneyInput className={INPUT_CX} valueSen={grid[l].ownerPrice} onChangeSen={v => set(l, { ownerPrice: v })} placeholder="Not set" aria-label={`${LAYOUT_LABEL[l]} owner price`} />
            <MoneyInput className={INPUT_CX} valueSen={grid[l].internalCost} onChangeSen={v => set(l, { internalCost: v })} placeholder="Not set" aria-label={`${LAYOUT_LABEL[l]} internal cost`} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        <DateField label="Applies from" value={from} onChange={setFrom} />
        <LabeledField label="Note (optional)"><input className={INPUT_CX} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. new cleaner rates" maxLength={300} /></LabeledField>
      </div>
      {from < today && <span className="text-meta text-warning">A date in the past also reprices jobs on those days that are not finished yet.</span>}
      <div className="flex gap-2 justify-end">
        {changed.length > 0 && <Button size="sm" variant="secondary" disabled={busy} onClick={() => setGrid(start)}>Discard</Button>}
        <Button size="sm" variant="primary" loading={busy} disabled={!changed.length || !from} disabledReason={!from ? 'Pick the date.' : 'Change a price first.'} onClick={() => void save()}>
          {from > today ? `Schedule from ${dayText(from)}` : 'Save prices'}
        </Button>
      </div>
    </section>
  );
}

function History({ item }: { item: Detail }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-copy font-semibold">Price history</h3>
      {item.history.length === 0 ? <span className="text-meta text-muted-ink">No prices yet.</span> : (
        <ol className="m-0 p-0 list-none flex flex-col">
          {item.history.map(h => (
            <li key={h.effectiveFrom} className="relative pl-5 pb-4 [border-left:2px_solid_var(--color-line)] ml-1.5 last:pb-0">
              <span className={cx('absolute -left-[7px] top-1 w-3 h-3 rounded-full border-2 border-solid border-card', h.status === 'current' ? 'bg-success' : h.status === 'scheduled' ? 'bg-gold' : 'bg-line')} />
              <div className="flex items-center gap-2 flex-wrap">
                <b className="tabular-nums">{h.effectiveFrom <= '2000-01-01' ? 'From the start' : `From ${dayText(h.effectiveFrom)}`}</b>
                <StatusBadge size="sm" tone={h.status === 'current' ? 'success' : h.status === 'scheduled' ? 'gold' : 'neutral'} label={h.status === 'current' ? 'In force' : h.status === 'scheduled' ? 'Scheduled' : 'Replaced'} />
              </div>
              <span className="text-meta text-muted-ink">{[h.setBy ? `Set by ${h.setBy}` : null, h.note].filter(Boolean).join(' · ') || ' '}</span>
              <div className="mt-1 flex flex-col gap-0.5 text-meta">
                {h.rows.map(r => (
                  <span key={r.layout} className="tabular-nums">
                    {r.layout !== 'all' && <span className="text-muted-ink">{LAYOUT_LABEL[r.layout] ?? r.layout}: </span>}
                    Owner {r.ownerPrice != null ? rm(r.ownerPrice) : 'not set'} · Internal {r.internalCost != null ? rm(r.internalCost) : 'not set'}
                    {marginText(r.ownerPrice, r.internalCost) && <span className="text-muted-ink"> · margin {marginText(r.ownerPrice, r.internalCost)}</span>}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ItemDetails({ item, list, onSaved }: { item: Detail; list: ListPayload; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(item.name);
  const [category, setCategory] = useState(item.category);
  const [uom, setUom] = useState(item.uom);
  const [cleanKind, setCleanKind] = useState(item.cleanKind ?? '');
  const [notes, setNotes] = useState(item.notes);
  const [trackStock, setTrackStock] = useState(item.trackStock);
  const [stock, setStock] = useState<number | null>(item.stockOnHand);
  const [busy, setBusy] = useState(false);
  const [confirmDialog, ask] = useConfirm();
  const delta: Record<string, unknown> = {};
  if (name.trim() !== item.name) delta.name = name.trim();
  if (category !== item.category) delta.category = category;
  if (uom !== item.uom) delta.uom = uom;
  if ((cleanKind || null) !== item.cleanKind) delta.cleanKind = cleanKind || null;
  if (notes.trim() !== item.notes) delta.notes = notes.trim();
  const stockDelta: Record<string, unknown> = {};
  if (trackStock !== item.trackStock) stockDelta.trackStock = trackStock;
  if (trackStock && stock !== item.stockOnHand) stockDelta.stockOnHand = stock ?? 0;
  const dirty = Object.keys(delta).length + Object.keys(stockDelta).length > 0;
  async function save(extra?: Record<string, unknown>) {
    setBusy(true);
    try {
      const body = extra ?? delta;
      if (Object.keys(body).length) await api.patch(`/operations/service-prices/${item.id}`, body);
      // The parts stock stays where the maintenance store keeps it (the maintenance catalog endpoint).
      if (!extra && Object.keys(stockDelta).length) await api.patch(`/maintenance/skus/${item.id}`, stockDelta);
      toast({ tone: 'success', title: extra ? (extra.active ? 'Item restored.' : 'Item retired.') : 'Item saved.' });
      onSaved();
    } catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(e) }); }
    finally { setBusy(false); }
  }
  async function retireOrRestore() {
    if (item.active && await ask({
      title: `Retire ${item.name}?`,
      body: 'It can no longer be picked for new jobs. Jobs that already use it keep their price. You can restore it later.',
      confirmLabel: 'Retire', danger: true,
    }) === null) return;
    await save({ active: !item.active });
  }
  return (
    <section className="flex flex-col gap-3">
      {confirmDialog}
      <h3 className="m-0 text-copy font-semibold">Item details</h3>
      <LabeledField label="Name"><input className={INPUT_CX} value={name} onChange={e => setName(e.target.value)} maxLength={120} /></LabeledField>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        <Select size="md" showLabel label="Sub-category" value={category} onChange={setCategory} options={list.categories[item.domain].map(c => ({ value: c, label: SUB_LABEL[c] ?? c }))} />
        <Select size="md" showLabel label="Unit of measure" value={uom} onChange={setUom} options={list.uoms.map(u => ({ value: u, label: UOM_LABEL[u] ?? u }))} />
        {item.domain === 'cleaning' && <Select size="md" showLabel label="Prices this clean type from reservations" value={cleanKind} onChange={setCleanKind}
          options={[{ value: '', label: 'No clean type' }, ...list.cleanTypes.map(k => ({ value: k, label: CLEAN_TYPE_LABEL[k] }))]} />}
      </div>
      {item.domain === 'maintenance' && (
        <div className="flex flex-col gap-2 px-3 py-2.5 rounded-control bg-page border border-solid border-line">
          <label className="flex items-center gap-2.5 cursor-pointer"><input type="checkbox" checked={trackStock} onChange={e => setTrackStock(e.target.checked)} /><span className="text-copy font-medium">Keep this part in stock</span></label>
          {trackStock && <div className="flex items-center gap-2.5"><span className={LABEL_CX}>On hand</span><NumberInput value={stock} onChange={setStock} min={0} aria-label="On hand" className={cx(INPUT_CX, 'w-24')} /></div>}
        </div>
      )}
      <LabeledField label="Notes"><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} maxLength={500}
        className="block w-full box-border px-3 py-2.5 text-ink bg-white border border-solid border-line rounded-control font-sans text-copy resize-y" /></LabeledField>
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void retireOrRestore()}>{item.active ? 'Retire' : 'Restore'}</Button>
        <div className="flex-1" />
        <Button size="sm" variant="primary" loading={busy} disabled={!dirty || !name.trim()} disabledReason={!name.trim() ? 'Enter the name.' : 'Change something first.'} onClick={() => void save()}>Save details</Button>
      </div>
    </section>
  );
}

/* ---- New item -------------------------------------------------------------------------------------------------- */

function NewItemModal({ list, domain, onClose, onSaved }: { list: ListPayload; domain?: Domain; onClose: () => void; onSaved: (id: string) => void }) {
  const [kind, setKind] = useState<Domain>(domain ?? 'cleaning');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState(list.categories[kind][0]);
  const [uom, setUom] = useState('job');
  const [byLayout, setByLayout] = useState(kind === 'cleaning');
  const [cleanKind, setCleanKind] = useState('');
  const [notes, setNotes] = useState('');
  const [from, setFrom] = useState(list.today);
  const layouts = byLayout ? list.layouts : ['all'];
  const [grid, setGrid] = useState<Record<string, { ownerPrice: number | null; internalCost: number | null }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setCategory(list.categories[kind][0]); setByLayout(kind === 'cleaning'); setCleanKind(''); }, [kind, list]);
  const taken = new Set(list.items.filter(i => i.active && i.cleanKind).map(i => i.cleanKind));
  const rows = layouts.map(l => ({ layout: l, ownerPrice: grid[l]?.ownerPrice ?? null, internalCost: grid[l]?.internalCost ?? null })).filter(r => r.ownerPrice != null || r.internalCost != null);
  async function save() {
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ id: string }>('/operations/service-prices', {
        code: code.trim(), name: name.trim(), domain: kind, category, uom, byLayout, cleanKind: kind === 'cleaning' && cleanKind ? cleanKind : null,
        notes: notes.trim() || undefined, ...(list.mayPrice && rows.length ? { prices: { effectiveFrom: from, rows } } : {}),
      });
      onSaved(r.id);
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  }
  return (
    <Modal title="New service item" sub="A cleaning or maintenance service, with what the owner is charged and what it costs us." onClose={onClose} width={640}
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" loading={busy} disabled={!code.trim() || !name.trim()} disabledReason="Add a code and a name first." onClick={() => void save()}>Add item</Button>
      </>}>
      {!domain && <Select size="md" showLabel label="Type" value={kind} onChange={v => setKind(v as Domain)} options={[{ value: 'cleaning', label: 'Cleaning' }, { value: 'maintenance', label: 'Maintenance' }]} />}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        <LabeledField label="Code"><input className={INPUT_CX} value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder={kind === 'cleaning' ? 'CLN-LAUNDRY' : 'AC-SERVICE'} maxLength={40} /></LabeledField>
        <LabeledField label="Name"><input className={INPUT_CX} value={name} onChange={e => setName(e.target.value)} placeholder={kind === 'cleaning' ? 'Laundry, one set' : 'Aircon service'} maxLength={120} /></LabeledField>
        <Select size="md" showLabel label="Sub-category" value={category} onChange={setCategory} options={list.categories[kind].map(c => ({ value: c, label: SUB_LABEL[c] ?? c }))} />
        <Select size="md" showLabel label="Unit of measure" value={uom} onChange={setUom} options={list.uoms.map(u => ({ value: u, label: UOM_LABEL[u] ?? u }))} />
        {kind === 'cleaning' && <Select size="md" showLabel label="Prices this clean type from reservations" value={cleanKind} onChange={setCleanKind}
          options={[{ value: '', label: 'No clean type' }, ...list.cleanTypes.map(k => ({ value: k, label: CLEAN_TYPE_LABEL[k], disabled: taken.has(k), hint: taken.has(k) ? 'Taken' : undefined }))]} />}
      </div>
      <label className="flex items-center gap-2.5 cursor-pointer"><input type="checkbox" checked={byLayout} onChange={e => setByLayout(e.target.checked)} /><span className="text-copy">Priced by unit layout (Studio, 1 bedroom, ... 4+)</span></label>
      {list.mayPrice ? (
        <div className="flex flex-col gap-2 p-3 rounded-control bg-page border border-solid border-line">
          <span className={LABEL_CX}>Prices (optional, can be set later)</span>
          <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-2 items-center text-copy">
            <span className="text-meta text-muted-ink">{byLayout ? 'Layout' : ''}</span><span className="text-meta text-muted-ink">Owner price</span><span className="text-meta text-muted-ink">Internal cost</span>
            {layouts.map(l => (
              <div key={l} className="contents">
                <span>{LAYOUT_LABEL[l]}</span>
                <MoneyInput className={INPUT_CX} valueSen={grid[l]?.ownerPrice ?? null} onChangeSen={v => setGrid(g => ({ ...g, [l]: { ownerPrice: v, internalCost: g[l]?.internalCost ?? null } }))} placeholder="Not set" aria-label={`${LAYOUT_LABEL[l]} owner price`} />
                <MoneyInput className={INPUT_CX} valueSen={grid[l]?.internalCost ?? null} onChangeSen={v => setGrid(g => ({ ...g, [l]: { ownerPrice: g[l]?.ownerPrice ?? null, internalCost: v } }))} placeholder="Not set" aria-label={`${LAYOUT_LABEL[l]} internal cost`} />
              </div>
            ))}
          </div>
          <DateField label="Applies from" value={from} onChange={setFrom} />
        </div>
      ) : <span className="text-meta text-muted-ink">Management sets the prices after the item is added.</span>}
      <LabeledField label="Notes (optional)"><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} maxLength={500}
        className="block w-full box-border px-3 py-2.5 text-ink bg-white border border-solid border-line rounded-control font-sans text-copy resize-y" /></LabeledField>
      {error && <span className="text-meta text-danger" role="alert">{error}</span>}
    </Modal>
  );
}

/* ---- Import from a spreadsheet ------------------------------------------------------------------------------------ */

interface ImportResult { ok: boolean; dryRun?: boolean; effectiveFrom: string; created: number; updated: number; priceChanges: number; unchanged: number; errors: { line: number; message: string }[]; changes: { code: string; action: string; detail: string }[] }

function ImportModal({ domain, mayPrice, today, onClose, onDone }: { domain?: Domain; mayPrice: boolean; today: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<string | null>(null);
  const [rows, setRows] = useState<SheetRow[] | null>(null);
  const [from, setFrom] = useState(today);
  const [plan, setPlan] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function read(f: File) {
    setError(null); setPlan(null); setFile(f.name);
    try {
      let out: SheetRow[];
      if (/\.xlsx$/i.test(f.name)) {
        const book = await readXlsx(await f.arrayBuffer(), []);
        const first = book.names[0];
        out = first ? sheetObjects(book.sheets[first] ?? []) : [];
      } else out = csvObjects(await f.text()).rows;
      if (!out.length) throw new Error('The file has no rows under the header.');
      setRows(out);
    } catch (e) { setRows(null); setError(e instanceof Error ? e.message : 'The file could not be read.'); }
  }
  async function send(dryRun: boolean) {
    if (!rows) return;
    setBusy(true); setError(null);
    try {
      const r = await api.post<ImportResult>('/operations/service-prices/import', { rows, effectiveFrom: from, dryRun });
      if (dryRun || !r.ok) setPlan(r);
      else { toast({ tone: 'success', title: 'Imported.', body: `${r.created} new, ${r.updated} edited, ${r.priceChanges} price ${r.priceChanges === 1 ? 'change' : 'changes'}.` }); onDone(); }
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  useEffect(() => { if (rows) void send(true); }, [rows, from]); // eslint-disable-line react-hooks/exhaustive-deps

  const nothing = plan && plan.ok && !plan.created && !plan.updated && !plan.priceChanges;
  return (
    <Modal title="Import service prices" sub="Download the price sheet, fill it in Excel, then bring it back here. New codes become items; changed prices start on the date below." onClose={onClose} width={640}
      footer={<>
        <Button size="sm" variant="secondary" icon={<Icon name="Download" size="sm" />} onClick={() => { downloadFile('/operations/service-prices/export', { domain }).catch(e => toast({ tone: 'critical', title: 'Not downloaded.', body: errorMessage(e) })); }}>Download the price sheet</Button>
        <div className="flex-1" />
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" loading={busy} disabled={!plan?.ok || !!nothing} disabledReason={!rows ? 'Pick a file first.' : nothing ? 'The file changes nothing.' : 'Fix the rows listed first.'} onClick={() => void send(false)}>Import</Button>
      </>}>
      <LabeledField label="File (.csv or .xlsx)">
        <input type="file" accept=".csv,.xlsx,text/csv" onChange={e => { const f = e.target.files?.[0]; if (f) void read(f); }} className="text-copy" aria-label="Spreadsheet file" />
      </LabeledField>
      <DateField label="Changed prices apply from" value={from} onChange={setFrom} help="Jobs before this date keep the prices they had." />
      {!mayPrice && <span className="text-meta text-muted-ink">You can add and edit items; a file that changes prices needs management.</span>}
      <span className="text-meta text-muted-ink">Blank cells leave things as they are. Margin and Price since are for reading only. One row per layout for an item priced by layout.</span>
      {error && <span className="text-meta text-danger" role="alert">{error}</span>}
      {file && !plan && !error && <Skeleton height={60} />}
      {plan && (
        <div className="flex flex-col gap-2 p-3 rounded-control bg-page border border-solid border-line">
          <b className="text-copy">{plan.errors.length ? `${plan.errors.length} ${plan.errors.length === 1 ? 'row needs' : 'rows need'} fixing. Nothing is saved until the file is clean.` : nothing ? 'Nothing in this file differs from the list.' : `${file}: ready to import.`}</b>
          {!plan.errors.length && <span className="text-meta text-muted-ink">{plan.created} new {plan.created === 1 ? 'item' : 'items'} · {plan.updated} edited · {plan.priceChanges} price {plan.priceChanges === 1 ? 'change' : 'changes'} from {dayText(plan.effectiveFrom)} · {plan.unchanged} unchanged</span>}
          <ul className="m-0 pl-4 flex flex-col gap-0.5 text-meta max-h-[220px] overflow-y-auto">
            {plan.errors.map((e, k) => <li key={`e${k}`} className="text-danger">{e.line ? `Row ${e.line}: ` : ''}{e.message}</li>)}
            {!plan.errors.length && plan.changes.map((c, k) => <li key={`c${k}`}><b>{c.code}</b> · {c.action === 'new' ? 'new item' : c.action === 'edit' ? `edits ${c.detail}` : c.detail}{c.action === 'new' ? `: ${c.detail}` : ''}</li>)}
          </ul>
        </div>
      )}
    </Modal>
  );
}
