import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import Icon from '../../components/Icon';
import PageHeader from '../../components/PageHeader';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { StaleBanner, TableSkeleton } from '../../components/DataState';
import { EmptyState } from '../../components/States';
import { LockBars } from '../../components/LockBar';
import { Modal } from '../../components/Modal';
import { MoneyInput } from '../../components/inputs';
import { DataTable, type Column } from '../../components/DataTable';
import { Segmented as Tabs } from '../../components/ops/OpsUi';
import { useApi } from '../../lib/useApi';
import { downloadFile, notifyFailure } from '../../lib/api';
import { monthLabel, rm, todayMyt, buildingName, personName } from '../../lib/format';
import { downloadTable, type ExportCell, type ExportColumn } from '../../lib/export';
import { statusOf, statusLabel, TONE_STYLE } from '../../lib/status';
import { cx } from '../../lib/design-tokens';
import { PAYER_LABEL } from '../../lib/revenueModel';
import { useUrlState, shiftMonth } from './listKit';
import { ListToolbar } from '../../components/ListToolbar';
import {
  KINDS, KIND_LABEL, billState, buildCells, buildRequestCells, months as monthsOf, requestState, sentBack, unitAverages, unusual,
  type Cell, type GridBill, type SentBackRequest, type UtilityKind, type UnusualRow,
} from '../../lib/utilityGrid';
import { api, errorMessage } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { billEdit, partNow } from '../../lib/utilityBillEdit';
import { OwnerPaidTick } from '../owners/ExpenseEntry';
import { UnitPicker } from '../../components/UnitPicker';
import { useUnitRoster } from '../../lib/useUnitRoster';

const UtilitiesModal = lazy(() => import('../owners/ExpenseEntry').then(m => ({ default: m.UtilitiesModal })));
const AddUtilityBill = lazy(() => import('../../components/AddUtilityBill').then(m => ({ default: m.AddUtilityBill })));
const ScanBills = lazy(() => import('./ScanBills'));

/** Finance > Utility bills (plan docs/superpowers/plans/2026-10-28-utility-listing.md): every unit's electricity, water,
 *  internet and Indah Water bills month by month, newest month first, coloured by whether the owner has been charged;
 *  one unit on its own; the bills that moved more than half against the unit's previous three months. The month's
 *  entry screen opens from "Enter this month's bills". "By payment request" (chew, 5 Nov 2026; SOP 3.10) places each
 *  bill in the month its payment request was made instead, coloured by the request; both views filter by the unit's
 *  purpose (rental, showroom, warehouse). */
interface Unit { id: string; buildingId: string; building: string; number: string; owner: string | null; purpose?: string }
interface Listing { months: string[]; units: Unit[]; bills: GridBill[]; nights: Record<string, Record<string, number>> }
type View = 'all' | 'requests' | 'unusual';
type Mode = 'bill' | 'request';
const RANGES = [6, 12, 24];
const PURPOSES = [{ value: 'rental', label: 'Rental' }, { value: 'showroom', label: 'Showroom' }, { value: 'warehouse', label: 'Warehouse' }];
const ENTITY = { bill: 'utility_bill', request: 'utility_request' } as const;

const unitName = (u: Unit) => `${buildingName(u.building)} ${u.number}`;
const cellStyle = (c: Cell | undefined, mode: Mode = 'bill') => {
  if (!c?.state) return undefined;
  const tone = statusOf(ENTITY[mode], c.state).tone;
  return tone === 'neutral' ? undefined : { background: TONE_STYLE[tone].bg, color: TONE_STYLE[tone].fg };
};
const amountText = (sen: number | null | undefined) => (sen == null ? '–' : rm(sen).replace(/^RM /, ''));

export default function UtilityListing() {
  const url = useUrlState();
  const view: View = url.get('view') === 'unusual' ? 'unusual' : url.get('view') === 'requests' ? 'requests' : 'all';
  const mode: Mode = view === 'requests' ? 'request' : 'bill';
  const range = RANGES.includes(Number(url.get('range'))) ? Number(url.get('range')) : 12;
  const building = url.get('building'), q = url.get('q').trim().toLowerCase(), unitId = url.get('unit');
  const purpose = PURPOSES.some(p => p.value === url.get('purpose')) ? url.get('purpose') : '';
  const kind = (KINDS as string[]).includes(url.get('kind')) ? url.get('kind') as UtilityKind : null;
  const to = todayMyt().slice(0, 7), from = shiftMonth(to, -(range - 1));
  const { data, loading, error, reload } = useApi<Listing>(`/expenses/utility-listing?from=${from}&to=${to}${mode === 'request' ? '&by=request' : ''}`);
  const [entry, setEntry] = useState<null | 'month' | 'one'>(null);
  const [scanning, setScanning] = useState(false);
  const [open, setOpen] = useState<{ unit: Unit; month: string; kind: UtilityKind | 'total'; cell: Cell } | null>(null);

  const cells = useMemo(() => (mode === 'request' ? buildRequestCells : buildCells)(data?.bills ?? []), [data, mode]);
  const monthList = data?.months ?? monthsOf(from, to);
  const buildings = useMemo(() => [...new Map((data?.units ?? []).map(u => [u.buildingId, buildingName(u.building)])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'en', { numeric: true })).map(([value, label]) => ({ value, label })), [data]);
  // By payment request lists only the units with a request in the months shown.
  const units = useMemo(() => (data?.units ?? []).filter(u => (!building || u.buildingId === building)
    && (!purpose || (u.purpose ?? 'rental') === purpose)
    && (!q || unitName(u).toLowerCase().includes(q) || (u.owner ?? '').toLowerCase().includes(q))
    && (mode === 'bill' || monthList.some(m => cells.has(`${u.id}|total|${m}`)))), [data, building, purpose, q, mode, monthList, cells]);
  const focus = unitId ? data?.units.find(u => u.id === unitId) ?? null : null;
  const shownKinds: UtilityKind[] = kind ? [kind] : KINDS;

  const header = (
    <PageHeader title="Utility bills" sub="Every unit's electricity, water, internet and Indah Water bills, month by month."
      actions={<>
        <Button size="sm" variant="secondary" icon={<Icon name="FileText" size="sm" />} onClick={() => setScanning(true)}>Scan bills</Button>
        <Button size="sm" variant="secondary" onClick={() => setEntry('one')}>Add utility bill</Button>
      </>}
      primary={<Button size="sm" variant="primary" icon={<Icon name="Zap" size="sm" />} onClick={() => setEntry('month')}>Enter this month's bills</Button>} />
  );
  const modals = (
    <>
      {entry && (
        <Suspense fallback={null}>
          {entry === 'month'
            ? <UtilitiesModal month={to} onClose={() => setEntry(null)} onSaved={reload} />
            : <AddUtilityBill month={to} onClose={() => setEntry(null)} onSaved={reload} />}
        </Suspense>
      )}
      {open && <BillPanel {...open} mode={mode} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); reload(); }} />}
    </>
  );
  const filters = (
    <ListToolbar
      search={{ value: url.get('q'), onChange: v => url.set({ q: v.trim() }), placeholder: 'Unit or owner', label: 'Search units' }}
      filters={[
        { key: 'building', label: 'Building', value: building, onChange: v => url.set({ building: v }), allLabel: 'All buildings',
          options: buildings.map(b => ({ ...b, count: (data?.units ?? []).filter(u => u.buildingId === b.value).length })) },
        { key: 'purpose', label: 'Purpose', value: purpose, onChange: v => url.set({ purpose: v }), allLabel: 'All purposes',
          options: PURPOSES.map(p => ({ ...p, count: (data?.units ?? []).filter(u => (u.purpose ?? 'rental') === p.value).length })) },
        { key: 'kind', label: 'Bill', value: kind ?? '', onChange: v => url.set({ kind: v }), allLabel: 'All bills', options: KINDS.map(k => ({ value: k, label: KIND_LABEL[k] })) },
      ]}
      date={{ label: 'Months', value: String(range), def: '12', onChange: v => url.set({ range: v === '12' ? null : v }), presets: RANGES.map(r => ({ value: String(r), label: `Last ${r} months` })) }}
      count={data ? <span className="tabular-nums">Showing {units.length} of {data.units.length} units</span> : undefined}
    />
  );

  if (scanning) return <Suspense fallback={<TableSkeleton rows={4} cols={8} />}><ScanBills onBack={() => setScanning(false)} onRecorded={reload} /></Suspense>;
  if (focus) return (
    <>
      {header}
      <OneUnit unit={focus} months={monthList} cells={cells} nights={data?.nights[focus.id] ?? {}} mode={mode}
        onBack={() => url.set({ unit: null })} onOpen={(month, k, cell) => setOpen({ unit: focus, month, kind: k, cell })} />
      {modals}
    </>
  );

  return (
    <>
      {header}
      <div className="flex flex-col gap-3">
        <Tabs<View> label="By bill month, by payment request or unusual bills" value={view} onChange={v => url.set({ view: v === 'all' ? null : v })} className="self-start"
          options={[{ value: 'all', label: 'By bill month' }, { value: 'requests', label: 'By payment request' }, { value: 'unusual', label: 'Unusual' }]} />
        {filters}
        {/* The Utilities lock (Unit report locks): this listing shows many months, so the bar keeps its own month,
            last month to begin with. */}
        <LockBars stages={['utilities']} onChange={reload} />
        {error && <StaleBanner message={data ? `Showing the last figures we have. ${error}` : error} onRetry={reload} />}
        {mode === 'request' && <SentBack requests={sentBack(data?.bills ?? [])} units={data?.units ?? []} onSent={reload} />}
        {view !== 'unusual'
          ? <AllBills units={units} months={monthList} kinds={shownKinds} cells={cells} nights={data?.nights ?? {}} loading={loading && !data} mode={mode}
              filtered={!!(building || q || purpose)} onUnit={u => url.set({ unit: u.id })} onOpen={(unit, month, k, cell) => setOpen({ unit, month, kind: k, cell })} />
          : <Unusual units={units} months={monthList} cells={cells} nights={data?.nights ?? {}} loading={loading && !data} error={data ? null : error}
              onRetry={reload} kind={kind} onUnit={u => url.set({ unit: u.id })} />}
      </div>
      {modals}
    </>
  );
}

function Legend({ mode = 'bill' }: { mode?: Mode }) {
  const states: string[] = mode === 'request' ? ['waiting', 'part_paid', 'paid'] : ['charged', 'pending', 'record', 'company'];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-muted-ink" aria-label="Colour key">
      {states.map(s => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3.5 h-3.5 rounded-[3px] border border-solid border-line"
            style={cellStyle({ amount: 0, state: s as Cell['state'], bills: [] }, mode)} />{statusLabel(ENTITY[mode], s)}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5"><span className="font-semibold">–</span> {mode === 'request' ? 'No request' : 'No bill'}</span>
    </div>
  );
}

const TH = 'px-2 py-1.5 text-meta font-semibold text-muted-ink bg-muted [border-bottom:1px_solid_var(--color-line)] whitespace-nowrap';
const TD = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap [border-bottom:1px_solid_var(--color-line)]';
const STICKY = 'sticky left-0 z-[1] bg-card text-left [border-right:1px_solid_var(--color-line)]';

function AllBills({ units, months, kinds, cells, nights, loading, filtered, mode, onUnit, onOpen }: {
  units: Unit[]; months: string[]; kinds: UtilityKind[]; cells: Map<string, Cell>; nights: Record<string, Record<string, number>>;
  loading: boolean; filtered: boolean; mode: Mode; onUnit: (u: Unit) => void; onOpen: (u: Unit, month: string, k: UtilityKind | 'total', c: Cell) => void;
}) {
  const cols: (UtilityKind | 'total')[] = kinds.length > 1 ? [...kinds, 'total'] : kinds;
  const label = (k: UtilityKind | 'total') => (k === 'total' ? 'Total' : KIND_LABEL[k]);
  const byBill = mode === 'bill';
  const stateText = (c: Cell | undefined) => (c?.state ? statusLabel(ENTITY[mode], c.state) : '');
  function exportExcel() {
    const head: ExportColumn[] = [{ label: 'Unit', kind: 'text' }, { label: 'Owner', kind: 'text' },
      ...months.flatMap(m => cols.flatMap(k => [{ label: `${monthLabel(m)} ${label(k)} (RM)`, kind: 'money' as const }, ...(k === 'total' ? [] : [{ label: `${monthLabel(m)} ${label(k)} state`, kind: 'text' as const }])])),
      ...(byBill ? [{ label: 'Average per month (RM)', kind: 'money' as const }, { label: 'Average per night (RM)', kind: 'money' as const }] : [])];
    const rows: ExportCell[][] = units.map(u => {
      const avg = unitAverages(cells, u.id, months, nights[u.id] ?? {});
      return [unitName(u), u.owner ?? '', ...months.flatMap(m => cols.flatMap(k => {
        const c = cells.get(`${u.id}|${k}|${m}`);
        return [c ? c.amount / 100 : null, ...(k === 'total' ? [] : [stateText(c)])];
      })), ...(byBill ? [avg.perMonth == null ? null : avg.perMonth / 100, avg.perNight == null ? null : avg.perNight / 100] : [])];
    });
    downloadTable('xlsx', byBill ? 'utility-bills' : 'utility-bills-by-payment-request', byBill ? 'Utility bills' : 'Utility bills by payment request', head, rows);
  }
  if (loading) return <TableSkeleton rows={8} cols={8} />;
  if (!units.length) {
    if (!byBill && !filtered) return <EmptyState kind="empty" title="No payment requests in these months."
      body="A bill goes out for payment when it is recorded on Scan bills, or entered by hand without “Owner paid this bill”." />;
    return <EmptyState kind={filtered ? 'filtered' : 'empty'} title={filtered ? 'No units match.' : 'No units yet.'} />;
  }
  const totals = (m: string, k: UtilityKind | 'total') => units.reduce((n, u) => n + (cells.get(`${u.id}|${k}|${m}`)?.amount ?? 0), 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Legend mode={mode} />
        <Button size="sm" variant="secondary" icon={<Icon name="Download" size="sm" />} onClick={exportExcel}>Export</Button>
      </div>
      <div className="overflow-auto max-h-[calc(100vh-260px)] border border-solid border-line rounded-card bg-card">
        <table className="border-separate border-spacing-0 text-copy min-w-full">
          <thead className="sticky top-0 z-[2]">
            <tr>
              <th rowSpan={2} className={cx(TH, STICKY, 'z-[3] bg-muted min-w-[180px]')}>Unit</th>
              {months.map(m => <th key={m} colSpan={cols.length} className={cx(TH, 'text-center [border-left:1px_solid_var(--color-line)]')}>{monthLabel(m)}</th>)}
              {byBill && <th colSpan={2} className={cx(TH, 'text-center [border-left:1px_solid_var(--color-line)]')}>Average</th>}
            </tr>
            <tr>
              {months.map(m => cols.map((k, i) => (
                <th key={`${m}${k}`} className={cx(TH, 'text-right font-normal', i === 0 && '[border-left:1px_solid_var(--color-line)]', k === 'total' && 'font-semibold')}>{label(k)}</th>
              )))}
              {byBill && <th className={cx(TH, 'text-right font-normal [border-left:1px_solid_var(--color-line)]')}>Per month</th>}
              {byBill && <th className={cx(TH, 'text-right font-normal')}>Per night</th>}
            </tr>
          </thead>
          <tbody>
            {units.map(u => {
              const avg = unitAverages(cells, u.id, months, nights[u.id] ?? {});
              return (
                <tr key={u.id}>
                  <th scope="row" className={cx(TD, STICKY, 'font-normal')}>
                    <button type="button" onClick={() => onUnit(u)} className="text-left bg-transparent border-0 p-0 cursor-pointer text-ink hover:underline">
                      <span className="block font-semibold">{unitName(u)}</span>
                      {u.owner && <span className="block text-meta text-muted-ink truncate max-w-[200px]">{personName(u.owner)}</span>}
                    </button>
                  </th>
                  {months.map(m => cols.map((k, i) => {
                    const c = cells.get(`${u.id}|${k}|${m}`);
                    const state = stateText(c);
                    return (
                      <td key={`${m}${k}`} style={cellStyle(c, mode)} title={c ? `${label(k)} ${monthLabel(m)}: ${rm(c.amount)}${state ? ` · ${state}` : ''}` : undefined}
                        className={cx(TD, i === 0 && '[border-left:1px_solid_var(--color-line)]', k === 'total' && 'font-semibold', c && 'cursor-pointer')}
                        onClick={c ? () => onOpen(u, m, k, c) : undefined}>
                        {c ? amountText(c.amount) : <span className="text-muted-ink">–</span>}
                      </td>
                    );
                  }))}
                  {byBill && <td className={cx(TD, '[border-left:1px_solid_var(--color-line)]')}>{amountText(avg.perMonth)}</td>}
                  {byBill && <td className={TD}>{amountText(avg.perNight)}</td>}
                </tr>
              );
            })}
            {!byBill && (
              <tr>
                <th scope="row" className={cx(TD, STICKY, 'font-semibold')}>Total</th>
                {months.map(m => cols.map((k, i) => (
                  <td key={`${m}${k}`} className={cx(TD, 'font-semibold', i === 0 && '[border-left:1px_solid_var(--color-line)]')}>{amountText(totals(m, k) || null)}</td>
                )))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="m-0 text-meta text-muted-ink">{byBill
        ? 'Amounts in RM. A bill sits in the month it is for; its colour follows the owner statement that deducts it. Average per night leaves out months with no nights booked.'
        : 'Amounts in RM, as asked for on the payment request (a bill split at the contract start goes at its whole bill). A bill sits in the month its payment request was made; its colour follows that request. Bills with no payment request are not shown here.'}</p>
    </div>
  );
}

function OneUnit({ unit, months, cells, nights, mode = 'bill', onBack, onOpen }: {
  unit: Unit; months: string[]; cells: Map<string, Cell>; nights: Record<string, number>; mode?: Mode;
  onBack: () => void; onOpen: (month: string, k: UtilityKind | 'total', c: Cell) => void;
}) {
  const avg = unitAverages(cells, unit.id, months, nights);
  const rows: (UtilityKind | 'total')[] = [...KINDS, 'total'];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" icon={<Icon name="ArrowLeft" size="sm" />} onClick={onBack}>All units</Button>
        <div>
          <div className="text-title font-semibold">{unitName(unit)}</div>
          {unit.owner && <div className="text-meta text-muted-ink">{personName(unit.owner)}</div>}
        </div>
        <div className="ml-auto flex gap-4 text-meta text-muted-ink">
          <span>Average per month <b className="text-ink tabular-nums">{avg.perMonth == null ? '–' : rm(avg.perMonth)}</b></span>
          <span>Average per night <b className="text-ink tabular-nums">{avg.perNight == null ? '–' : rm(avg.perNight)}</b></span>
        </div>
      </div>
      <Legend mode={mode} />
      <div className="overflow-auto border border-solid border-line rounded-card bg-card">
        <table className="border-separate border-spacing-0 text-copy min-w-full">
          <thead>
            <tr>
              <th className={cx(TH, STICKY, 'bg-muted z-[2] min-w-[120px]')}>Bill</th>
              {months.map(m => <th key={m} className={cx(TH, 'text-right')}>{monthLabel(m)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(k => (
              <tr key={k}>
                <th scope="row" className={cx(TD, STICKY, k === 'total' ? 'font-semibold' : 'font-normal')}>{k === 'total' ? 'Total' : KIND_LABEL[k]}</th>
                {months.map(m => {
                  const c = cells.get(`${unit.id}|${k}|${m}`);
                  return (
                    <td key={m} style={cellStyle(c, mode)} className={cx(TD, k === 'total' && 'font-semibold', c && 'cursor-pointer')} onClick={c ? () => onOpen(m, k, c) : undefined}>
                      {c ? amountText(c.amount) : <span className="text-muted-ink">–</span>}
                      {c?.state && <span className="block text-caption font-normal opacity-90">{statusLabel(ENTITY[mode], c.state)}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <th scope="row" className={cx(TD, STICKY, 'font-normal text-muted-ink')}>Nights booked</th>
              {months.map(m => <td key={m} className={cx(TD, 'text-muted-ink')}>{nights[m] ?? 0}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Unusual({ units, months, cells, nights, loading, error, onRetry, kind, onUnit }: {
  units: Unit[]; months: string[]; cells: Map<string, Cell>; nights: Record<string, Record<string, number>>;
  loading: boolean; error: string | null; onRetry: () => void; kind: UtilityKind | null; onUnit: (u: Unit) => void;
}) {
  const byId = useMemo(() => new Map(units.map(u => [u.id, u])), [units]);
  const rows = useMemo(() => unusual(cells, units.map(u => u.id), months, nights).filter(r => !kind || r.kind === kind), [cells, units, months, nights, kind]);
  const columns: Column<UnusualRow>[] = [
    { key: 'unit', label: 'Unit', value: r => (byId.get(r.unitId) ? unitName(byId.get(r.unitId)!) : r.unitId), width: 200 },
    { key: 'kind', label: 'Bill', value: r => KIND_LABEL[r.kind], width: 110 },
    { key: 'month', label: 'Month', type: 'text', value: r => r.month, render: r => monthLabel(r.month), width: 100 },
    { key: 'amount', label: 'This month', type: 'money', value: r => r.amount, width: 120 },
    { key: 'baseline', label: 'Previous 3 months, average', type: 'money', value: r => r.baseline, width: 170 },
    { key: 'change', label: 'Change', type: 'number', value: r => r.changePct, sortKey: 'change', width: 110,
      render: r => <StatusBadge tone={r.changePct > 0 ? 'danger' : 'warning'} label={`${r.changePct > 0 ? '▲' : '▼'} ${Math.abs(r.changePct).toFixed(1)}%`} /> },
    { key: 'nights', label: 'Nights this month', type: 'number', value: r => r.nights, width: 130 },
    { key: 'baselineNights', label: 'Nights, previous average', type: 'number', value: r => r.baselineNights, width: 160 },
  ];
  return (
    <DataTable<UnusualRow> id="finance.utility-unusual" columns={columns} rows={loading ? null : rows} loading={loading} error={error} onRetry={onRetry}
      rowKey={r => `${r.unitId}|${r.kind}|${r.month}`} onRowClick={r => { const u = byId.get(r.unitId); if (u) onUnit(u); }}
      above={<p className="m-0 px-4 py-2 text-meta text-muted-ink">A bill more than 50% above or below the same unit's average for the previous three months. Compare the nights: more guests usually means more usage.</p>}
      exportName="unusual-utility-bills" noun={['unusual bill', 'unusual bills']} pageSize={50}
      empty={{ title: 'No unusual bills in these months.', body: 'Every bill is within half of the unit’s previous three months.' }} />
  );
}

/** Whether a bill's amount can still be changed from its cell (chew, 19 Nov 2026: until the payment is processed; 20 Nov
 *  2026: record-only bills too): its statement not final, not a record kept from AutoCount, and no request or one still
 *  waiting or sent back. The server has the last word (a voucher or AP invoice on the request refuses it). */
const editable = (b: GridBill) => !b.final && (!b.recordOnly || !!b.scanned)
  && (!b.request || ['SUBMITTED', 'WITHDRAWN', 'REJECTED'].includes(b.request.status));

/** The whole printed bill and the owner's own part changed in place (chew, 19 Nov 2026); the shared part is the rest. */
function EditAmount({ bill, onSaved }: { bill: GridBill; onSaved: () => void }) {
  const whole = bill.whole ?? bill.request?.amount ?? bill.amount;
  const now = { whole, amount: bill.amount, recordOnly: bill.recordOnly };
  const wasPart = partNow(now);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<number | null>(whole);
  const [part, setPart] = useState<number | null>(wasPart);
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState(false);
  const toast = useToast();
  if (!open) return <div><Button size="sm" variant="secondary" icon={<Icon name="Pencil" size="sm" />} onClick={() => setOpen(true)}>Edit amount</Button></div>;
  /* A record-only bill whose part is left as it was follows the whole, so it stays the owner's. */
  const partTyped = part !== wasPart;
  const next = value == null ? null : billEdit(now, value, partTyped ? part ?? 0 : null);
  const ownerPart = next?.ownerPart ?? part ?? 0;
  const tooSmall = next != null && next.share < 0;
  const owner = bill.chargeTo === 'owner';
  /* "Owner paid this bill" (chew, 20 Nov 2026: the owner changed after the bill went for payment): only off a request
     that is not waiting, so finance never pays it; a waiting one is withdrawn by the save, whoever sent it. */
  const canMarkPaid = !bill.ownerPaid;
  const same = value === whole && !partTyped && !paid;
  const save = async () => {
    if (value == null || tooSmall) return;
    setBusy(true);
    try {
      const r = await api.patch<{ request: string | null; withdrawn?: string | null; notice: string | null }>(`/expenses/utilities/bills/${encodeURIComponent(bill.id)}`,
        { amount: value, ...(partTyped ? { ownerPart } : {}), ...(paid ? { ownerPaid: true } : {}) });
      toast({ tone: 'success', title: 'Bill saved.', body: [r.request ? `${r.request} now asks for the new amount.` : '',
        paid ? `${r.withdrawn ? `${r.withdrawn} withdrawn; ` : bill.request?.no ? `Taken off ${bill.request.no}; ` : ''}the whole bill goes back to the owner as O2.` : '', r.notice ?? ''].filter(Boolean).join(' ') || undefined });
      onSaved();
    } catch (e) {
      toast({ tone: 'critical', title: 'The bill was not changed.', body: errorMessage(e, 'Try again in a moment.') });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 p-2 rounded-control border border-dashed border-line">
      <MoneyInput label="Whole bill (RM)" minSen={1} valueSen={value} onChangeSen={setValue}
        error={tooSmall ? `At least the owner's own part, ${rm(ownerPart)}.` : undefined} />
      {owner && <MoneyInput label="Owner's own part (RM)" valueSen={partTyped ? part : ownerPart} onChangeSen={setPart}
        help={bill.recordOnly ? 'The whole bill is the owner\'s now. Put a smaller part to share the rest.'
          : wasPart > 0 ? 'Replaces the part set by hand and the days outside the contract, as one owner line.' : 'Charged to the owner alone, after the share.'} />}
      {next && !tooSmall && (
        <span className="text-meta text-muted-ink">{next.recordOnly ? `The whole bill, ${rm(value!)}, is the owner's (record only)` : `${rm(next.share)} shared${ownerPart > 0 ? `; ${rm(ownerPart)} the owner's alone` : ''}`}; the provider is paid {rm(value!)}.</span>
      )}
      {canMarkPaid && <OwnerPaidTick label={`${KIND_LABEL[bill.kind]} ${monthLabel(bill.billMonth)}`} checked={paid} onChange={setPaid} />}
      {paid && bill.request?.status === 'SUBMITTED' && <span className="text-meta text-muted-ink">{bill.request.no ?? 'Its payment request'} is withdrawn when you save, so finance does not pay it. Not if a voucher is already made: finance cancels that first.</span>}
      {bill.request?.status === 'SUBMITTED' && value !== whole && <span className="text-meta text-muted-ink">{bill.request.no ?? 'Its payment request'} is updated to the new amount, as long as no voucher is made yet.</span>}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" loading={busy} disabled={value == null || tooSmall || same} onClick={() => void save()}>Save</Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setOpen(false); setValue(whole); setPart(wasPart); setPaid(false); }}>Cancel</Button>
      </div>
    </div>
  );
}

/** A bill recorded to the wrong unit moved to the right one (chew, 20 Nov 2026), with its owner lines, its page and a
 *  waiting payment request (POST /expenses/utilities/bills/:id/unit). Same rule as the amount: until the voucher is
 *  processed and while the statement is not final. */
function MoveUnit({ bill, onSaved }: { bill: GridBill; onSaved: () => void }) {
  const roster = useUnitRoster();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (!open) return <div><Button size="sm" variant="secondary" icon={<Icon name="ArrowRightLeft" size="sm" />} onClick={() => setOpen(true)}>Change unit</Button></div>;
  const units = roster.filter(u => u.id !== bill.unitId);
  const save = async () => {
    if (!to) return;
    setBusy(true);
    try {
      const r = await api.post<{ ownerLines: number; accountMoved: boolean; request: string | null; rolled: boolean; deductMonth: string; notice: string | null }>(
        `/expenses/utilities/bills/${encodeURIComponent(bill.id)}/unit`, { unitId: to });
      const u = roster.find(x => x.id === to);
      toast({ tone: 'success', title: `Bill moved to ${u ? u.unitCode || u.unitNumber : 'the other unit'}.`, body: [
        r.ownerLines ? 'Its owner lines went with it, to that unit\'s owner.' : '',
        r.request ? `${r.request} now names that unit.` : '',
        r.rolled ? `Deducted on the ${monthLabel(r.deductMonth)} statement (late bill).` : '',
        r.notice ?? ''].filter(Boolean).join(' ') || undefined });
      onSaved();
    } catch (e) {
      toast({ tone: 'critical', title: 'The bill was not moved.', body: errorMessage(e, 'Try again in a moment.') });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 p-2 rounded-control border border-dashed border-line">
      <UnitPicker label="Move to unit" units={units} value={to} onChange={setTo} autoFocus />
      <span className="text-meta text-muted-ink">The bill, its owner lines and its page move to that unit and its owner{bill.request?.status === 'SUBMITTED' ? `; ${bill.request.no ?? 'its payment request'} is changed too, as long as no voucher is made yet` : ''}. The owner&apos;s own part stays as it is: check it with Edit amount after.</span>
      <div className="flex gap-2">
        <Button size="sm" variant="primary" loading={busy} disabled={!to} onClick={() => void save()}>Move bill</Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setOpen(false); setTo(''); }}>Cancel</Button>
      </div>
    </div>
  );
}

type SplitPart = { key: string; unitId: string; amount: number | null; deductOwner: boolean; ownerPaid: boolean };

/** One bill that is really for two or more units (chew, 25 Nov 2026): an amount typed for each other unit, each part
 *  deducted from its owner or not and paid back to its owner or not; this unit keeps the rest. The provider is still paid
 *  once (POST /expenses/utilities/bills/:id/split). */
function SplitBill({ bill, onSaved }: { bill: GridBill; onSaved: () => void }) {
  const roster = useUnitRoster();
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState<SplitPart[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const fresh = (): SplitPart => ({ key: crypto.randomUUID(), unitId: '', amount: null, deductOwner: true, ownerPaid: false });
  if (!open) return <div><Button size="sm" variant="secondary" icon={<Icon name="Split" size="sm" />} onClick={() => { setParts([fresh()]); setOpen(true); }}>Split with another unit</Button></div>;
  const shared = parts.reduce((n, x) => n + (x.amount ?? 0), 0);
  const left = bill.amount - shared;
  const units = [bill.unitId, ...parts.map(x => x.unitId).filter(Boolean)];
  const problem = parts.some(x => !x.unitId) ? 'Pick the unit of each part.'
    : parts.some(x => !(x.amount && x.amount > 0)) ? 'Enter the amount of each part.'
    : new Set(units).size !== units.length ? 'A unit is in the split twice.'
    : left <= 0 ? 'Leave some of the bill for this unit.' : null;
  const set = (key: string, p: Partial<SplitPart>) => setParts(list => list.map(x => (x.key === key ? { ...x, ...p } : x)));
  const save = async () => {
    if (problem) return;
    setBusy(true);
    try {
      await api.post(`/expenses/utilities/bills/${encodeURIComponent(bill.id)}/split`, {
        shares: parts.map(x => ({ unitId: x.unitId, amountSen: x.amount, chargeTo: x.deductOwner ? 'owner' : 'the_conts', ownerPaid: x.ownerPaid })) });
      toast({ tone: 'success', title: `Bill split: this unit keeps ${rm(left)}.`, body: 'Each other unit has its own part. The provider is still paid once.' });
      onSaved();
    } catch (e) {
      toast({ tone: 'critical', title: 'The bill was not split.', body: errorMessage(e, 'Try again in a moment.') });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 p-2 rounded-control border border-dashed border-line">
      <span className="text-meta text-muted-ink">This unit&apos;s part now {rm(bill.amount)}. Type each other unit&apos;s amount; this unit keeps the rest ({rm(Math.max(0, left))}).</span>
      {parts.map((x, i) => (
        <div key={x.key} className="flex flex-col gap-1 p-2 rounded-control border border-solid border-line">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Part {i + 2}</span>
            {parts.length > 1 && <Button size="sm" variant="ghost" onClick={() => setParts(list => list.filter(y => y.key !== x.key))}>Remove</Button>}
          </div>
          <UnitPicker label={`Part ${i + 2} unit`} units={roster.filter(u => u.id !== bill.unitId)} value={x.unitId} onChange={id => set(x.key, { unitId: id })} />
          <MoneyInput label={`Part ${i + 2} amount`} valueSen={x.amount} onChangeSen={v => set(x.key, { amount: v })} />
          <label className="flex items-center gap-2"><input type="checkbox" checked={x.deductOwner} onChange={e => set(x.key, { deductOwner: e.target.checked })} />Deduct from owner</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={x.ownerPaid} onChange={e => set(x.key, { ownerPaid: e.target.checked })} />Owner paid (pay back)</label>
        </div>
      ))}
      <div><Button size="sm" variant="ghost" onClick={() => setParts(list => [...list, fresh()])}>Add another unit</Button></div>
      {problem && <span className="text-meta text-danger">{problem}</span>}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" loading={busy} disabled={!!problem} onClick={() => void save()}>Split bill</Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setOpen(false); setParts([]); }}>Cancel</Button>
      </div>
    </div>
  );
}

/** The parts of a split bill put back on it, to fix the split (DELETE /expenses/utilities/bills/:id/split). */
function UndoSplit({ bill, onSaved }: { bill: GridBill; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const undo = async () => {
    setBusy(true);
    try {
      await api.del(`/expenses/utilities/bills/${encodeURIComponent(bill.id)}/split`);
      toast({ tone: 'success', title: 'Split undone: the whole bill is on this unit again.' });
      onSaved();
    } catch (e) {
      toast({ tone: 'critical', title: 'The split was not undone.', body: errorMessage(e, 'Try again in a moment.') });
    } finally {
      setBusy(false);
    }
  };
  return <div><Button size="sm" variant="secondary" loading={busy} onClick={() => void undo()}>Undo split ({bill.parts} other unit{bill.parts === 1 ? '' : 's'})</Button></div>;
}

function BillPanel({ unit, month, kind, cell, mode = 'bill', onClose, onSaved }: { unit: Unit; month: string; kind: UtilityKind | 'total'; cell: Cell; mode?: Mode; onClose: () => void; onSaved: () => void }) {
  const title = `${unitName(unit)} · ${kind === 'total' ? 'All bills' : KIND_LABEL[kind]} · ${monthLabel(month)}`;
  return (
    <Modal title={title} sub={`${cell.bills.length === 1 ? '1 bill' : `${cell.bills.length} bills`}, ${rm(cell.amount)}`} onClose={onClose}
      footer={<Button size="sm" variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="flex flex-col gap-3">
        {cell.bills.map(b => (
          <div key={b.id} className="flex flex-col gap-1 p-3 rounded-control border border-solid border-line">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{KIND_LABEL[b.kind]} · {rm(mode === 'request' ? b.request?.amount ?? b.amount : b.amount)}</span>
              {mode === 'request' && b.request && requestState(b.request.status)
                ? <StatusBadge entity="utility_request" value={requestState(b.request.status)!} size="sm" />
                : <StatusBadge entity="utility_bill" value={billState(b)} size="sm" />}
            </div>
            {b.request && <Row label="Payment request">{b.request.no ?? 'Sent'} · {monthLabel(b.request.month)}{returnedLabel(b.request) ? ` · ${returnedLabel(b.request)}` : ''}</Row>}
            {b.request?.reason && returnedLabel(b.request) && <Row label="Why">{b.request.reason}</Row>}
            {mode === 'request' && b.request?.amount != null && b.request.amount !== b.amount && <Row label="On the owner statement">{rm(b.amount)} (days inside the contract)</Row>}
            <Row label="Bill month">{monthLabel(b.billMonth)}</Row>
            <Row label="Deducted on">{monthLabel(b.deductMonth)} statement{b.rolled ? ' (late bill)' : ''}</Row>
            <Row label="Who pays">{PAYER_LABEL[b.chargeTo] ?? b.chargeTo}</Row>
            {b.ownerPaid && <Row label="Provider paid by">The owner (the whole bill given back as O2)</Row>}
            {b.reference && <Row label="Account or reference">{b.reference}</Row>}
            {b.receiptId
              ? <div><Button size="sm" variant="secondary" icon={<Icon name="FileText" size="sm" />}
                  onClick={() => downloadFile(`/documents/${encodeURIComponent(b.receiptId!)}/download`).catch(notifyFailure)}>View bill</Button></div>
              : <span className="text-meta text-muted-ink">No bill file attached.</span>}
            {b.description && (b.splitOf || (b.parts ?? 0) > 0) && <Row label="Note">{b.description}</Row>}
            {editable(b) && !b.splitOf && !(b.parts ?? 0) && <EditAmount bill={b} onSaved={onSaved} />}
            {editable(b) && !b.splitOf && !(b.parts ?? 0) && <MoveUnit bill={b} onSaved={onSaved} />}
            {!b.final && !b.splitOf && !(b.parts ?? 0) && !b.ownerPaid && !b.recordOnly && <SplitBill bill={b} onSaved={onSaved} />}
            {!b.final && (b.parts ?? 0) > 0 && <UndoSplit bill={b} onSaved={onSaved} />}
            {b.splitOf && <span className="text-meta text-muted-ink">A part of a bill split across units: change it from that bill (Undo split).</span>}
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** "Rejected by Chew" or "Withdrawn" for a request that came back, else null. */
function returnedLabel(r: { status: string; decidedBy?: string | null }): string | null {
  if (r.status === 'REJECTED') return `Rejected${r.decidedBy ? ` by ${r.decidedBy}` : ''}`;
  return r.status === 'WITHDRAWN' ? 'Withdrawn' : null;
}

/** Payment requests finance sent back, or that were withdrawn (chew, 13 Nov 2026; SOP 3.10): why, their bills, and Send
 *  again, which sends the same request and number with its bills as they are now. A bill is fixed first on "Enter this
 *  month's bills", where a bill on a request that came back can be changed and keeps the request. */
function SentBack({ requests, units, onSent }: { requests: SentBackRequest[]; units: Unit[]; onSent: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (!requests.length) return null;
  const unitOf = new Map(units.map(u => [u.id, u]));
  const send = async (r: SentBackRequest) => {
    setBusy(r.id);
    try {
      await api.post(`/expenses/utilities/payment-requests/${encodeURIComponent(r.id)}/resend`, {});
      toast({ tone: 'success', title: `${r.no ?? 'The payment request'} is with finance again.` });
      onSent();
    } catch (e) {
      toast({ tone: 'critical', title: `${r.no ?? 'The payment request'} was not sent.`, body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(null); }
  };
  return (
    <section aria-label="Payment requests sent back" className="flex flex-col gap-2 p-3 rounded-card border border-solid border-warning-line bg-warning-bg">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-copy font-semibold">Sent back to fix</h2>
        <p className="text-meta text-muted-ink">Fix a bill on "Enter this month's bills" first. Send again sends the same request with its bills as they are now.</p>
      </div>
      {requests.map(r => (
        <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2 [border-top:1px_solid_var(--color-line)]">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-copy font-semibold">{r.no ?? 'Payment request'} · <span className="text-warning">{returnedLabel(r)}</span> · <span className="tabular-nums">{rm(r.amount)}</span></span>
            {r.reason && <span className="text-meta">{r.reason}</span>}
            <span className="text-meta text-muted-ink">
              {r.bills.length === 1 ? '1 bill' : `${r.bills.length} bills`}: {r.bills.map(b => `${unitOf.get(b.unitId) ? unitName(unitOf.get(b.unitId)!) : 'Unit'} ${KIND_LABEL[b.kind]} ${monthLabel(b.billMonth)}`).join(', ')}
            </span>
          </div>
          <Button size="sm" variant="primary" loading={busy === r.id} disabled={!!busy && busy !== r.id} onClick={() => void send(r)}>Send again</Button>
        </div>
      ))}
    </section>
  );
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex justify-between gap-3 text-meta"><span className="text-muted-ink">{label}</span><span className="text-right">{children}</span></div>
);

