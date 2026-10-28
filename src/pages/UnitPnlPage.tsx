import { useMemo, useState, type ReactNode } from 'react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { StatusBadge } from '../components/StatusBadge';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { EmptyState } from '../components/States';
import { StatRow, StatTile } from '../components/Metric';
import { Select } from '../components/Select';
import { DataTable, type Column } from '../components/DataTable';
import { Segmented as Tabs } from '../components/ops/OpsUi';
import { TwoLayerTrend, CostShare } from '../components/reports/PnlCharts';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { monthLabel, rm, todayMyt } from '../lib/format';
import { downloadTable, type ExportCell, type ExportColumn } from '../lib/export';
import { cx, TONE } from '../lib/design-tokens';
import { useUrlState, SearchBox, FilterSelect, shiftMonth } from './finance/listKit';
import {
  LINE_LABEL, COST_KEYS, pnl, sumPnl, pctOfIncome, bracketMoney, checks, gaps,
  type CostKey, type LineKey, type Limits, type Pnl, type UnitMonthInput, type Flag, type Gap,
} from '../lib/unitPnl';

/** Finance > Unit P&L (plan docs/superpowers/plans/2026-10-28-unit-pnl.md): what each unit earned and spent, month by
 *  month, in two layers — the unit's operating profit, then what the company keeps after the owner's portion — with
 *  the checks that flag numbers that look wrong and the gaps that say a month's data is incomplete. */
interface Unit { id: string; building: string; number: string; owner: string; contract: 'LT' | 'PS' }
interface Payload { months: string[]; units: Unit[]; rows: UnitMonthInput[]; limits: Limits; excluded: number; toDate: string | null }
type View = 'overview' | 'checks';
const RANGES = [3, 6, 12];

/** One colour per cost line, from the theme (critical red is kept for losses). */
const LINE_COLOR: Record<CostKey, string> = {
  fees: 'var(--color-chart-ink)', cleaning: 'var(--color-info-line)', electricity: 'var(--color-warning-line)', water: 'var(--color-chart-teal)',
  internet: 'var(--color-gold)', sewerage: 'var(--color-success-line)', other: 'var(--color-neutral-line)', misc: 'var(--color-faint)',
};
const unitName = (u: Unit | undefined, id: string) => (u ? `${u.building} ${u.number}` : id);
const pctText = (v: number | null) => (v == null ? '–' : `${v.toFixed(1)}%`);
const rmText = (sen: number) => (sen < 0 ? `(${rm(-sen)})` : rm(sen));

function Money({ sen, strong }: { sen: number; strong?: boolean }) {
  const b = bracketMoney(sen);
  return <span className={cx('tabular-nums', b.negative && 'text-danger', strong && 'font-semibold')}>{b.text}</span>;
}

const GAP_TEXT: Record<Gap['kind'], { what: string; todo: string }> = {
  no_cleaning: { what: 'Nights booked but no cleaning cost', todo: 'Ask operations to record the cleaning costs for this month.' },
  no_electricity: { what: 'Nights booked but no electricity bill', todo: 'Enter the electricity bill on Utility bills.' },
  no_nights: { what: 'No nights booked', todo: 'Check the unit was available and its reservations were imported.' },
  guest_paid_missing: { what: 'Guest total missing on a reservation', todo: 'The payout was used instead; check the reservation import.' },
  payout_above_guest_paid: { what: 'Payout is more than the guest total', todo: 'Check the reservation amounts for this month.' },
};
const RULE_TEXT: Record<Flag['rule'], string> = { own_past: 'Unlike its last 3 months', building: 'Above its building', limit: 'Over your limit' };
const flagLine = (f: Flag) => (f.line === 'operating' ? 'Operating margin' : LINE_LABEL[f.line]);
const flagValue = (f: Flag, v: number) => (f.measure === 'pct' ? `${v.toFixed(1)}%` : `${rm(v)} / night`);

export default function UnitPnlPage() {
  const url = useUrlState();
  const view: View = url.get('view') === 'checks' ? 'checks' : 'overview';
  const range = RANGES.includes(Number(url.get('range'))) ? Number(url.get('range')) : 6;
  const toDate = url.get('toDate') === '1';
  const building = url.get('building'), contract = url.get('contract'), q = url.get('q').trim().toLowerCase(), unitId = url.get('unit');
  const thisMonth = todayMyt().slice(0, 7);
  const to = toDate ? thisMonth : shiftMonth(thisMonth, -1);
  const from = shiftMonth(to, -(Math.min(range, 12) - 1));
  const { data, loading, error, reload } = useApi<Payload>(`/finance/unit-pnl?from=${from}&to=${to}`);

  const unitById = useMemo(() => new Map((data?.units ?? []).map(u => [u.id, u])), [data]);
  const buildings = useMemo(() => [...new Set((data?.units ?? []).map(u => u.building))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map(b => ({ value: b, label: b })), [data]);
  const shownUnits = useMemo(() => new Set((data?.units ?? []).filter(u => (!building || u.building === building) && (!contract || u.contract === contract)
    && (!unitId || u.id === unitId) && (!q || `${u.building} ${u.number} ${u.owner}`.toLowerCase().includes(q))).map(u => u.id)), [data, building, contract, unitId, q]);
  const rows = useMemo(() => (data?.rows ?? []).filter(r => shownUnits.has(r.unitId)), [data, shownUnits]);
  const months = data?.months ?? [];
  const buildingOf = useMemo(() => Object.fromEntries((data?.units ?? []).map(u => [u.id, u.building])), [data]);
  // Checks look at every unit (the building median needs the neighbours), then follow the filters.
  const flags = useMemo(() => (data ? checks(data.rows, buildingOf, data.limits) : []).filter(f => shownUnits.has(f.unitId)), [data, buildingOf, shownUnits]);
  const holes = useMemo(() => gaps(rows), [rows]);
  const focus = unitId ? unitById.get(unitId) : undefined;

  const header = (
    <PageHeader title={focus ? `Unit P&L · ${unitName(focus, focus.id)}` : 'Unit P&L'}
      sub={focus ? `${focus.owner} · ${focus.contract === 'LT' ? 'Fixed rent' : 'Profit share'}` : 'What each unit earned and spent, month by month: the unit’s profit, then what the company keeps.'}
      back={focus ? { label: 'All units', onClick: () => url.set({ unit: null }) } : undefined} />
  );
  const filters = (
    <div className="flex flex-wrap items-center gap-2">
      <Select label="Months" value={String(range)} onChange={v => url.set({ range: v === '6' ? null : v })} className="w-[170px]"
        options={RANGES.map(r => ({ value: String(r), label: `Last ${r} months` }))} />
      <Select label="This month" value={toDate ? '1' : ''} onChange={v => url.set({ toDate: v || null })} className="w-[190px]"
        options={[{ value: '', label: 'Complete months only' }, { value: '1', label: `With ${monthLabel(thisMonth)} to date` }]} />
      {!focus && <>
        <FilterSelect label="Building" value={building} all="All buildings" onChange={v => url.set({ building: v })} options={buildings} className="w-[200px]" />
        <FilterSelect label="Contract" value={contract} all="All contracts" onChange={v => url.set({ contract: v })}
          options={[{ value: 'PS', label: 'Profit share' }, { value: 'LT', label: 'Fixed rent' }]} className="w-[160px]" />
        <SearchBox value={url.get('q')} onChange={v => url.set({ q: v })} placeholder="Unit or owner" label="Search units" className="w-[200px]" />
      </>}
    </div>
  );

  return (
    <>
      {header}
      <div className="flex flex-col gap-4">
        <Tabs<View> label="Overview or checks" value={view} onChange={v => url.set({ view: v === 'overview' ? null : v })} className="self-start"
          options={[{ value: 'overview', label: 'Overview' }, { value: 'checks', label: `Checks${data ? ` (${flags.length + holes.length})` : ''}` }]} />
        {filters}
        {error && <StaleBanner message={data ? `Showing the last figures we have. ${error}` : error} onRetry={reload} />}
        {loading && !data ? <TableSkeleton rows={8} cols={7} />
          : !rows.length ? <EmptyState kind={building || contract || q ? 'filtered' : 'empty'} title="No figures for these months." />
          : view === 'overview'
            ? <Overview rows={rows} months={months} units={unitById} toDate={data?.toDate ?? null} focus={!!focus} flags={flags} holes={holes}
                excluded={data?.excluded ?? 0} onUnit={id => url.set({ unit: id })} onChecks={() => url.set({ view: 'checks' })} />
            : <Checks flags={flags} holes={holes} units={unitById} limits={data?.limits ?? { lines: {} }} onSaved={reload} onUnit={id => url.set({ unit: id, view: null })} />}
      </div>
    </>
  );
}

function Overview({ rows, months, units, toDate, focus, flags, holes, excluded, onUnit, onChecks }: {
  rows: UnitMonthInput[]; months: string[]; units: Map<string, Unit>; toDate: string | null; focus: boolean; flags: Flag[]; holes: Gap[];
  excluded: number; onUnit: (id: string) => void; onChecks: () => void;
}) {
  const byMonth = useMemo(() => new Map(months.map(m => [m, sumPnl(rows.filter(r => r.month === m).map(pnl))])), [rows, months]);
  const total = useMemo(() => sumPnl([...byMonth.values()]), [byMonth]);
  const mLabel = (m: string) => `${monthLabel(m)}${m === toDate ? ' (to date)' : ''}`;
  // Each KPI compares the last month shown with the one before it.
  const [last, prev] = [months[months.length - 1], months[months.length - 2]];
  const L = byMonth.get(last), P = prev ? byMonth.get(prev) : undefined;
  const delta = (cur: number | null, before: number | null, higherIsGood: boolean, points = false) => {
    if (cur == null || before == null || !prev) return undefined;
    const d = points ? cur - before : before ? ((cur - before) / Math.abs(before)) * 100 : null;
    if (d == null || !Number.isFinite(d)) return undefined;
    const good = d === 0 ? null : (d > 0) === higherIsGood;
    return { text: `${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${Math.abs(d).toFixed(1)}${points ? ' pts' : '%'} ${monthLabel(last)} vs ${monthLabel(prev)}`, tone: good == null ? undefined : good ? 'success' as const : 'critical' as const };
  };
  const costPct = (p?: Pnl) => (p ? pctOfIncome(COST_KEYS.reduce((n, k) => n + p[k], 0), p.guestPaid) : null);
  const kpis = [
    { label: 'Guest total', value: rm(total.guestPaid), d: delta(L?.guestPaid ?? null, P?.guestPaid ?? null, true) },
    { label: 'All costs, % of guest total', value: pctText(costPct(total)), d: delta(costPct(L), costPct(P), false, true) },
    { label: 'Operating profit', value: rmText(total.operating), hint: `Margin ${pctText(pctOfIncome(total.operating, total.guestPaid))}`, d: delta(L?.operating ?? null, P?.operating ?? null, true) },
    { label: 'Company keeps', value: rmText(total.company), d: delta(L?.company ?? null, P?.company ?? null, true) },
  ];
  return (
    <div className="flex flex-col gap-4">
      {(holes.length > 0 || flags.length > 0 || excluded > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-meta text-muted-ink">
          {holes.length > 0 && <button type="button" onClick={onChecks} className="bg-transparent border-0 p-0 cursor-pointer"><StatusBadge tone="warning" label={`${holes.length} data gaps`} /></button>}
          {flags.length > 0 && <button type="button" onClick={onChecks} className="bg-transparent border-0 p-0 cursor-pointer"><StatusBadge tone="danger" label={`${flags.length} checks to look at`} /></button>}
          {excluded > 0 && !focus && <span>{excluded} long-term lets and master leases are not in this report.</span>}
        </div>
      )}
      <StatRow cols={4}>
        {kpis.map((k, i) => (
          <StatTile key={k.label} hero={i === 3} label={k.label} value={k.value}
            hint={<>{k.hint && <div>{k.hint}</div>}{k.d && <div className={k.d.tone && i !== 3 ? TONE[k.d.tone].text : undefined}>{k.d.text}</div>}</>} />
        ))}
      </StatRow>
      <Section title="Operating profit and company keeps, by month (RM)">
        <TwoLayerTrend points={months.map(m => ({ key: m, label: mLabel(m), a: byMonth.get(m)!.operating, b: byMonth.get(m)!.company }))}
          aLabel={LINE_LABEL.operating} bLabel={LINE_LABEL.company} format={rmText} />
      </Section>
      <PnlByMonth months={months} byMonth={byMonth} total={total} mLabel={mLabel} />
      <Section title="Costs as a share of the guest total, by month">
        <CostShare months={months.map(m => ({ key: m, label: mLabel(m) }))} series={COST_KEYS.map(k => ({ key: k, label: LINE_LABEL[k], color: LINE_COLOR[k] }))}
          share={(m, k) => pctOfIncome(byMonth.get(m)![k as CostKey], byMonth.get(m)!.guestPaid)} />
      </Section>
      {!focus && <ByUnit rows={rows} units={units} flags={flags} holes={holes} onUnit={onUnit} />}
    </div>
  );
}

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-card border border-solid border-line bg-card p-4 sm:p-5 flex flex-col gap-3 min-w-0">
      <div className="flex items-center justify-between gap-3"><h2 className="m-0 text-[15px] font-semibold">{title}</h2>{right}</div>
      {children}
    </section>
  );
}

const ROWS: { key: LineKey; kind: 'income' | 'cost' | 'sub' | 'line' | 'result' }[] = [
  { key: 'guestPaid', kind: 'income' },
  ...COST_KEYS.map(k => ({ key: k as LineKey, kind: 'cost' as const })),
  { key: 'operating', kind: 'sub' }, { key: 'owner', kind: 'line' }, { key: 'company', kind: 'result' },
];

function PnlByMonth({ months, byMonth, total, mLabel }: { months: string[]; byMonth: Map<string, Pnl>; total: Pnl; mLabel: (m: string) => string }) {
  const cols = [...months.map(m => ({ key: m, label: mLabel(m), p: byMonth.get(m)! })), { key: 'total', label: 'Total', p: total }];
  const costs = (p: Pnl) => COST_KEYS.reduce((n, k) => n + p[k], 0);
  function exportExcel() {
    const head: ExportColumn[] = [{ label: 'Line', kind: 'text' }, ...cols.flatMap(c => [{ label: `${c.label} (RM)`, kind: 'money' as const }, { label: `${c.label} %`, kind: 'number' as const }])];
    const line = (label: string, get: (p: Pnl) => number): ExportCell[] => [label, ...cols.flatMap(c => [get(c.p) / 100, pctOfIncome(get(c.p), c.p.guestPaid)])];
    downloadTable('xlsx', 'unit-pnl-by-month', 'P&L by month', head, [
      line(LINE_LABEL.guestPaid, p => p.guestPaid), ...COST_KEYS.map(k => line(LINE_LABEL[k], p => p[k])), line('Total costs', costs),
      line(LINE_LABEL.operating, p => p.operating), line(LINE_LABEL.owner, p => p.owner), line(LINE_LABEL.company, p => p.company),
    ]);
  }
  const TH = 'px-3 py-2 text-meta font-semibold text-muted-ink text-right whitespace-nowrap bg-muted';
  const cell = (p: Pnl, k: LineKey | 'costs', strong?: boolean) => {
    const v = k === 'costs' ? costs(p) : p[k];
    return (
      <td key={k} className="px-3 py-1.5 text-right align-top whitespace-nowrap">
        <Money sen={v} strong={strong} />
        {k !== 'guestPaid' && v !== 0 && <div className="text-[11px] text-muted-ink tabular-nums">{pctText(pctOfIncome(v, p.guestPaid))}</div>}
      </td>
    );
  };
  return (
    <Section title="Two-layer P&L by month (RM, % of guest total)"
      right={<Button size="sm" variant="secondary" icon={<Icon name="Download" size="sm" />} onClick={exportExcel}>Export to Excel</Button>}>
      <div className="overflow-x-auto -mx-4 sm:-mx-5">
        <table className="w-full border-collapse text-copy">
          <thead>
            <tr className="[border-bottom:1px_solid_var(--color-line)]">
              <th className={cx(TH, 'text-left sticky left-0 z-[1] min-w-[190px]')}>Line</th>
              {cols.map(c => <th key={c.key} className={cx(TH, c.key === 'total' && '[border-left:1px_solid_var(--color-line)]')}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(r => (
              <PnlRow key={r.key} kind={r.kind} label={LINE_LABEL[r.key]} cells={cols.map(c => cell(c.p, r.key, r.kind !== 'cost'))}
                extra={r.key === 'misc' ? <PnlRow kind="subtotal" label="Total costs" cells={cols.map(c => cell(c.p, 'costs', true))} /> : null} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="m-0 text-meta text-muted-ink">Guest total: what guests paid for the month’s nights. Service fees and taxes: the guest total less what the reservations paid out. Operating profit is the statement’s gross profit; company keeps is what is left after the owner’s portion (the Overall unit report’s gain or loss).</p>
    </Section>
  );
}

function PnlRow({ kind, label, cells, extra }: { kind: string; label: string; cells: ReactNode[]; extra?: ReactNode }) {
  const rule = kind === 'sub' ? '[border-top:1px_solid_var(--color-line-strong)]' : kind === 'result' ? '[border-top:3px_double_var(--color-line-strong)]' : kind === 'subtotal' ? '[border-top:1px_solid_var(--color-line)]' : '';
  return (
    <>
      <tr className={cx(rule, kind === 'result' && 'bg-muted')}>
        <th scope="row" className={cx('px-3 py-1.5 text-left whitespace-nowrap sticky left-0 z-[1] bg-card', kind === 'result' && 'bg-muted',
          kind === 'cost' ? 'pl-7 font-normal text-ink-2' : 'font-semibold')}>{label}</th>
        {cells}
      </tr>
      {extra}
    </>
  );
}

interface UnitRow { unitId: string; name: string; building: string; contract: string; nights: number; days: number; p: Pnl; flags: number; gaps: number }

function ByUnit({ rows, units, flags, holes, onUnit }: { rows: UnitMonthInput[]; units: Map<string, Unit>; flags: Flag[]; holes: Gap[]; onUnit: (id: string) => void }) {
  const list = useMemo(() => {
    const by = new Map<string, UnitMonthInput[]>();
    for (const r of rows) by.set(r.unitId, [...(by.get(r.unitId) ?? []), r]);
    return [...by.entries()].map(([id, rs]): UnitRow => {
      const u = units.get(id);
      return { unitId: id, name: unitName(u, id), building: u?.building ?? '', contract: u?.contract === 'LT' ? 'Fixed rent' : 'Profit share',
        nights: rs.reduce((n, r) => n + r.nights, 0), days: rs.reduce((n, r) => n + r.days, 0), p: sumPnl(rs.map(pnl)),
        flags: flags.filter(f => f.unitId === id).length, gaps: holes.filter(g => g.unitId === id).length };
    });
  }, [rows, units, flags, holes]);
  const util = (p: Pnl) => p.electricity + p.water + p.internet + p.sewerage;
  const pct = (v: number, p: Pnl) => pctOfIncome(v, p.guestPaid);
  const columns: Column<UnitRow>[] = [
    { key: 'unit', label: 'Unit', value: r => r.name, width: 210, hideable: false },
    { key: 'contract', label: 'Contract', value: r => r.contract, width: 110 },
    { key: 'nights', label: 'Nights', type: 'number', value: r => r.nights, width: 80 },
    { key: 'occ', label: 'Occupancy', type: 'number', value: r => (r.days ? Math.round((r.nights / r.days) * 1000) / 10 : null), render: r => pctText(r.days ? (r.nights / r.days) * 100 : null), width: 100 },
    { key: 'income', label: 'Guest total', type: 'money', value: r => r.p.guestPaid, width: 130 },
    { key: 'perNight', label: 'Per night', type: 'money', value: r => (r.nights ? Math.round(r.p.guestPaid / r.nights) : null), width: 110 },
    { key: 'fees', label: 'Service fees %', type: 'number', value: r => pct(r.p.fees, r.p), render: r => pctText(pct(r.p.fees, r.p)), width: 120 },
    { key: 'cleaning', label: 'Cleaning %', type: 'number', value: r => pct(r.p.cleaning, r.p), render: r => pctText(pct(r.p.cleaning, r.p)), width: 110 },
    { key: 'util', label: 'Utilities %', type: 'number', value: r => pct(util(r.p), r.p), render: r => pctText(pct(util(r.p), r.p)), width: 110 },
    { key: 'utilNight', label: 'Utilities / night', type: 'money', value: r => (r.nights ? Math.round(util(r.p) / r.nights) : null), width: 130 },
    { key: 'margin', label: 'Operating margin', type: 'number', value: r => pct(r.p.operating, r.p), render: r => <span className={cx((pct(r.p.operating, r.p) ?? 0) < 0 && 'text-danger')}>{pctText(pct(r.p.operating, r.p))}</span>, width: 140 },
    { key: 'owner', label: "Owner's portion", type: 'money', value: r => r.p.owner, render: r => <Money sen={r.p.owner} />, width: 140 },
    { key: 'company', label: 'Company keeps', type: 'money', value: r => r.p.company, render: r => <Money sen={r.p.company} strong />, width: 140 },
    { key: 'checks', label: 'Checks', value: r => r.flags + r.gaps, width: 150, render: r => (
      <span className="inline-flex gap-1">
        {r.gaps > 0 && <StatusBadge tone="warning" size="sm" label={`${r.gaps} gaps`} />}
        {r.flags > 0 && <StatusBadge tone="danger" size="sm" label={`${r.flags} to look at`} />}
        {!r.gaps && !r.flags && <span className="text-muted-ink">–</span>}
      </span>) },
  ];
  return (
    <DataTable<UnitRow> id="finance.unit-pnl" columns={columns} rows={list} rowKey={r => r.unitId} onRowClick={r => onUnit(r.unitId)}
      exportName="unit-pnl-by-unit" noun={['unit', 'units']} defaultSort="company:asc" pageSize={50}
      above={<p className="m-0 px-4 py-2 text-meta text-muted-ink">Each unit over the months shown. Lowest company result first; click a unit for its own P&L.</p>} />
  );
}

interface CheckRow { key: string; unitId: string; month: string; kind: 'gap' | Flag['rule']; what: string; value: string; reference: string; todo: string }

function Checks({ flags, holes, units, limits, onSaved, onUnit }: {
  flags: Flag[]; holes: Gap[]; units: Map<string, Unit>; limits: Limits; onSaved: () => void; onUnit: (id: string) => void;
}) {
  const [rule, setRule] = useState('');
  const rows: CheckRow[] = useMemo(() => [
    ...holes.map((g, i) => ({ key: `g${i}`, unitId: g.unitId, month: g.month, kind: 'gap' as const, what: GAP_TEXT[g.kind].what, value: '', reference: '', todo: GAP_TEXT[g.kind].todo })),
    ...flags.map((f, i) => ({ key: `f${i}`, unitId: f.unitId, month: f.month, kind: f.rule, what: `${flagLine(f)}: ${RULE_TEXT[f.rule].toLowerCase()}`,
      value: flagValue(f, f.value), reference: `${f.rule === 'own_past' ? 'Average' : f.rule === 'building' ? 'Building median' : 'Limit'} ${flagValue(f, f.reference)}`, todo: '' })),
  ].filter(r => !rule || r.kind === rule), [flags, holes, rule]);
  const columns: Column<CheckRow>[] = [
    { key: 'unit', label: 'Unit', value: r => unitName(units.get(r.unitId), r.unitId), width: 210 },
    { key: 'month', label: 'Month', value: r => r.month, render: r => monthLabel(r.month), width: 100 },
    { key: 'kind', label: 'Type', value: r => (r.kind === 'gap' ? 'Data gap' : RULE_TEXT[r.kind]), width: 170,
      render: r => <StatusBadge tone={r.kind === 'gap' ? 'warning' : 'danger'} size="sm" label={r.kind === 'gap' ? 'Data gap' : RULE_TEXT[r.kind]} /> },
    { key: 'what', label: 'What', value: r => r.what, width: 280 },
    { key: 'value', label: 'This month', value: r => r.value || null, width: 150 },
    { key: 'reference', label: 'Compared with', value: r => r.reference || null, width: 200 },
    { key: 'todo', label: 'What to do', value: r => r.todo || null, width: 300 },
  ];
  return (
    <div className="flex flex-col gap-4">
      <DataTable<CheckRow> id="finance.unit-pnl-checks" columns={columns} rows={rows} rowKey={r => r.key} onRowClick={r => onUnit(r.unitId)}
        exportName="unit-pnl-checks" noun={['check', 'checks']} pageSize={50}
        toolbar={<FilterSelect label="Type" value={rule} all="All checks" onChange={setRule} className="w-[190px]"
          options={[{ value: 'gap', label: 'Data gaps' }, { value: 'own_past', label: RULE_TEXT.own_past }, { value: 'building', label: RULE_TEXT.building }, { value: 'limit', label: RULE_TEXT.limit }]} />}
        above={<p className="m-0 px-4 py-2 text-meta text-muted-ink">Data gaps say a month’s figures are incomplete (owned by operations or the reservations import). The other checks compare a unit with its last three months (more than 50% away), with its building’s median per night (more than 50% above, three units or more), and with your limits.</p>}
        empty={{ title: 'Nothing to look at.', body: 'No data gaps, and every figure is within the checks.' }} />
      <LimitsPanel limits={limits} onSaved={onSaved} />
    </div>
  );
}

function LimitsPanel({ limits, onSaved }: { limits: Limits; onSaved: () => void }) {
  const toast = useToast();
  const canEdit = useSession().user?.role === 'management';
  const [draft, setDraft] = useState(() => ({
    lines: Object.fromEntries(COST_KEYS.map(k => [k, { pct: limits.lines[k]?.pctMax?.toString() ?? '', night: limits.lines[k]?.perNightMax != null ? (limits.lines[k]!.perNightMax! / 100).toFixed(2) : '' }])) as Record<CostKey, { pct: string; night: string }>,
    margin: limits.marginMin?.toString() ?? '',
  }));
  const [busy, setBusy] = useState(false);
  const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
  async function save() {
    const body: Limits = { lines: {} };
    for (const k of COST_KEYS) {
      const pctMax = num(draft.lines[k].pct), night = num(draft.lines[k].night);
      if (pctMax !== undefined || night !== undefined) body.lines[k] = { ...(pctMax !== undefined ? { pctMax } : {}), ...(night !== undefined ? { perNightMax: Math.round(night * 100) } : {}) };
    }
    const m = num(draft.margin); if (m !== undefined) body.marginMin = m;
    setBusy(true);
    try { await api.put('/finance/unit-pnl-limits', body); toast({ tone: 'success', title: 'Limits saved.' }); onSaved(); }
    catch (e) { notifyFailure(e); } finally { setBusy(false); }
  }
  const input = 'h-9 w-[110px] px-2 text-right tabular-nums border border-solid border-line rounded-control bg-card text-copy disabled:bg-muted disabled:text-muted-ink';
  return (
    <Section title="Your limits" right={canEdit ? <Button size="sm" variant="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save limits'}</Button> : undefined}>
      <p className="m-0 text-meta text-muted-ink">{canEdit ? 'Leave a box empty for no limit. A unit and month over a limit shows on the checks above.' : 'Set by management. Empty means no limit.'}</p>
      <div className="overflow-x-auto">
        <table className="border-collapse text-copy">
          <thead><tr className="text-meta text-muted-ink">
            <th className="text-left px-2 py-1 font-semibold">Cost line</th><th className="text-right px-2 py-1 font-semibold">% of guest total, at most</th><th className="text-right px-2 py-1 font-semibold">RM per night, at most</th>
          </tr></thead>
          <tbody>
            {COST_KEYS.map(k => (
              <tr key={k}>
                <th scope="row" className="text-left px-2 py-1 font-normal whitespace-nowrap">{LINE_LABEL[k]}</th>
                <td className="px-2 py-1 text-right"><input aria-label={`${LINE_LABEL[k]}: percent of guest total at most`} inputMode="decimal" disabled={!canEdit} className={input}
                  value={draft.lines[k].pct} onChange={e => setDraft(d => ({ ...d, lines: { ...d.lines, [k]: { ...d.lines[k], pct: e.target.value } } }))} /></td>
                <td className="px-2 py-1 text-right"><input aria-label={`${LINE_LABEL[k]}: RM per night at most`} inputMode="decimal" disabled={!canEdit} className={input}
                  value={draft.lines[k].night} onChange={e => setDraft(d => ({ ...d, lines: { ...d.lines, [k]: { ...d.lines[k], night: e.target.value } } }))} /></td>
              </tr>
            ))}
            <tr className="[border-top:1px_solid_var(--color-line)]">
              <th scope="row" className="text-left px-2 py-1 font-semibold whitespace-nowrap">Operating margin, at least %</th>
              <td className="px-2 py-1 text-right"><input aria-label="Operating margin at least percent" inputMode="decimal" disabled={!canEdit} className={input}
                value={draft.margin} onChange={e => setDraft(d => ({ ...d, margin: e.target.value }))} /></td><td />
            </tr>
          </tbody>
        </table>
      </div>
    </Section>
  );
}
