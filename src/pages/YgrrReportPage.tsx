import { useMemo, type ReactElement } from 'react';
import { SectionCard } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { EmptyState } from '../components/States';
import { ListToolbar } from '../components/ListToolbar';
import { StatusBadge } from '../components/StatusBadge';
import { useApi } from '../lib/useApi';
import { todayMyt, monthLabel } from '../lib/format';
import { downloadTable, type ExportColumn } from '../lib/export';
import { cx } from '../lib/design-tokens';
import { bracketMoney } from '../lib/unitPnl';
import { monthCellsOf, standingOf, type YgrrMonthCell, type YgrrPayload, type YgrrRow, type YgrrStanding } from '../lib/ygrrReport';
import { useUrlState } from './finance/listKit';

const GRID = '[border-left:1px_solid_var(--color-line)]';
const HEAD = 'text-right px-3 py-2 whitespace-nowrap';
const CELL = 'text-right px-3 py-1.5 whitespace-nowrap';
const FIRST_YEAR = 2020;
const unitName = ({ building, number }: YgrrRow): string => `${building} ${number}`;
const lastFullMonthOf = (month: string): string => {
  const [year, monthNumber] = month.split('-').map(Number);
  return monthNumber === 1 ? `${year - 1}-12` : `${year}-${String(monthNumber - 1).padStart(2, '0')}`;
};
const yearRange = ({ yearFrom, yearTo }: YgrrRow): string => `${monthLabel(yearFrom)} to ${monthLabel(yearTo)}`;

function Money({ sen, isStrong }: { sen: number | null; isStrong?: boolean }): ReactElement {
  const { text, negative } = sen === null ? { text: '–', negative: false } : bracketMoney(sen);
  if (text === '–') return <span className="block text-center text-muted-ink">–</span>;
  return <span className={cx('tabular-nums', negative && 'text-danger', isStrong && 'font-semibold')}>{text}</span>;
}

function Pace({ aheadBy }: Pick<YgrrStanding, 'aheadBy'>): ReactElement {
  if (aheadBy === 0) return <StatusBadge tone="neutral" label="On pace" size="sm" />;
  const amount = bracketMoney(Math.abs(aheadBy)).text;
  return aheadBy > 0
    ? <StatusBadge tone="success" label={`Ahead ${amount}`} size="sm" />
    : <StatusBadge tone="warning" label={`Behind ${amount}`} size="sm" />;
}

function UnitsTable({ rows, month }: { rows: YgrrRow[]; month: string }): ReactElement {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-copy">
        <thead>
          <tr className="bg-muted text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink">
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
                  <span className="block whitespace-nowrap font-semibold leading-tight" title={unitName(row)}>{row.number}</span>
                  <span className="block text-meta text-muted-ink truncate max-w-[200px] leading-tight" title={row.owner}>{row.building} · {row.owner}</span>
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

function OverGuarantee({ sen }: { sen: number }): ReactElement {
  const amount = bracketMoney(Math.abs(sen)).text;
  if (!sen) return <span className="block text-caption text-muted-ink tabular-nums">±0.00</span>;
  return <span className={cx('block text-caption tabular-nums', sen > 0 ? 'text-success' : 'text-danger')}>{sen > 0 ? '+' : '−'}{amount}</span>;
}

function ShareCell({ cell }: { cell: YgrrMonthCell | undefined }): ReactElement {
  if (!cell) return <td className={cx(CELL, GRID)}><Money sen={null} /></td>;
  return (
    <td className={cx(CELL, GRID)}>
      <Money sen={cell.ownerShare} />
      <OverGuarantee sen={cell.overTargetSoFar} />
    </td>
  );
}

function MonthGrid({ rows, months }: { rows: YgrrRow[]; months: string[] }): ReactElement {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-copy">
        <thead>
          <tr className="bg-muted text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink">
            <th className="sticky left-0 z-[1] bg-muted text-left px-3 py-2 min-w-[170px]">Unit</th>
            <th className={cx(HEAD, GRID)}>Target / month</th>
            {months.map(month => <th key={month} className={cx(HEAD, GRID)}>{monthLabel(month)}</th>)}
            <th className={cx('text-left px-3 py-2 whitespace-nowrap', GRID)}>Pace</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const standing = standingOf(row);
            const cellByMonth = new Map(monthCellsOf(row).map(cell => [cell.month, cell]));
            return (
              <tr key={row.unitId} className="[border-top:1px_solid_var(--color-line)]">
                <td className="sticky left-0 bg-card px-3 py-1.5 whitespace-nowrap" title={unitName(row)}>
                  <span className="block font-semibold leading-tight">{row.number}</span>
                  <span className="block text-meta text-muted-ink leading-tight">{row.building}</span>
                </td>
                <td className={cx(CELL, GRID)}><Money sen={standing.guaranteedPerMonth} /></td>
                {months.map(month => <ShareCell key={month} cell={cellByMonth.get(month)} />)}
                <td className={cx('px-3 py-1.5 whitespace-nowrap', GRID)}><Pace aheadBy={standing.aheadBy} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function YgrrReportPage(): ReactElement {
  const url = useUrlState();
  const lastFullMonth = lastFullMonthOf(todayMyt().slice(0, 7));
  const latestYear = lastFullMonth.slice(0, 4);
  const yearOptions = useMemo(() => Array.from({ length: Number(latestYear) - FIRST_YEAR + 1 }, (_, offset) => {
    const value = String(Number(latestYear) - offset);
    return { value, label: value };
  }), [latestYear]);
  const year = yearOptions.some(({ value }) => value === url.get('year')) ? url.get('year') : latestYear;
  const month = year === latestYear ? lastFullMonth : `${year}-12`;
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
      <PageHeader title="YGRR report" sub="Package D (PS YGRR)"
        right={<Button size="sm" variant="secondary" icon={<Icon name="Download" size="sm" />} onClick={exportExcel} disabled={!rows.length}>Export</Button>} />
      <div className="flex flex-col gap-4">
        <ListToolbar
          search={{ value: url.get('q'), onChange: value => url.set({ q: value.trim() }), placeholder: 'Unit or owner', label: 'Search units' }}
          filters={[{ key: 'building', label: 'Building', value: building, onChange: value => url.set({ building: value }), allLabel: 'All buildings',
            options: buildings.map(b => ({ ...b, count: (data?.rows ?? []).filter(row => row.building === b.value).length })) }]}
          date={{ label: 'Year', value: year, onChange: value => url.set({ year: value === latestYear ? null : value }),
            presets: yearOptions.map(o => ({ ...o, sub: o.value === latestYear ? `To ${monthLabel(lastFullMonth)}` : undefined })) }}
          count={data ? <span className="tabular-nums">Showing {rows.length} of {data.rows.length} Package D units</span> : undefined}
        />
        {error && <StaleBanner message={data ? `Showing the last figures we have. ${error}` : error} onRetry={reload} />}
        {loading && !data ? <TableSkeleton rows={8} cols={7} />
          : !rows.length ? <EmptyState kind={building || search ? 'filtered' : 'empty'} title={`No Package D units in ${year}.`} />
          : <>
            <SectionCard title={`Units (${rows.length})`} note={`${behindCount} behind the pro-rata guarantee.`}>
              <UnitsTable rows={rows} month={month} />
            </SectionCard>
            <SectionCard title="Owner share month by month"
              note="Only months in each unit's current contract year are filled. Under each month: how far the year so far is above (+) or below (−) the target so far.">
              <MonthGrid rows={rows} months={data?.months ?? []} />
            </SectionCard>
          </>}
      </div>
    </>
  );
}
