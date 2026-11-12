import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import Icon from '../../components/Icon';
import PageHeader from '../../components/PageHeader';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { StaleBanner, TableSkeleton } from '../../components/DataState';
import { EmptyState } from '../../components/States';
import { Modal } from '../../components/Modal';
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
  KINDS, KIND_LABEL, billState, buildCells, buildRequestCells, months as monthsOf, requestState, unitAverages, unusual,
  type Cell, type GridBill, type UtilityKind, type UnusualRow,
} from '../../lib/utilityGrid';

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
      {open && <BillPanel {...open} mode={mode} onClose={() => setOpen(null)} />}
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
        {error && <StaleBanner message={data ? `Showing the last figures we have. ${error}` : error} onRetry={reload} />}
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

function BillPanel({ unit, month, kind, cell, mode = 'bill', onClose }: { unit: Unit; month: string; kind: UtilityKind | 'total'; cell: Cell; mode?: Mode; onClose: () => void }) {
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
            {b.request && <Row label="Payment request">{b.request.no ?? 'Sent'} · {monthLabel(b.request.month)}</Row>}
            {mode === 'request' && b.request?.amount != null && b.request.amount !== b.amount && <Row label="On the owner statement">{rm(b.amount)} (days inside the contract)</Row>}
            <Row label="Bill month">{monthLabel(b.billMonth)}</Row>
            <Row label="Deducted on">{monthLabel(b.deductMonth)} statement{b.rolled ? ' (late bill)' : ''}</Row>
            <Row label="Who pays">{PAYER_LABEL[b.chargeTo] ?? b.chargeTo}</Row>
            {b.reference && <Row label="Account or reference">{b.reference}</Row>}
            {b.receiptId
              ? <div><Button size="sm" variant="secondary" icon={<Icon name="FileText" size="sm" />}
                  onClick={() => downloadFile(`/documents/${encodeURIComponent(b.receiptId!)}/download`).catch(notifyFailure)}>View bill</Button></div>
              : <span className="text-meta text-muted-ink">No bill file attached.</span>}
          </div>
        ))}
      </div>
    </Modal>
  );
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex justify-between gap-3 text-meta"><span className="text-muted-ink">{label}</span><span className="text-right">{children}</span></div>
);

