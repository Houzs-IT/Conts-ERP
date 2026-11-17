import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { MoneyInput } from '../components/inputs';
import { StaleBanner } from '../components/DataState';
import { EmptyState, Skeleton } from '../components/States';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api, errorMessage } from '../lib/api';
import { useSeedOnce } from '../lib/useSeedOnce';
import { cx } from '../lib/design-tokens';
import { rm, monthLabel, plural, buildingName } from '../lib/format';
import { INPUT, mytDay } from '../components/ops/OpsUi';
import { Segmented } from '../components/Metric';
import { ToolbarSearch } from '../components/ListToolbar';
import { ServicePrices } from './ServicePrices';
import { CleaningPriceTable } from './CleaningPriceTable';
import { PriceChangePanel } from './units/PriceChangePanel';

/* GET /api/housekeeping/prices, /unit-prices and /pay (functions/api/housekeeping). Amounts in sen; null = not set. */
interface PriceRow { kind: string; layout: string; internalCost: number | null; externalCharge: number | null }
interface PriceTable { ready: boolean; kinds: string[]; layouts: string[]; rows: PriceRow[]; mayEdit: boolean }
interface UnitPrice {
  internalCost: number | null; externalCharge: number | null; guestCharge?: number | null; source: 'unit' | 'table' | null;
  override: { internalCost: number | null; externalCharge: number | null; guestCharge?: number | null } | null;
}
interface UnitRow { unitId: string; unitNumber: string; propertyName: string; buildingId: string; layout: string; beds?: string | null; bedCount?: number; prices: Record<string, UnitPrice> }
interface PayRow { cleanerId: string; name: string; unitJobs: number; externalJobs: number; unitPay: number; externalPay: number; unpriced: number; total: number }

const KIND: Record<string, string> = { turnover: 'Basic', deep_clean: 'Deep', light_clean: 'Light' };
const LAYOUT: Record<string, string> = {
  studio: 'Studio', '1_bedroom': '1 bedroom', '2_bedroom': '2 bedroom', '3_bedroom': '3 bedroom', '4_plus_bedroom': '4+ bedroom',
  duplex: 'Duplex', dual_key: 'Dual key', penthouse: 'Penthouse', other: 'Other',
};
/** This month and the ones before it, newest first, YYYY-MM. */
const lastMonths = (n: number) => Array.from({ length: n }, (_, k) => { const d = new Date(`${mytDay(0).slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - k); return d.toISOString().slice(0, 7); });
const money = (v: number | null) => (v == null ? <span className="text-warning">Not set</span> : <span className="tabular-nums">{rm(v)}</span>);

/** Cleaning > Prices: the price table (clean type x unit layout, the cleaner's pay and the charge per clean) and each
 *  unit's own figures where it differs. Management edits; everyone in the office reads. */
export function PricesView({ tabs }: { tabs: ReactNode }) {
  const table = useApi<PriceTable>('/housekeeping/prices');
  const units = useApi<{ ready: boolean; rows: UnitRow[]; mayEdit: boolean; byBed?: boolean; bedPricing?: 'size' | 'count'; guestPrices?: boolean }>('/housekeeping/unit-prices');
  const service = useApi<{ ready: boolean; mayPrice?: boolean }>('/operations/service-prices?domain=cleaning');
  const [isChangingByPercent, setIsChangingByPercent] = useState(false);
  const [priceListVersion, setPriceListVersion] = useState(0);
  const t = table.data;
  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto">
      <PageHeader title="Cleaning" sub="Prices: what each clean is charged to the owner and what it pays the cleaner" actions={tabs} />
      {table.error && <StaleBanner message={table.error} onRetry={table.reload} />}
      {!t || !service.data ? <Skeleton height={240} /> : !t.ready ? (
        <EmptyState icon="Sparkles" title="Cleaning prices are not switched on yet." body="They need a database update (migration 0126). Until then cleaning jobs are charged at the old rates." />
      ) : <>
        {/* By number of beds (chew, 10 Nov 2026), Basic and Deep clean as one table; it shows nothing otherwise. */}
        {service.data.ready && <CleaningPriceTable key={priceListVersion} onSaved={() => { setPriceListVersion(version => version + 1); units.reload(); }} />}
        {/* Service prices (0127) replace the price table; before it, the old table is still the one in use. Priced by
            number of beds, the table above already holds Basic and Deep clean, so the item list stays under Settings only
            (chew, 10 Nov 2026). */}
        {service.data.ready && units.data?.bedPricing === 'count' && (
          <p className="m-0 text-meta text-muted-ink">Light clean and the full list of cleaning items are under <Link to="/system/settings/services" className="text-gold-ink font-medium">Settings, Service prices</Link>.</p>
        )}
        {service.data.ready
          ? units.data && units.data.bedPricing !== 'count' && <ServicePrices key={priceListVersion} domain="cleaning" above={<div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 flex-1 min-w-[220px] text-meta text-muted-ink">Cleaning jobs made from reservations take the item for their clean type, {units.data.byBed ? "priced by the unit's beds (each bed size price times its quantity)" : "at the unit's layout"}. Open an item to change its prices from a date; the whole list is also under Settings, Service prices.</p>
            {service.data.mayPrice && <Button size="sm" variant="secondary" className="max-md:w-full" onClick={() => setIsChangingByPercent(true)}>Schedule price change</Button>}
          </div>} />
          : <PriceTableCard data={t} onSaved={() => { table.reload(); units.reload(); }} />}
        <UnitPricesCard rows={units.data?.rows ?? null} mayEdit={!!units.data?.mayEdit} byBed={!!units.data?.byBed} byCount={units.data?.bedPricing === 'count'}
          guest={!!units.data?.guestPrices} onSaved={() => { units.reload(); setPriceListVersion(version => version + 1); }} />
      </>}
      {isChangingByPercent && <PriceChangePanel kind="cleaning" onClose={() => setIsChangingByPercent(false)}
        onSaved={() => { setIsChangingByPercent(false); setPriceListVersion(version => version + 1); units.reload(); }} />}
    </div>
  );
}

function PriceTableCard({ data, onSaved }: { data: PriceTable; onSaved: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState(data.kinds[0] ?? 'turnover');
  const [draft, setDraft] = useState<Record<string, PriceRow>>({});
  const [busy, setBusy] = useState(false);
  // Cleared after a save, once the saved prices are read back; not on every answer, which wiped prices being typed.
  const reseed = useSeedOnce(data, 'prices', () => setDraft({}));
  const rows = data.rows.filter(r => r.kind === kind).map(r => draft[`${r.kind}:${r.layout}`] ?? r);
  const changed = Object.keys(draft).length > 0;
  const set = (r: PriceRow, p: Partial<PriceRow>) => setDraft(d => ({ ...d, [`${r.kind}:${r.layout}`]: { ...r, ...p } }));
  const notSet = data.rows.filter(r => r.internalCost == null && r.externalCharge == null).length;
  async function save() {
    setBusy(true);
    try { await api.put('/housekeeping/prices', { rows: Object.values(draft) }); toast({ tone: 'success', title: 'Prices saved.', body: 'Cleaning jobs not yet finished use them from now on.' }); reseed(); onSaved(); }
    catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(e, 'Try again in a moment.') }); }
    finally { setBusy(false); }
  }
  return (
    <section className="bg-card rounded-card border border-solid border-line-soft shadow-[var(--shadow-card)] p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <h2 className="m-0 text-heading font-semibold">Price table</h2>
          <p className="m-0 text-meta text-muted-ink">Cleaning jobs made from reservations take their amount from here, by the unit's layout. {notSet ? `${notSet} of ${data.rows.length} prices are not set yet: those cleaning jobs show "Price not set" and are charged at the old rate.` : 'Every price is set.'}</p>
        </div>
        <Segmented<string> label="Clean type" value={kind} onChange={setKind} options={data.kinds.map(k => ({ key: k, label: KIND[k] ?? k }))} />
      </div>
      <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-2 items-center text-copy">
        <span className="text-caption font-bold uppercase tracking-[0.09em] text-muted-ink">Layout</span>
        <span className="text-caption font-bold uppercase tracking-[0.09em] text-muted-ink">Owner price</span>
        <span className="text-caption font-bold uppercase tracking-[0.09em] text-muted-ink">Internal cost</span>
        {rows.map(r => (
          <div key={r.layout} className="contents">
            <span>{LAYOUT[r.layout] ?? r.layout}</span>
            {data.mayEdit ? <>
              <MoneyInput className={INPUT} valueSen={r.externalCharge} onChangeSen={v => set(r, { externalCharge: v })} aria-label={`${LAYOUT[r.layout]} owner price`} placeholder="Not set" />
              <MoneyInput className={INPUT} valueSen={r.internalCost} onChangeSen={v => set(r, { internalCost: v })} aria-label={`${LAYOUT[r.layout]} internal cost`} placeholder="Not set" />
            </> : <>{money(r.externalCharge)}{money(r.internalCost)}</>}
          </div>
        ))}
      </div>
      {data.mayEdit ? (
        <div className="flex gap-2 justify-end">
          {changed && <Button size="sm" variant="secondary" onClick={() => setDraft({})} disabled={busy}>Discard</Button>}
          <Button size="sm" variant="primary" loading={busy} disabled={!changed} disabledReason="Change a price first." onClick={() => void save()}>Save prices</Button>
        </div>
      ) : <span className="text-meta text-muted-ink">Only management changes the price table.</span>}
    </section>
  );
}

/* With the guest's charge (0257) the per-unit list has one more figure column. Literal classes: Tailwind reads them as written. */
const UNIT_COLS = 'md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.6fr)]';
const UNIT_COLS_GUEST = 'md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.6fr)]';

function UnitPricesCard({ rows, mayEdit, byBed, byCount, guest, onSaved }: { rows: UnitRow[] | null; mayEdit: boolean; byBed: boolean; byCount: boolean; guest: boolean; onSaved: () => void }) {
  const cols = guest ? UNIT_COLS_GUEST : UNIT_COLS;
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('turnover');
  const [editing, setEditing] = useState<string | null>(null);
  const shown = useMemo(() => (rows ?? []).filter(r => !q.trim() || `${r.propertyName} ${r.unitNumber}`.toLowerCase().includes(q.trim().toLowerCase())), [rows, q]);
  const own = (rows ?? []).filter(r => Object.values(r.prices).some(p => p.override)).length;
  const withoutBeds = (rows ?? []).filter(r => !r.beds).length;
  return (
    <section className="bg-card rounded-card border border-solid border-line-soft shadow-[var(--shadow-card)] p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <h2 className="m-0 text-heading font-semibold">Per unit</h2>
          <p className="m-0 text-meta text-muted-ink">{byCount
            ? "Each unit's price is the one for its number of beds (King, Queen and Single; floor mattresses and sofa beds do not count)."
            : "Each unit's price is worked out from its beds: each bed size price times how many."} A unit's own figures replace that. {rows ? `${own} of ${rows.length} units have their own.` : ''}</p>
          {!byBed && <p className="m-0 mt-1 text-meta text-warning">{byCount
            ? 'No prices by number of beds yet. Enter them in the list above (Basic clean, Deep clean) and every unit\'s price fills in from its beds.'
            : 'No bed size prices yet. Enter them in the list above (Basic clean, Deep clean) and every unit\'s price fills in from its beds.'}</p>}
          {withoutBeds > 0 && <p className="m-0 mt-1 text-meta text-warning">{plural(withoutBeds, 'unit')} with no beds recorded. Add the beds on the unit's Settings, or they take the "No beds recorded" price.</p>}
        </div>
        <Segmented<string> label="Clean type" value={kind} onChange={setKind} options={Object.entries(KIND).map(([k, l]) => ({ key: k, label: l }))} />
        <ToolbarSearch value={q} onChange={setQ} placeholder="Search unit or building" label="Search units" />
      </div>
      {!rows ? <Skeleton height={120} /> : shown.length === 0 ? <span className="text-muted-ink">No unit matches.</span> : (
        <div className="flex flex-col">
          <div className={cx('hidden md:grid gap-3 text-caption font-bold uppercase tracking-[0.09em] text-muted-ink pb-2', cols)}>
            <span>Unit</span><span>Beds</span><span>Owner price</span>{guest && <span>Guest price</span>}<span>Internal cost</span><span />
          </div>
          {shown.map(r => {
            const p = r.prices[kind];
            return editing === r.unitId
              ? <UnitPriceEdit key={r.unitId} row={r} kind={kind} guest={guest} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onSaved(); }} />
              : (
                <div key={r.unitId} className={cx('grid grid-cols-2 gap-x-3 gap-y-1 py-2 [border-top:1px_solid_var(--color-line-soft)] items-center text-copy', cols)}>
                  <span className="col-span-2 md:col-span-1"><b className="font-mono">{r.unitNumber}</b> <span className="text-muted-ink">{buildingName(r.propertyName)}</span></span>
                  {r.beds
                    ? <span className="flex flex-col min-w-0"><span>{plural(r.bedCount ?? 0, 'bed')}</span><span className="text-meta text-muted-ink [overflow-wrap:anywhere]">{r.beds}</span></span>
                    : <span className="text-warning">No beds recorded</span>}
                  <span className="max-md:order-4"><span className="md:hidden text-muted-ink">Owner price </span>{money(p?.externalCharge ?? null)}{p?.override && <span className="ml-1 text-meta text-gold-ink">own</span>}</span>
                  {guest && <span className="max-md:order-5"><span className="md:hidden text-muted-ink">Guest price </span>{money(p?.guestCharge ?? null)}</span>}
                  <span className="max-md:order-6"><span className="md:hidden text-muted-ink">Internal cost </span>{money(p?.internalCost ?? null)}</span>
                  <span className="text-right">{mayEdit && <button type="button" onClick={() => setEditing(r.unitId)} className="text-gold-ink font-medium cursor-pointer bg-transparent border-0 p-0 [font-family:inherit]">Edit</button>}</span>
                </div>
              );
          })}
        </div>
      )}
    </section>
  );
}

function UnitPriceEdit({ row, kind, guest, onClose, onSaved }: { row: UnitRow; kind: string; guest: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const p = row.prices[kind];
  const [pay, setPay] = useState<number | null>(p?.override?.internalCost ?? null);
  const [charge, setCharge] = useState<number | null>(p?.override?.externalCharge ?? null);
  const [guestCharge, setGuestCharge] = useState<number | null>(p?.override?.guestCharge ?? null);
  const [busy, setBusy] = useState(false);
  async function save(clear = false) {
    setBusy(true);
    try {
      await api.put('/housekeeping/unit-prices', { unitId: row.unitId, kind, internalCost: clear ? null : pay, externalCharge: clear ? null : charge,
        ...(guest ? { guestCharge: clear ? null : guestCharge } : {}) });
      toast({ tone: 'success', title: clear ? `${row.unitNumber} uses the list price again.` : `${row.unitNumber}: own price saved.` });
      onSaved();
    } catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(e, 'Try again in a moment.') }); setBusy(false); }
  }
  return (
    <div className="py-3 [border-top:1px_solid_var(--color-line-soft)] flex flex-col gap-2 bg-page -mx-4 px-4">
      <b><span className="font-mono">{row.unitNumber}</span> <span className="font-normal text-muted-ink">{buildingName(row.propertyName)} · {KIND[kind]} clean</span></b>
      <div className={cx('grid gap-3', guest ? 'grid-cols-[repeat(auto-fit,minmax(140px,1fr))]' : 'grid-cols-2')}>
        <label className="flex flex-col gap-1 text-meta text-muted-ink">Owner price<MoneyInput className={INPUT} valueSen={charge} onChangeSen={setCharge} placeholder={p?.source === 'table' && p.externalCharge != null ? `List ${(p.externalCharge / 100).toFixed(2)}` : 'Not set'} aria-label="Owner price" /></label>
        {guest && <label className="flex flex-col gap-1 text-meta text-muted-ink">Guest price<MoneyInput className={INPUT} valueSen={guestCharge} onChangeSen={setGuestCharge} placeholder={p?.source === 'table' && p.guestCharge != null ? `List ${(p.guestCharge / 100).toFixed(2)}` : 'Not set'} aria-label="Guest price" /></label>}
        <label className="flex flex-col gap-1 text-meta text-muted-ink">Internal cost<MoneyInput className={INPUT} valueSen={pay} onChangeSen={setPay} placeholder={p?.source === 'table' && p.internalCost != null ? `List ${(p.internalCost / 100).toFixed(2)}` : 'Not set'} aria-label="Internal cost" /></label>
      </div>
      <span className="text-meta text-muted-ink">Leave a box empty to use the list price for that figure.</span>
      <div className="flex gap-2 justify-end flex-wrap">
        {p?.override && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void save(true)}>Use the list price</Button>}
        <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>Save</Button>
      </div>
    </div>
  );
}

/** Cleaning > Pay: each cleaner's pay for a month, from the cleans they finished: on our units the cleaner's pay of each
 *  clean, on external jobs the job's amount; a team's clean is split equally. */
export function PayView({ tabs }: { tabs: ReactNode }) {
  const [month, setMonth] = useState(mytDay(0).slice(0, 7));
  const { data, loading, error, reload } = useApi<{ month: string; ready: boolean; rows: PayRow[] }>(`/housekeeping/pay?month=${month}`);
  const rows = data?.rows ?? [];
  const total = rows.reduce((s, r) => s + r.total, 0);
  const unpriced = rows.reduce((s, r) => s + r.unpriced, 0);
  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto">
      <PageHeader title="Cleaning" sub={data?.ready ? `Pay for ${monthLabel(`${month}-01`)} · ${rm(total)} for ${rows.length} ${rows.length === 1 ? 'cleaner' : 'cleaners'}` : 'Cleaner pay'} actions={tabs} />
      <div className="flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-2 text-meta text-muted-ink">Month
          <select className={cx(INPUT, 'h-9 w-auto')} value={month} onChange={e => setMonth(e.target.value)}>
            {lastMonths(12).map(m => <option key={m} value={m}>{monthLabel(`${m}-01`)}</option>)}
          </select>
        </label>
        {unpriced > 0 && <span className="text-meta text-warning">{unpriced} {unpriced === 1 ? 'cleaning job has' : 'cleaning jobs have'} no internal cost set, so the cleaner's pay is not known: set it in Prices.</span>}
      </div>
      {error && <StaleBanner message={error} onRetry={reload} />}
      {loading && !data ? <Skeleton height={160} /> : data && !data.ready ? (
        <EmptyState icon="Sparkles" title="Cleaner pay is not switched on yet." body="It needs a database update (migration 0126)." />
      ) : rows.length === 0 ? <EmptyState icon="Sparkles" title={`No finished cleaning jobs in ${monthLabel(`${month}-01`)}.`} /> : (
        <section className="bg-card rounded-card border border-solid border-line-soft shadow-[var(--shadow-card)] p-4 flex flex-col">
          <div className="hidden md:grid grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))] gap-3 text-caption font-bold uppercase tracking-[0.09em] text-muted-ink pb-2">
            <span>Cleaner</span><span>Our units</span><span>External jobs</span><span>Not priced</span><span className="text-right" title="What each cleaner is paid: the internal cost of the cleaning jobs they finished.">Pay (internal cost)</span>
          </div>
          {rows.map(r => (
            <div key={r.cleanerId} className="grid grid-cols-2 md:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))] gap-x-3 gap-y-1 py-2.5 [border-top:1px_solid_var(--color-line-soft)] text-copy items-baseline">
              <b className="max-md:order-1">{r.name}</b>
              <span className="max-md:order-3"><span className="md:hidden text-muted-ink">Units </span>{r.unitJobs} · {rm(r.unitPay)}</span>
              <span className="max-md:order-4"><span className="md:hidden text-muted-ink">External </span>{r.externalJobs} · {rm(r.externalPay)}</span>
              <span className={cx('max-md:order-5', r.unpriced ? 'text-warning' : 'text-muted-ink')}><span className="md:hidden">Not priced </span>{r.unpriced}</span>
              <b className="max-md:order-2 text-right tabular-nums">{rm(r.total)}</b>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
