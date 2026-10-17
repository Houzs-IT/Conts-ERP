import { useEffect, useMemo, useState, type ReactNode } from 'react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { MoneyInput } from '../components/inputs';
import { StaleBanner } from '../components/DataState';
import { EmptyState, Skeleton } from '../components/States';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api, errorMessage } from '../lib/api';
import { cx } from '../lib/design-tokens';
import { rm, monthLabel } from '../lib/format';
import { INPUT, mytDay } from '../components/ops/OpsUi';

/* GET /api/housekeeping/prices, /unit-prices and /pay (functions/api/housekeeping). Amounts in sen; null = not set. */
interface PriceRow { kind: string; layout: string; internalCost: number | null; externalCharge: number | null }
interface PriceTable { ready: boolean; kinds: string[]; layouts: string[]; rows: PriceRow[]; mayEdit: boolean }
interface UnitPrice { internalCost: number | null; externalCharge: number | null; source: 'unit' | 'table' | null; override: { internalCost: number | null; externalCharge: number | null } | null }
interface UnitRow { unitId: string; unitNumber: string; propertyName: string; buildingId: string; layout: string; prices: Record<string, UnitPrice> }
interface PayRow { cleanerId: string; name: string; unitJobs: number; externalJobs: number; unitPay: number; externalPay: number; unpriced: number; total: number }

const KIND: Record<string, string> = { turnover: 'Standard', deep_clean: 'Deep', light_clean: 'Light' };
const LAYOUT: Record<string, string> = {
  studio: 'Studio', '1_bedroom': '1 bedroom', '2_bedroom': '2 bedroom', '3_bedroom': '3 bedroom', '4_plus_bedroom': '4+ bedroom',
  duplex: 'Duplex', dual_key: 'Dual key', penthouse: 'Penthouse', other: 'Other',
};
const money = (v: number | null) => (v == null ? <span className="text-warning">Not set</span> : <span className="tabular-nums">{rm(v)}</span>);

/** Cleaning > Prices: the price table (clean type x unit layout, the cleaner's pay and the charge per clean) and each
 *  unit's own figures where it differs. Management edits; everyone in the office reads. */
export function PricesView({ tabs }: { tabs: ReactNode }) {
  const table = useApi<PriceTable>('/housekeeping/prices');
  const units = useApi<{ ready: boolean; rows: UnitRow[]; mayEdit: boolean }>('/housekeeping/unit-prices');
  const t = table.data;
  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto">
      <PageHeader title="Cleaning" sub="Prices: what each clean pays the cleaner and what it is charged" actions={tabs} />
      {table.error && <StaleBanner message={table.error} onRetry={table.reload} />}
      {!t ? <Skeleton height={240} /> : !t.ready ? (
        <EmptyState icon="Sparkles" title="Cleaning prices are not switched on yet." body="They need a database update (migration 0126). Until then cleans are charged at the old rates." />
      ) : <>
        <PriceTableCard data={t} onSaved={() => { table.reload(); units.reload(); }} />
        <UnitPricesCard rows={units.data?.rows ?? null} mayEdit={!!units.data?.mayEdit} onSaved={units.reload} />
      </>}
    </div>
  );
}

function PriceTableCard({ data, onSaved }: { data: PriceTable; onSaved: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState(data.kinds[0] ?? 'turnover');
  const [draft, setDraft] = useState<Record<string, PriceRow>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft({}); }, [data]);
  const rows = data.rows.filter(r => r.kind === kind).map(r => draft[`${r.kind}:${r.layout}`] ?? r);
  const changed = Object.keys(draft).length > 0;
  const set = (r: PriceRow, p: Partial<PriceRow>) => setDraft(d => ({ ...d, [`${r.kind}:${r.layout}`]: { ...r, ...p } }));
  const notSet = data.rows.filter(r => r.internalCost == null && r.externalCharge == null).length;
  async function save() {
    setBusy(true);
    try { await api.put('/housekeeping/prices', { rows: Object.values(draft) }); toast({ tone: 'success', title: 'Prices saved.', body: 'Cleans not yet finished use them from now on.' }); onSaved(); }
    catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(e, 'Try again in a moment.') }); }
    finally { setBusy(false); }
  }
  return (
    <section className="bg-card rounded-card border border-solid border-line p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <h2 className="m-0 text-heading font-semibold">Price table</h2>
          <p className="m-0 text-meta text-muted-ink">Cleans made from reservations take their amount from here, by the unit's layout. {notSet ? `${notSet} of ${data.rows.length} prices are not set yet: those cleans show "Price not set" and are charged at the old rate.` : 'Every price is set.'}</p>
        </div>
        <div role="tablist" className="flex gap-1">
          {data.kinds.map(k => (
            <button key={k} type="button" role="tab" aria-selected={k === kind} onClick={() => setKind(k)}
              className={cx('h-9 px-3 rounded-control border border-solid text-copy cursor-pointer', k === kind ? 'bg-black text-white border-black' : 'bg-card text-ink border-line')}>{KIND[k] ?? k}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-2 items-center text-copy">
        <span className="text-meta font-semibold text-muted-ink">Layout</span>
        <span className="text-meta font-semibold text-muted-ink">Cleaner's pay (internal)</span>
        <span className="text-meta font-semibold text-muted-ink">Charge per clean (external)</span>
        {rows.map(r => (
          <div key={r.layout} className="contents">
            <span>{LAYOUT[r.layout] ?? r.layout}</span>
            {data.mayEdit ? <>
              <MoneyInput className={INPUT} valueSen={r.internalCost} onChangeSen={v => set(r, { internalCost: v })} aria-label={`${LAYOUT[r.layout]} cleaner's pay`} placeholder="Not set" />
              <MoneyInput className={INPUT} valueSen={r.externalCharge} onChangeSen={v => set(r, { externalCharge: v })} aria-label={`${LAYOUT[r.layout]} charge per clean`} placeholder="Not set" />
            </> : <>{money(r.internalCost)}{money(r.externalCharge)}</>}
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

function UnitPricesCard({ rows, mayEdit, onSaved }: { rows: UnitRow[] | null; mayEdit: boolean; onSaved: () => void }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('turnover');
  const [editing, setEditing] = useState<string | null>(null);
  const shown = useMemo(() => (rows ?? []).filter(r => !q.trim() || `${r.propertyName} ${r.unitNumber}`.toLowerCase().includes(q.trim().toLowerCase())), [rows, q]);
  const own = (rows ?? []).filter(r => Object.values(r.prices).some(p => p.override)).length;
  return (
    <section className="bg-card rounded-card border border-solid border-line p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <h2 className="m-0 text-heading font-semibold">Per unit</h2>
          <p className="m-0 text-meta text-muted-ink">A unit's own figures replace the price table for that unit. {rows ? `${own} of ${rows.length} units have their own.` : ''}</p>
        </div>
        <select className={cx(INPUT, 'h-9 w-auto')} value={kind} onChange={e => setKind(e.target.value)} aria-label="Clean type">
          {Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input className={cx(INPUT, 'h-9 w-[220px] max-md:w-full')} value={q} onChange={e => setQ(e.target.value)} placeholder="Search unit or building" aria-label="Search units" />
      </div>
      {!rows ? <Skeleton height={120} /> : shown.length === 0 ? <span className="text-muted-ink">No unit matches.</span> : (
        <div className="flex flex-col">
          <div className="hidden md:grid grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.6fr)] gap-3 text-meta font-semibold text-muted-ink pb-2">
            <span>Unit</span><span>Layout</span><span>Cleaner's pay</span><span>Charge per clean</span><span />
          </div>
          {shown.map(r => {
            const p = r.prices[kind];
            return editing === r.unitId
              ? <UnitPriceEdit key={r.unitId} row={r} kind={kind} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onSaved(); }} />
              : (
                <div key={r.unitId} className="grid grid-cols-2 md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.6fr)] gap-x-3 gap-y-1 py-2 [border-top:1px_solid_var(--color-line-soft)] items-center text-copy">
                  <span className="col-span-2 md:col-span-1"><b>{r.unitNumber}</b> <span className="text-muted-ink">{r.propertyName}</span></span>
                  <span className="text-muted-ink">{LAYOUT[r.layout] ?? r.layout}</span>
                  <span className="max-md:order-4"><span className="md:hidden text-muted-ink">Pay </span>{money(p?.internalCost ?? null)}</span>
                  <span className="max-md:order-5"><span className="md:hidden text-muted-ink">Charge </span>{money(p?.externalCharge ?? null)}{p?.override && <span className="ml-1 text-meta text-gold-ink">own</span>}</span>
                  <span className="text-right">{mayEdit && <button type="button" onClick={() => setEditing(r.unitId)} className="text-gold-ink font-medium cursor-pointer bg-transparent border-0 p-0 [font-family:inherit]">Edit</button>}</span>
                </div>
              );
          })}
        </div>
      )}
    </section>
  );
}

function UnitPriceEdit({ row, kind, onClose, onSaved }: { row: UnitRow; kind: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const p = row.prices[kind];
  const [pay, setPay] = useState<number | null>(p?.override?.internalCost ?? null);
  const [charge, setCharge] = useState<number | null>(p?.override?.externalCharge ?? null);
  const [busy, setBusy] = useState(false);
  async function save(clear = false) {
    setBusy(true);
    try {
      await api.put('/housekeeping/unit-prices', { unitId: row.unitId, kind, internalCost: clear ? null : pay, externalCharge: clear ? null : charge });
      toast({ tone: 'success', title: clear ? `${row.unitNumber} uses the price table again.` : `${row.unitNumber}: own price saved.` });
      onSaved();
    } catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(e, 'Try again in a moment.') }); setBusy(false); }
  }
  return (
    <div className="py-3 [border-top:1px_solid_var(--color-line-soft)] flex flex-col gap-2 bg-page -mx-4 px-4">
      <b>{row.unitNumber} <span className="font-normal text-muted-ink">{row.propertyName} · {KIND[kind]} clean</span></b>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-meta text-muted-ink">Cleaner's pay<MoneyInput className={INPUT} valueSen={pay} onChangeSen={setPay} placeholder={p?.source === 'table' && p.internalCost != null ? `Table ${(p.internalCost / 100).toFixed(2)}` : 'Not set'} aria-label="Cleaner's pay" /></label>
        <label className="flex flex-col gap-1 text-meta text-muted-ink">Charge per clean<MoneyInput className={INPUT} valueSen={charge} onChangeSen={setCharge} placeholder={p?.source === 'table' && p.externalCharge != null ? `Table ${(p.externalCharge / 100).toFixed(2)}` : 'Not set'} aria-label="Charge per clean" /></label>
      </div>
      <span className="text-meta text-muted-ink">Leave a box empty to use the price table for that figure.</span>
      <div className="flex gap-2 justify-end flex-wrap">
        {p?.override && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void save(true)}>Use the price table</Button>}
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
          <input type="month" className={cx(INPUT, 'h-9 w-auto')} value={month} max={mytDay(0).slice(0, 7)} onChange={e => e.target.value && setMonth(e.target.value)} />
        </label>
        {unpriced > 0 && <span className="text-meta text-warning">{unpriced} {unpriced === 1 ? 'clean has' : 'cleans have'} no cleaner's pay set: set it in Prices.</span>}
      </div>
      {error && <StaleBanner message={error} onRetry={reload} />}
      {loading && !data ? <Skeleton height={160} /> : data && !data.ready ? (
        <EmptyState icon="Sparkles" title="Cleaner pay is not switched on yet." body="It needs a database update (migration 0126)." />
      ) : rows.length === 0 ? <EmptyState icon="Sparkles" title={`No finished cleans in ${monthLabel(`${month}-01`)}.`} /> : (
        <section className="bg-card rounded-card border border-solid border-line p-4 flex flex-col">
          <div className="hidden md:grid grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))] gap-3 text-meta font-semibold text-muted-ink pb-2">
            <span>Cleaner</span><span>Our units</span><span>External jobs</span><span>Not priced</span><span className="text-right">Pay</span>
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
