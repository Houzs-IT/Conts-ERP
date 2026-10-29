import { useMemo, type ReactNode } from 'react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { EmptyState } from '../components/States';
import { Select } from '../components/Select';
import { useApi } from '../lib/useApi';
import { rm, todayMyt } from '../lib/format';
import { downloadTable, type ExportCell, type ExportColumn } from '../lib/export';
import { cx } from '../lib/design-tokens';
import { useUrlState, SearchBox, FilterSelect } from './finance/listKit';
import { BLOCKS, REPORT_RULES, pivot, rowTotal, type BlockGrid, type BlockKey, type YearlyRow } from '../lib/yearlyReport';
import { bracketMoney } from '../lib/unitPnl';

/** Reports > Yearly unit report (PLAN-yearly-report.md): the staff sheet "REPORT JAN-DEC". One grid per figure, units down
 *  and months across, with a Total column and an all-units row. Figures follow the Overall unit report; the cleaning
 *  grids add what The Conts pays cleaners. */
interface Unit { id: string; building: string; number: string; owner: string; contract: 'LT' | 'PS' }
interface Payload { year: string; months: string[]; units: Unit[]; rows: YearlyRow[]; notInGrid: number; unpricedCleans: number; excluded: number; toDate: string | null }

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const unitName = (u: Unit) => `${u.building} ${u.number}`;
const GRID = '[border-left:1px_solid_var(--color-line)]';

function Cell({ sen, strong }: { sen: number | null; strong?: boolean }) {
  if (sen === null) return <span className="text-muted-ink">–</span>;
  const b = bracketMoney(sen);
  return <span className={cx('tabular-nums', b.negative && 'text-danger', strong && 'font-semibold')}>{b.text}</span>;
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-solid border-line bg-card p-4 sm:p-5 flex flex-col gap-3 min-w-0">
      <div className="flex flex-col gap-1"><h2 className="m-0 text-[15px] font-semibold">{title}</h2>{note && <p className="m-0 text-meta text-muted-ink">{note}</p>}</div>
      {children}
    </section>
  );
}

function Grid({ grid, units, months, toDate }: { grid: BlockGrid; units: Unit[]; months: string[]; toDate: string | null }) {
  const listed = units.filter(u => grid.units[u.id]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-copy">
        <thead>
          <tr className="bg-muted text-meta font-semibold text-muted-ink">
            <th className="sticky left-0 z-[1] bg-muted text-left px-3 py-2 min-w-[190px]">Unit</th>
            {months.map((m, i) => <th key={m} className={cx('text-right px-3 py-2 whitespace-nowrap', GRID)}>{MONTH_NAMES[i]}{m === toDate ? ' (to date)' : ''}</th>)}
            <th className={cx('text-right px-3 py-2', GRID)}>Total</th>
          </tr>
        </thead>
        <tbody>
          {listed.map(u => (
            <tr key={u.id} className="[border-top:1px_solid_var(--color-line)]">
              <td className="sticky left-0 bg-card px-3 py-1.5 whitespace-nowrap">{unitName(u)}</td>
              {(grid.units[u.id] ?? []).map((v, i) => <td key={i} className={cx('text-right px-3 py-1.5', GRID)}><Cell sen={v} /></td>)}
              <td className={cx('text-right px-3 py-1.5', GRID)}><Cell sen={rowTotal(grid.units[u.id] ?? [])} strong /></td>
            </tr>
          ))}
          <tr className="[border-top:2px_solid_var(--color-line)] font-semibold">
            <td className="sticky left-0 bg-card px-3 py-2">All units</td>
            {grid.totals.map((v, i) => <td key={i} className={cx('text-right px-3 py-2', GRID)}><Cell sen={v} strong /></td>)}
            <td className={cx('text-right px-3 py-2', GRID)}><Cell sen={rowTotal(grid.totals)} strong /></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const BLOCK_NOTE: Partial<Record<BlockKey, string>> = {
  revenue: 'What the owner statement counts as income for the month.',
  gp: 'Earnings less cleaning, utilities, additional costs and the monthly misc charge.',
  payout: REPORT_RULES.ownerPayoutIncludesO2 ? 'The owner’s share, plus the owner’s credits and charges for the month.' : 'The owner’s share only.',
  company: 'Gross profit less the owner’s share: what The Conts keeps.',
  cleanerCost: 'What we pay the cleaners for finished cleaning jobs (their pay, not their invoices).',
  cleaningOwner: REPORT_RULES.ltOwnerPaysCleaning ? 'The cleaning on the owner statement.' : 'The cleaning on the owner statement. Fixed-rent units show nothing: the company carries their cleaning.',
  cleaningEarned: 'What The Conts charges the owner for cleaning, less what it pays the cleaners.',
};

export default function YearlyReportPage() {
  const url = useUrlState();
  const thisYear = Number(todayMyt().slice(0, 4));
  const year = String(Math.min(thisYear, Math.max(2020, Number(url.get('year')) || thisYear)));
  const building = url.get('building'), contract = url.get('contract'), q = url.get('q').trim().toLowerCase();
  const { data, loading, error, reload } = useApi<Payload>(`/reports/yearly?year=${year}`);

  const shown = useMemo(() => (data?.units ?? []).filter(u => (!building || u.building === building) && (!q || `${u.building} ${u.number} ${u.owner}`.toLowerCase().includes(q))), [data, building, q]);
  // The contract filter goes by each month's own contract, so a unit that changed contract keeps its other months.
  const rows = useMemo(() => {
    const ids = new Set(shown.map(u => u.id));
    return (data?.rows ?? []).filter(r => ids.has(r.unitId) && (!contract || r.contract === contract));
  }, [data, shown, contract]);
  const grids = useMemo(() => pivot(rows, data?.months ?? []), [rows, data]);
  const buildings = useMemo(() => [...new Set((data?.units ?? []).map(u => u.building))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).map(b => ({ value: b, label: b })), [data]);
  const years = Array.from({ length: Math.min(4, thisYear - 2019) }, (_, i) => String(thisYear - i));

  // One sheet, one row per unit and figure (the export writes a single table); the Report column filters it back into the sheet's blocks.
  function exportExcel() {
    const cols: ExportColumn[] = [{ label: 'Report', kind: 'text' }, { label: 'Building', kind: 'text' }, { label: 'Unit', kind: 'text' }, { label: 'Owner', kind: 'text' },
      ...MONTH_NAMES.map(m => ({ label: m, kind: 'money' as const })), { label: 'Total', kind: 'money' }];
    const out: ExportCell[][] = [];
    for (const g of grids) {
      for (const u of shown.filter(x => g.units[x.id])) out.push([g.label, u.building, u.number, u.owner, ...(g.units[u.id] ?? []), rowTotal(g.units[u.id] ?? [])]);
      out.push([g.label, 'All units', '', '', ...g.totals, rowTotal(g.totals)]);
    }
    downloadTable('xlsx', `yearly-unit-report-${year}`, `Yearly ${year}`, cols, out);
  }

  const notes: string[] = [];
  if (data?.excluded) notes.push(`${data.excluded} long-term let or master lease unit${data.excluded === 1 ? ' is' : 's are'} not listed.`);
  if (data?.notInGrid) notes.push(`${rm(data.notInGrid)} of cleaner pay is on units or months with no figures above, so it is not in the grids.`);
  if (data?.unpricedCleans) notes.push(`${data.unpricedCleans} finished clean${data.unpricedCleans === 1 ? ' has' : 's have'} no price, so the cleaner cost is left out until one is set.`);

  return (
    <>
      <PageHeader title="Yearly unit report" sub="Each unit month by month across the year: earnings, profit, owner payout, bills and cleaning."
        right={<Button size="sm" variant="secondary" icon={<Icon name="Download" size="sm" />} onClick={exportExcel} disabled={!rows.length}>Export to Excel</Button>} />
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select label="Year" value={year} onChange={v => url.set({ year: v === String(thisYear) ? null : v })} className="w-[130px]" options={years.map(y => ({ value: y, label: y }))} />
          <FilterSelect label="Building" value={building} all="All buildings" onChange={v => url.set({ building: v })} options={buildings} className="w-[200px]" />
          <FilterSelect label="Contract" value={contract} all="All contracts" onChange={v => url.set({ contract: v })}
            options={[{ value: 'PS', label: 'Profit share' }, { value: 'LT', label: 'Fixed rent' }]} className="w-[160px]" />
          <SearchBox value={url.get('q')} onChange={v => url.set({ q: v })} placeholder="Unit or owner" label="Search units" className="w-[200px]" />
        </div>
        {notes.length > 0 && <p className="m-0 text-meta text-muted-ink">{notes.join(' ')}</p>}
        {error && <StaleBanner message={data ? `Showing the last figures we have. ${error}` : error} onRetry={reload} />}
        {loading && !data ? <TableSkeleton rows={8} cols={7} />
          : !rows.length ? <EmptyState kind={building || contract || q ? 'filtered' : 'empty'} title="No figures for this year." />
          : BLOCKS.map(b => {
            const grid = grids.find(g => g.key === b.key);
            return grid && <Section key={b.key} title={b.label} note={BLOCK_NOTE[b.key]}><Grid grid={grid} units={shown} months={data?.months ?? []} toDate={data?.toDate ?? null} /></Section>;
          })}
      </div>
    </>
  );
}
