import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import Icon from '../../components/Icon';
import PageHeader from '../../components/PageHeader';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { StaleBanner, TableSkeleton } from '../../components/DataState';
import { EmptyState } from '../../components/States';
import { Modal } from '../../components/Modal';
import { Select } from '../../components/Select';
import { DataTable, type Column } from '../../components/DataTable';
import { Segmented as Tabs } from '../../components/ops/OpsUi';
import { useApi } from '../../lib/useApi';
import { downloadFile, notifyFailure } from '../../lib/api';
import { monthLabel, rm, todayMyt } from '../../lib/format';
import { downloadTable, type ExportCell, type ExportColumn } from '../../lib/export';
import { statusOf, statusLabel, TONE_STYLE } from '../../lib/status';
import { cx } from '../../lib/design-tokens';
import { PAYER_LABEL } from '../../lib/revenueModel';
import { useUrlState, SearchBox, FilterSelect, shiftMonth } from './listKit';
import {
  KINDS, KIND_LABEL, billState, buildCells, months as monthsOf, unitAverages, unusual,
  type Cell, type GridBill, type UtilityKind, type UnusualRow,
} from '../../lib/utilityGrid';

const UtilitiesModal = lazy(() => import('../owners/ExpenseEntry').then(m => ({ default: m.UtilitiesModal })));
const AddUtilityBill = lazy(() => import('../../components/AddUtilityBill').then(m => ({ default: m.AddUtilityBill })));

/** Finance > Utility bills (plan docs/superpowers/plans/2026-10-28-utility-listing.md): every unit's electricity, water,
 *  internet and Indah Water bills month by month, newest month first, coloured by whether the owner has been charged;
 *  one unit on its own; the bills that moved more than half against the unit's previous three months. The month's
 *  entry screen opens from "Enter this month's bills". */
interface Unit { id: string; buildingId: string; building: string; number: string; owner: string | null }
interface Listing { months: string[]; units: Unit[]; bills: GridBill[]; nights: Record<string, Record<string, number>> }
type View = 'all' | 'unusual';
const RANGES = [6, 12, 24];

const unitName = (u: Unit) => `${u.building} ${u.number}`;
const cellStyle = (c: Cell | undefined) => {
  if (!c?.state) return undefined;
  const tone = statusOf('utility_bill', c.state).tone;
  return tone === 'neutral' ? undefined : { background: TONE_STYLE[tone].bg, color: TONE_STYLE[tone].fg };
};
const amountText = (sen: number | null | undefined) => (sen == null ? '–' : rm(sen).replace(/^RM /, ''));

export default function UtilityListing() {
  const url = useUrlState();
  const view: View = url.get('view') === 'unusual' ? 'unusual' : 'all';
  const range = RANGES.includes(Number(url.get('range'))) ? Number(url.get('range')) : 12;
  const building = url.get('building'), q = url.get('q').trim().toLowerCase(), unitId = url.get('unit');
  const kind = (KINDS as string[]).includes(url.get('kind')) ? url.get('kind') as UtilityKind : null;
  const to = todayMyt().slice(0, 7), from = shiftMonth(to, -(range - 1));
  const { data, loading, error, reload } = useApi<Listing>(`/expenses/utility-listing?from=${from}&to=${to}`);
  const [entry, setEntry] = useState<null | 'month' | 'one'>(null);
  const [open, setOpen] = useState<{ unit: Unit; month: string; kind: UtilityKind | 'total'; cell: Cell } | null>(null);

  const cells = useMemo(() => buildCells(data?.bills ?? []), [data]);
  const monthList = data?.months ?? monthsOf(from, to);
  const buildings = useMemo(() => [...new Map((data?.units ?? []).map(u => [u.buildingId, u.building])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'en', { numeric: true })).map(([value, label]) => ({ value, label })), [data]);
  const units = useMemo(() => (data?.units ?? []).filter(u => (!building || u.buildingId === building)
    && (!q || unitName(u).toLowerCase().includes(q) || (u.owner ?? '').toLowerCase().includes(q))), [data, building, q]);
  const focus = unitId ? data?.units.find(u => u.id === unitId) ?? null : null;
  const shownKinds: UtilityKind[] = kind ? [kind] : KINDS;

  const header = (
    <PageHeader title="Utility bills" sub="Every unit's electricity, water, internet and Indah Water bills, month by month."
      actions={<Button size="sm" variant="secondary" onClick={() => setEntry('one')}>Add utility bill</Button>}
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
      {open && <BillPanel {...open} onClose={() => setOpen(null)} />}
    </>
  );
  const filters = (
    <div className="flex flex-wrap items-center gap-2">
      <Select label="Months" value={String(range)} onChange={v => url.set({ range: v === '12' ? null : v })} className="w-[160px]"
        options={RANGES.map(r => ({ value: String(r), label: `Last ${r} months` }))} />
      <FilterSelect label="Building" value={building} all="All buildings" onChange={v => url.set({ building: v })} options={buildings} className="w-[200px]" />
      <FilterSelect label="Kind" value={kind ?? ''} all="All bills" onChange={v => url.set({ kind: v })}
        options={KINDS.map(k => ({ value: k, label: KIND_LABEL[k] }))} className="w-[150px]" />
      <SearchBox value={url.get('q')} onChange={v => url.set({ q: v })} placeholder="Unit or owner" label="Search units" className="w-[200px]" />
    </div>
  );

  if (focus) return (
    <>
      {header}
      <OneUnit unit={focus} months={monthList} cells={cells} nights={data?.nights[focus.id] ?? {}}
        onBack={() => url.set({ unit: null })} onOpen={(month, k, cell) => setOpen({ unit: focus, month, kind: k, cell })} />
      {modals}
    </>
  );

  return (
    <>
      {header}
      <div className="flex flex-col gap-3">
        <Tabs<View> label="All bills or unusual bills" value={view} onChange={v => url.set({ view: v === 'all' ? null : v })} className="self-start"
          options={[{ value: 'all', label: 'All bills' }, { value: 'unusual', label: 'Unusual' }]} />
        {filters}
        {error && <StaleBanner message={data ? `Showing the last figures we have. ${error}` : error} onRetry={reload} />}
        {view === 'all'
          ? <AllBills units={units} months={monthList} kinds={shownKinds} cells={cells} nights={data?.nights ?? {}} loading={loading && !data}
              filtered={!!(building || q)} onUnit={u => url.set({ unit: u.id })} onOpen={(unit, month, k, cell) => setOpen({ unit, month, kind: k, cell })} />
          : <Unusual units={units} months={monthList} cells={cells} nights={data?.nights ?? {}} loading={loading && !data} error={data ? null : error}
              onRetry={reload} kind={kind} onUnit={u => url.set({ unit: u.id })} />}
      </div>
      {modals}
    </>
  );
}

function Legend() {
  const items: { label: string; state: 'charged' | 'pending' | 'record' | 'company' | null }[] = [
    { label: statusLabel('utility_bill', 'charged'), state: 'charged' }, { label: statusLabel('utility_bill', 'pending'), state: 'pending' },
    { label: statusLabel('utility_bill', 'record'), state: 'record' }, { label: statusLabel('utility_bill', 'company'), state: 'company' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-muted-ink" aria-label="Colour key">
      {items.map(i => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3.5 h-3.5 rounded-[3px] border border-solid border-line"
            style={cellStyle(i.state ? { amount: 0, state: i.state, bills: [] } : undefined)} />{i.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5"><span className="font-semibold">–</span> No bill</span>
    </div>
  );
}

const TH = 'px-2 py-1.5 text-meta font-semibold text-muted-ink bg-muted [border-bottom:1px_solid_var(--color-line)] whitespace-nowrap';
const TD = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap [border-bottom:1px_solid_var(--color-line)]';
const STICKY = 'sticky left-0 z-[1] bg-card text-left [border-right:1px_solid_var(--color-line)]';

function AllBills({ units, months, kinds, cells, nights, loading, filtered, onUnit, onOpen }: {
  units: Unit[]; months: string[]; kinds: UtilityKind[]; cells: Map<string, Cell>; nights: Record<string, Record<string, number>>;
  loading: boolean; filtered: boolean; onUnit: (u: Unit) => void; onOpen: (u: Unit, month: string, k: UtilityKind | 'total', c: Cell) => void;
}) {
  const cols: (UtilityKind | 'total')[] = kinds.length > 1 ? [...kinds, 'total'] : kinds;
  const label = (k: UtilityKind | 'total') => (k === 'total' ? 'Total' : KIND_LABEL[k]);
  function exportExcel() {
    const head: ExportColumn[] = [{ label: 'Unit', kind: 'text' }, { label: 'Owner', kind: 'text' },
      ...months.flatMap(m => cols.flatMap(k => [{ label: `${monthLabel(m)} ${label(k)} (RM)`, kind: 'money' as const }, ...(k === 'total' ? [] : [{ label: `${monthLabel(m)} ${label(k)} state`, kind: 'text' as const }])])),
      { label: 'Average per month (RM)', kind: 'money' }, { label: 'Average per night (RM)', kind: 'money' }];
    const rows: ExportCell[][] = units.map(u => {
      const avg = unitAverages(cells, u.id, months, nights[u.id] ?? {});
      return [unitName(u), u.owner ?? '', ...months.flatMap(m => cols.flatMap(k => {
        const c = cells.get(`${u.id}|${k}|${m}`);
        return [c ? c.amount / 100 : null, ...(k === 'total' ? [] : [c?.state ? statusLabel('utility_bill', c.state) : ''])];
      })), avg.perMonth == null ? null : avg.perMonth / 100, avg.perNight == null ? null : avg.perNight / 100];
    });
    downloadTable('xlsx', 'utility-bills', 'Utility bills', head, rows);
  }
  if (loading) return <TableSkeleton rows={8} cols={8} />;
  if (!units.length) return <EmptyState kind={filtered ? 'filtered' : 'empty'} title={filtered ? 'No units match.' : 'No units yet.'} />;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Legend />
        <Button size="sm" variant="secondary" icon={<Icon name="Download" size="sm" />} onClick={exportExcel}>Export to Excel</Button>
      </div>
      <div className="overflow-auto max-h-[calc(100vh-260px)] border border-solid border-line rounded-card bg-card">
        <table className="border-separate border-spacing-0 text-copy min-w-full">
          <thead className="sticky top-0 z-[2]">
            <tr>
              <th rowSpan={2} className={cx(TH, STICKY, 'z-[3] bg-muted min-w-[180px]')}>Unit</th>
              {months.map(m => <th key={m} colSpan={cols.length} className={cx(TH, 'text-center [border-left:1px_solid_var(--color-line)]')}>{monthLabel(m)}</th>)}
              <th colSpan={2} className={cx(TH, 'text-center [border-left:1px_solid_var(--color-line)]')}>Average</th>
            </tr>
            <tr>
              {months.map(m => cols.map((k, i) => (
                <th key={`${m}${k}`} className={cx(TH, 'text-right font-normal', i === 0 && '[border-left:1px_solid_var(--color-line)]', k === 'total' && 'font-semibold')}>{label(k)}</th>
              )))}
              <th className={cx(TH, 'text-right font-normal [border-left:1px_solid_var(--color-line)]')}>Per month</th>
              <th className={cx(TH, 'text-right font-normal')}>Per night</th>
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
                      {u.owner && <span className="block text-meta text-muted-ink truncate max-w-[200px]">{u.owner}</span>}
                    </button>
                  </th>
                  {months.map(m => cols.map((k, i) => {
                    const c = cells.get(`${u.id}|${k}|${m}`);
                    const state = c?.state ? statusLabel('utility_bill', c.state) : null;
                    return (
                      <td key={`${m}${k}`} style={cellStyle(c)} title={c ? `${label(k)} ${monthLabel(m)}: ${rm(c.amount)}${state ? ` · ${state}` : ''}` : undefined}
                        className={cx(TD, i === 0 && '[border-left:1px_solid_var(--color-line)]', k === 'total' && 'font-semibold', c && 'cursor-pointer')}
                        onClick={c ? () => onOpen(u, m, k, c) : undefined}>
                        {c ? amountText(c.amount) : <span className="text-muted-ink">–</span>}
                      </td>
                    );
                  }))}
                  <td className={cx(TD, '[border-left:1px_solid_var(--color-line)]')}>{amountText(avg.perMonth)}</td>
                  <td className={TD}>{amountText(avg.perNight)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="m-0 text-meta text-muted-ink">Amounts in RM. A bill sits in the month it is for; its colour follows the owner statement that deducts it. Average per night leaves out months with no nights booked.</p>
    </div>
  );
}

function OneUnit({ unit, months, cells, nights, onBack, onOpen }: {
  unit: Unit; months: string[]; cells: Map<string, Cell>; nights: Record<string, number>;
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
          {unit.owner && <div className="text-meta text-muted-ink">{unit.owner}</div>}
        </div>
        <div className="ml-auto flex gap-4 text-meta text-muted-ink">
          <span>Average per month <b className="text-ink tabular-nums">{avg.perMonth == null ? '–' : rm(avg.perMonth)}</b></span>
          <span>Average per night <b className="text-ink tabular-nums">{avg.perNight == null ? '–' : rm(avg.perNight)}</b></span>
        </div>
      </div>
      <Legend />
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
                    <td key={m} style={cellStyle(c)} className={cx(TD, k === 'total' && 'font-semibold', c && 'cursor-pointer')} onClick={c ? () => onOpen(m, k, c) : undefined}>
                      {c ? amountText(c.amount) : <span className="text-muted-ink">–</span>}
                      {c?.state && <span className="block text-[11px] font-normal opacity-90">{statusLabel('utility_bill', c.state)}</span>}
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

function BillPanel({ unit, month, kind, cell, onClose }: { unit: Unit; month: string; kind: UtilityKind | 'total'; cell: Cell; onClose: () => void }) {
  const title = `${unitName(unit)} · ${kind === 'total' ? 'All bills' : KIND_LABEL[kind]} · ${monthLabel(month)}`;
  return (
    <Modal title={title} sub={`${cell.bills.length === 1 ? '1 bill' : `${cell.bills.length} bills`}, ${rm(cell.amount)}`} onClose={onClose}
      footer={<Button size="sm" variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="flex flex-col gap-3">
        {cell.bills.map(b => (
          <div key={b.id} className="flex flex-col gap-1 p-3 rounded-control border border-solid border-line">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{KIND_LABEL[b.kind]} · {rm(b.amount)}</span>
              <StatusBadge entity="utility_bill" value={billState(b)} size="sm" />
            </div>
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

