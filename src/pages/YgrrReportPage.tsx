import { useMemo, type ReactElement } from 'react';
import { SectionCard } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { EmptyState } from '../components/States';
import { Select } from '../components/Select';
import { StatusBadge } from '../components/StatusBadge';
import { useApi } from '../lib/useApi';
import { rm, todayMyt, monthLabel } from '../lib/format';
import { downloadTable, type ExportColumn } from '../lib/export';
import { cx } from '../lib/design-tokens';
import { bracketMoney } from '../lib/unitPnl';
import { MODEL } from '../lib/revenueModel';
import { useContractTypes } from '../lib/useContractTypes';
import { standingOf, type YgrrPayload, type YgrrRow, type YgrrStanding } from '../lib/ygrrReport';
import { useUrlState, SearchBox, FilterSelect } from './finance/listKit';

const GRID = '[border-left:1px_solid_var(--color-line)]';
const HEAD = 'text-right px-3 py-2 whitespace-nowrap';
const CELL = 'text-right px-3 py-1.5 whitespace-nowrap';
const unitName = ({ building, number }: YgrrRow): string => `${building} ${number}`;
const yearRange = ({ yearFrom, yearTo }: YgrrRow): string => `${monthLabel(yearFrom)} to ${monthLabel(yearTo)}`;

function Money({ sen, isStrong }: { sen: number | null; isStrong?: boolean }): ReactElement {
  if (sen === null) return <span className="text-muted-ink">–</span>;
  const { text, negative } = bracketMoney(sen);
  return <span className={cx('tabular-nums', negative && 'text-danger', isStrong && 'font-semibold')}>{text}</span>;
}

function Pace({ aheadBy }: Pick<YgrrStanding, 'aheadBy'>): ReactElement {
  if (aheadBy === 0) return <StatusBadge tone="neutral" label="On pace" size="sm" />;
  const amount = bracketMoney(Math.abs(aheadBy)).text;
  return aheadBy > 0
    ? <StatusBadge tone="success" label={`Ahead ${amount}`} size="sm" />
    : <StatusBadge tone="warning" label={`Behind ${amount}`} size="sm" />;
}

function PackagesTable(): ReactElement {
  const types = useContractTypes();
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-copy">
        <thead>
          <tr className="bg-muted text-meta font-semibold text-muted-ink">
            <th className="text-left px-3 py-2 whitespace-nowrap">Package</th>
            <th className="text-left px-3 py-2 whitespace-nowrap">Code</th>
            <th className="text-left px-3 py-2 min-w-[180px]">Name</th>
            <th className="text-left px-3 py-2 min-w-[280px]">How the owner is paid</th>
          </tr>
        </thead>
        <tbody>
          {types.filter(({ isActive }) => isActive).map(({ code, label, package: pkg, revenueModel }) => (
            <tr key={code} className={cx('[border-top:1px_solid_var(--color-line)] align-top', revenueModel === 'management_yearly_guarantee' && 'bg-gold-tint')}>
              <td className="px-3 py-2 whitespace-nowrap font-semibold">{pkg ?? '–'}</td>
              <td className="px-3 py-2 whitespace-nowrap">{code}</td>
              <td className="px-3 py-2">{label}</td>
              <td className="px-3 py-2 text-muted-ink">{MODEL[revenueModel].statement}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FormulaSteps({ example }: { example: YgrrRow | undefined }): ReactElement {
  const standing = example && standingOf(example);
  return (
    <div className="flex flex-col gap-3 text-copy">
      <ol className="m-0 pl-5 flex flex-col gap-1.5">
        <li><b>Every month</b> the owner gets a plain split: (income less owner-paid costs) × owner %. There is no monthly minimum.</li>
        <li><b>The contract year</b> is 12 months from the contract&apos;s start month. Each year has its own guarantee.</li>
        <li><b>On the last month of the contract year</b> the owner&apos;s monthly shares for the year are added up.</li>
        <li><b>If the year&apos;s shares are less than the guarantee</b>, The Conts tops up the difference on that month&apos;s statement. If they are more, nothing is added.</li>
        <li><b>A contract that ends inside the year</b> gets the guarantee for the months it ran: yearly guarantee × months ÷ 12.</li>
      </ol>
      <p className="m-0 text-meta text-muted-ink">The monthly figure saved on these contracts (yearly guarantee ÷ 12) is for reference only. It is never paid month by month.</p>
      {example && standing && (
        <div className="rounded-control bg-muted px-3 py-2.5 text-meta flex flex-col gap-1">
          <span className="font-semibold text-copy">Example: {unitName(example)}</span>
          <span>Guarantee {rm(example.due)} for {yearRange(example)} ({standing.monthsInYear} months).</span>
          <span>Owner shares so far: {rm(standing.sharesSoFar)} over {standing.monthsCounted} {standing.monthsCounted === 1 ? 'month' : 'months'}.
            Pro-rata guarantee to date: {rm(example.due)} × {standing.monthsCounted} ÷ {standing.monthsInYear} = {rm(standing.paceDue)}.</span>
          <span>If the year closed now, the top-up would be {rm(example.due)} − {rm(standing.sharesSoFar)} = <b>{rm(standing.shortOfYear)}</b>.</span>
        </div>
      )}
    </div>
  );
}

function UnitsTable({ rows, month }: { rows: YgrrRow[]; month: string }): ReactElement {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-copy">
        <thead>
          <tr className="bg-muted text-meta font-semibold text-muted-ink">
            <th className="sticky left-0 z-[1] bg-muted text-left px-3 py-2 min-w-[170px]">Unit</th>
            <th className={cx('text-left px-3 py-2 whitespace-nowrap', GRID)}>Contract year</th>
            <th className={cx(HEAD, GRID)}>Owner %</th>
            <th className={cx(HEAD, GRID)}>Guarantee</th>
            <th className={cx(HEAD, GRID)}>Shares so far</th>
            <th className={cx(HEAD, GRID)}>Pro-rata to date</th>
            <th className={cx('text-left px-3 py-2 whitespace-nowrap', GRID)}>Pace</th>
            <th className={cx(HEAD, GRID)}>Short of year</th>
            <th className={cx(HEAD, GRID)}>Top-up</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const standing = standingOf(row);
            return (
              <tr key={row.unitId} className="[border-top:1px_solid_var(--color-line)]">
                <td className="sticky left-0 bg-card px-3 py-1.5">
                  <span className="block whitespace-nowrap font-medium">{unitName(row)}</span>
                  <span className="block text-caption text-muted-ink truncate max-w-[200px]" title={row.owner}>{row.owner}</span>
                </td>
                <td className={cx('px-3 py-1.5 whitespace-nowrap', GRID)}>
                  {yearRange(row)}
                  <span className="block text-caption text-muted-ink">Month {standing.monthsCounted} of {standing.monthsInYear}</span>
                </td>
                <td className={cx(CELL, GRID, 'tabular-nums')}>{row.ownerPct}%</td>
                <td className={cx(CELL, GRID)}><Money sen={row.due} /></td>
                <td className={cx(CELL, GRID)}><Money sen={standing.sharesSoFar} isStrong /></td>
                <td className={cx(CELL, GRID)}><Money sen={standing.paceDue} /></td>
                <td className={cx('px-3 py-1.5 whitespace-nowrap', GRID)}><Pace aheadBy={standing.aheadBy} /></td>
                <td className={cx(CELL, GRID)}><Money sen={standing.shortOfYear} /></td>
                <td className={cx(CELL, GRID)}>{row.topUp ? <Money sen={row.topUp} isStrong />
                  : <span className="text-caption text-muted-ink">{month === row.yearTo ? 'None needed' : monthLabel(row.yearTo)}</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MonthGrid({ rows, months, thisMonth }: { rows: YgrrRow[]; months: string[]; thisMonth: string }): ReactElement {
  const shareIn = (row: YgrrRow, month: string): number | null => row.shares.find(share => share.month === month)?.ownerShare ?? null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-copy">
        <thead>
          <tr className="bg-muted text-meta font-semibold text-muted-ink">
            <th className="sticky left-0 z-[1] bg-muted text-left px-3 py-2 min-w-[170px]">Unit</th>
            {months.map(month => <th key={month} className={cx(HEAD, GRID)}>{monthLabel(month)}{month === thisMonth ? ' (to date)' : ''}</th>)}
            <th className={cx(HEAD, GRID)}>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.unitId} className="[border-top:1px_solid_var(--color-line)]">
              <td className="sticky left-0 bg-card px-3 py-1.5 whitespace-nowrap">{unitName(row)}</td>
              {months.map(month => <td key={month} className={cx(CELL, GRID)}><Money sen={shareIn(row, month)} /></td>)}
              <td className={cx(CELL, GRID)}><Money sen={standingOf(row).sharesSoFar} isStrong /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function YgrrReportPage(): ReactElement {
  const url = useUrlState();
  const thisMonth = todayMyt().slice(0, 7);
  const monthOptions = useMemo(() => Array.from({ length: 12 }, (_, i) => {
    const [year, monthNumber] = thisMonth.split('-').map(Number);
    const index = year * 12 + monthNumber - 1 - i;
    const value = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
    return { value, label: monthLabel(value, { long: true }) };
  }), [thisMonth]);
  const lastFullMonth = monthOptions[1].value;
  const month = monthOptions.some(({ value }) => value === url.get('month')) ? url.get('month') : lastFullMonth;
  const building = url.get('building'), search = url.get('q').trim().toLowerCase();
  const { data, loading, error, reload } = useApi<YgrrPayload>(`/finance/ygrr-report?month=${month}`);

  const rows = useMemo(() => (data?.rows ?? []).filter(row => (!building || row.building === building)
    && (!search || `${row.building} ${row.number} ${row.owner}`.toLowerCase().includes(search))), [data, building, search]);
  const buildings = useMemo(() => [...new Set((data?.rows ?? []).map(row => row.building))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map(name => ({ value: name, label: name })), [data]);
  const behindCount = rows.filter(row => standingOf(row).aheadBy < 0).length;

  function exportExcel(): void {
    const columns: ExportColumn[] = [
      { label: 'Building', kind: 'text' }, { label: 'Unit', kind: 'text' }, { label: 'Owner', kind: 'text' }, { label: 'Owner %', kind: 'text' },
      { label: 'Year from', kind: 'text' }, { label: 'Year to', kind: 'text' }, { label: 'Guarantee', kind: 'money' }, { label: 'Shares so far', kind: 'money' },
      { label: 'Pro-rata to date', kind: 'money' }, { label: 'Ahead / behind', kind: 'money' }, { label: 'Short of year', kind: 'money' }, { label: 'Top-up', kind: 'money' },
    ];
    const cells = rows.map(row => {
      const standing = standingOf(row);
      return [row.building, row.number, row.owner, `${row.ownerPct}%`, row.yearFrom, row.yearTo, row.due, standing.sharesSoFar,
        standing.paceDue, standing.aheadBy, standing.shortOfYear, row.topUp];
    });
    downloadTable('xlsx', `ygrr-report-${month}`, `YGRR ${month}`, columns, cells);
  }

  return (
    <>
      <PageHeader title="YGRR report" sub="Package D (PS YGRR): profit sharing with a yearly guarantee. Each unit's owner shares this contract year against its guarantee."
        right={<Button size="sm" variant="secondary" icon={<Icon name="Download" size="sm" />} onClick={exportExcel} disabled={!rows.length}>Export</Button>} />
      <div className="flex flex-col gap-4">
        <SectionCard title="Profit sharing packages" note="The contract types staff keep on Unit settings. Package D is the one this report follows.">
          <PackagesTable />
        </SectionCard>
        <SectionCard title="How Package D is worked out" note="The same rule the owner statement uses.">
          <FormulaSteps example={data?.rows[0]} />
        </SectionCard>
        <div className="flex flex-wrap items-center gap-2">
          <Select label="Month" value={month} onChange={value => url.set({ month: value === lastFullMonth ? null : value })} className="w-[180px]" options={monthOptions} />
          <FilterSelect label="Building" value={building} all="All buildings" onChange={value => url.set({ building: value })} options={buildings} className="w-[200px]" />
          <SearchBox value={url.get('q')} onChange={value => url.set({ q: value })} placeholder="Unit or owner" label="Search units" className="w-[200px]" />
        </div>
        {error && <StaleBanner message={data ? `Showing the last figures we have. ${error}` : error} onRetry={reload} />}
        {loading && !data ? <TableSkeleton rows={8} cols={7} />
          : !rows.length ? <EmptyState kind={building || search ? 'filtered' : 'empty'} title="No Package D units for this month." />
          : <>
            <SectionCard title={`Units on Package D (${rows.length})`}
              note={`As of ${monthLabel(month, { long: true })}${month === thisMonth ? ', month to date' : ''}. ${behindCount} behind the pro-rata guarantee. A top-up shows only on the last month of a contract year.`}>
              <UnitsTable rows={rows} month={month} />
            </SectionCard>
            <SectionCard title="Owner share month by month" note="Only the months of each unit's current contract year are filled.">
              <MonthGrid rows={rows} months={data?.months ?? []} thisMonth={thisMonth} />
            </SectionCard>
          </>}
      </div>
    </>
  );
}
