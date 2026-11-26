import { Fragment, useMemo } from 'react';
import { SectionCard } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { EmptyState } from '../components/States';
import { ListToolbar } from '../components/ListToolbar';
import { Segmented } from '../components/Metric';
import { ChoiceChips } from '../components/ChoiceChips';
import { useApi } from '../lib/useApi';
import { count, plural, rm, todayMyt, buildingName, personName } from '../lib/format';
import { downloadTable, type ExportCell, type ExportColumn } from '../lib/export';
import { cx } from '../lib/design-tokens';
import { useUrlState } from './finance/listKit';
import { BLOCKS, REPORT_RULES, pivot, rowTotal, type BlockGrid, type BlockKey, type Cells, type YearlyRow } from '../lib/yearlyReport';
import { GROUP_NAME, REPORT_GROUPS, reportWords, type ReportGroup, type ReportView } from '../lib/ownerOverall';
import { bracketMoney } from '../lib/unitPnl';

/** Unit report > Yearly (PLAN-yearly-report.md): the staff sheet "REPORT JAN-DEC". One grid per figure, units down and
 *  months across, with a Year column. Units are grouped by the same kinds as Monthly (owner, 19 Nov 2026), and each
 *  figure is named in that kind's words (reportWords); the cleaning grids add what The Conts pays cleaners. */
interface Unit { id: string; code: string; building: string; number: string; owner: string }
interface Payload { year: string; months: string[]; units: Unit[]; rows: YearlyRow[]; notInGrid: number; unpricedCleans: number; toDate: string | null }

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** The system's figures start in 2026 (the owner workbook's year), so earlier years would only show empty grids. */
const FIRST_YEAR = 2026;
const GRID = '[border-left:1px_solid_var(--color-line)]';
const CLEANING = ['cleanerCost', 'cleaningOwner', 'cleaningEarned'];

/** A figure's name in the kind's words: income, what is left and the company's part follow reportWords. */
function blockLabel(key: BlockKey, fallback: string, view: ReportView): string {
  const w = reportWords(view);
  if (key === 'revenue') return w.income;
  if (key === 'gp') return w.net;
  if (key === 'company') return w.company;
  if (key === 'payout') return view === 'LT' || view === 'RTR' ? 'Rent to owner' : 'Owner payout';
  return fallback;
}

function Cell({ sen, strong }: { sen: number | null; strong?: boolean }) {
  if (sen === null) return <span className="text-muted-ink">–</span>;
  const b = bracketMoney(sen);
  return <span className={cx('tabular-nums', b.negative && 'text-danger', strong && 'font-semibold')}>{b.text}</span>;
}

/** One kind's units in a grid, with its total row. A unit with nothing but zeros in this figure is not listed (a zero shows as a dash). */
interface Part { group: ReportGroup; grid: BlockGrid }
const listed = (grid: BlockGrid, units: Unit[]) => units.filter(u => (grid.units[u.id] ?? []).some(v => v !== null && v !== 0));
const codes = (rows: readonly YearlyRow[]) => {
  const m = new Map<string, string>();
  for (const r of rows) if (r.contractCode) m.set(r.unitId, r.contractCode);
  return m;
};

function Grid({ parts, units, months, toDate, showGroups, codeOf }: { parts: Part[]; units: Unit[]; months: string[]; toDate: string | null; showGroups: boolean; codeOf: Map<string, string> }) {
  const all: Cells = months.map((_, i) => parts.reduce<number | null>((n, p) => (p.grid.totals[i] === null ? n : (n ?? 0) + (p.grid.totals[i] ?? 0)), null));
  const head = 'text-right px-3 py-2 whitespace-nowrap';
  return (
    <div className="overflow-x-auto overscroll-x-contain">
      <table className="w-max min-w-full border-separate border-spacing-0 text-copy">
        <thead>
          <tr className="text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink">
            <th className="sticky left-0 z-[2] bg-muted text-left px-3 py-2 min-w-[210px] [border-bottom:1px_solid_var(--color-line)]">Unit</th>
            {months.map((m, i) => <th key={m} className={cx(head, GRID, 'bg-muted [border-bottom:1px_solid_var(--color-line)]')}>{MONTH_NAMES[i]}{m === toDate ? ' (to date)' : ''}</th>)}
            <th className={cx(head, GRID, 'bg-muted text-ink [border-bottom:1px_solid_var(--color-line)]')}>Year</th>
          </tr>
        </thead>
        <tbody>
          {parts.map(p => {
            const us = listed(p.grid, units);
            if (!us.length) return null;
            return (
              <Fragment key={p.group}>
                {showGroups && (
                  <tr><td colSpan={months.length + 2} className="sticky left-0 px-3 pt-2.5 pb-1.5 bg-sunken text-caption font-semibold uppercase tracking-[0.09em] text-muted-ink [border-bottom:1px_solid_var(--color-line)]">
                    {GROUP_NAME[p.group]} <span className="ml-1 normal-case tracking-normal font-normal">{plural(us.length, 'unit')}</span>
                  </td></tr>
                )}
                {us.map(u => (
                  <tr key={u.id}>
                    <td className="sticky left-0 z-[1] bg-card px-3 py-1.5 whitespace-nowrap [border-bottom:1px_solid_var(--color-line-soft)]" title={`${buildingName(u.building)} ${u.number} · ${personName(u.owner)}`}>
                      <span className="block font-semibold leading-tight">{u.code}</span>
                      <span className="block text-meta text-muted-ink leading-tight">{buildingName(u.building)}{codeOf.get(u.id) ? ` · ${codeOf.get(u.id)}` : ''}</span>
                    </td>
                    {(p.grid.units[u.id] ?? []).map((v, i) => <td key={i} className={cx('text-right px-3 py-1.5 [border-bottom:1px_solid_var(--color-line-soft)]', GRID)}><Cell sen={v} /></td>)}
                    <td className={cx('text-right px-3 py-1.5 [border-bottom:1px_solid_var(--color-line-soft)]', GRID)}><Cell sen={rowTotal(p.grid.units[u.id] ?? [])} strong /></td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="sticky left-0 z-[1] bg-muted px-3 py-2 text-caption uppercase tracking-[0.06em] text-muted-ink [border-bottom:1px_solid_var(--color-line)]">{showGroups ? `${GROUP_NAME[p.group]} total` : `All ${plural(us.length, 'unit')}`}</td>
                  {p.grid.totals.map((v, i) => <td key={i} className={cx('text-right px-3 py-2 bg-muted [border-bottom:1px_solid_var(--color-line)]', GRID)}><Cell sen={v} strong /></td>)}
                  <td className={cx('text-right px-3 py-2 bg-muted [border-bottom:1px_solid_var(--color-line)]', GRID)}><Cell sen={rowTotal(p.grid.totals)} strong /></td>
                </tr>
              </Fragment>
            );
          })}
          {showGroups && parts.filter(p => listed(p.grid, units).length).length > 1 && (
            <tr className="font-semibold">
              <td className="sticky left-0 z-[1] bg-muted px-3 py-2 text-caption uppercase tracking-[0.06em] text-ink">Grand total</td>
              {all.map((v, i) => <td key={i} className={cx('text-right px-3 py-2 bg-muted', GRID)}><Cell sen={v} strong /></td>)}
              <td className={cx('text-right px-3 py-2 bg-muted', GRID)}><Cell sen={rowTotal(all)} strong /></td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function blockNote(key: BlockKey, view: ReportView): string | undefined {
  const w = reportWords(view);
  switch (key) {
    case 'revenue': return view === 'all' ? 'What each unit brings in for the month: stays, and a rent to rent\'s rent from its tenant.' : `What the month brings in, as on Monthly.`;
    case 'gp': return `${w.income} less cleaning, utilities, additional deductions and the monthly misc charge.`;
    case 'payout': return REPORT_RULES.ownerPayoutIncludesO2 ? 'What the owner is paid: the share, the guarantee or the fixed rent, plus the owner\'s credits and charges (O2).' : 'What the owner is paid, before O2.';
    case 'company': return `${w.net} less what the owner is paid (before O2), plus any late changes below: what The Conts keeps.`;
    case 'late': return 'The company\'s share of changes to an earlier month after its income or deductions were locked, counted in the month the owner\'s share went to.';
    case 'cleanerCost': return 'What we pay the cleaners for finished cleaning jobs (their pay, not their invoices).';
    case 'cleaningOwner': return 'The cleaning on the owner statement. Long term and rent to rent units show nothing: the company carries their cleaning.';
    case 'cleaningEarned': return 'What The Conts charges the owner for cleaning, less what it pays the cleaners.';
    default: return undefined;
  }
}

export default function YearlyReportPage() {
  const url = useUrlState();
  const thisYear = Number(todayMyt().slice(0, 4));
  const year = String(Math.min(thisYear, Math.max(FIRST_YEAR, Number(url.get('year')) || thisYear)));
  const report = url.get('report') || 'all', building = url.get('building'), q = url.get('q').trim().toLowerCase();
  const kind = (url.get('kind') || 'all') as ReportView;
  const { data, loading, error, reload } = useApi<Payload>(`/finance/yearly-report?year=${year}`);

  const shown = useMemo(() => (data?.units ?? []).filter(u => (!building || u.building === building) && (!q || `${u.code} ${u.building} ${u.number} ${u.owner}`.toLowerCase().includes(q))), [data, building, q]);
  const shownRows = useMemo(() => { const ids = new Set(shown.map(u => u.id)); return (data?.rows ?? []).filter(r => ids.has(r.unitId)); }, [data, shown]);
  // The kind goes by each month's own contract, so a unit that changed contract keeps its other months under the other kind.
  const rows = useMemo(() => shownRows.filter(r => kind === 'all' || r.group === kind), [shownRows, kind]);
  const unitsOf = (g: ReportGroup) => new Set(shownRows.filter(r => r.group === g).map(r => r.unitId)).size;
  const present = REPORT_GROUPS.filter(g => (data?.rows ?? []).some(r => r.group === g));
  const groups = (kind === 'all' ? present : [kind as ReportGroup]).filter(g => rows.some(r => r.group === g));
  const months = data?.months ?? [];
  const byGroup = useMemo(() => new Map(groups.map(g => [g, pivot(rows.filter(r => r.group === g), months)])), [rows, months, groups.join()]);
  const codeOf = useMemo(() => codes(data?.rows ?? []), [data]);
  const buildings = useMemo(() => [...new Set((data?.units ?? []).map(u => u.building))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).map(b => ({ value: b, label: buildingName(b) })), [data]);
  const years = Array.from({ length: thisYear - FIRST_YEAR + 1 }, (_, i) => String(thisYear - i));
  const blocks = BLOCKS.filter(b => b.key !== 'late' || rows.some(r => (r.late ?? 0) !== 0));
  const shows = (key: string) => report === 'all' || report === key || (report === 'cleaning' && CLEANING.includes(key));
  const reportOptions = [{ value: 'all', label: 'All reports' },
    ...blocks.filter(b => !CLEANING.includes(b.key)).map(b => ({ value: b.key, label: blockLabel(b.key, b.label, kind) })),
    { value: 'cleaning', label: 'Cleaning' }];

  // One sheet, one row per unit and figure; the Report and Kind columns filter it back into the blocks.
  function exportExcel() {
    const cols: ExportColumn[] = [{ label: 'Report', kind: 'text' }, { label: 'Kind', kind: 'text' }, { label: 'Unit', kind: 'text' }, { label: 'Building', kind: 'text' }, { label: 'Owner', kind: 'text' },
      ...MONTH_NAMES.map(m => ({ label: m, kind: 'money' as const })), { label: 'Year', kind: 'money' }];
    const out: ExportCell[][] = [];
    for (const b of blocks.filter(x => shows(x.key))) {
      for (const g of groups) {
        const grid = byGroup.get(g)?.find(x => x.key === b.key);
        if (!grid) continue;
        const label = blockLabel(b.key, b.label, g);
        for (const u of listed(grid, shown)) out.push([label, GROUP_NAME[g], u.code, u.building, u.owner, ...(grid.units[u.id] ?? []), rowTotal(grid.units[u.id] ?? [])]);
        out.push([label, GROUP_NAME[g], `${GROUP_NAME[g]} total`, '', '', ...grid.totals, rowTotal(grid.totals)]);
      }
    }
    downloadTable('xlsx', `yearly-unit-report-${year}`, `Yearly ${year}`, cols, out);
  }

  const notes: string[] = [];
  if (present.includes('MANAGE') && (kind === 'all' || kind === 'MANAGE')) notes.push('Listing management reservations are not kept in the system, so their income reads 0.');
  if (present.includes('NONE') && (kind === 'all' || kind === 'NONE')) notes.push('No contract: the unit has no contract for the month yet, so everything left shows as the owner\'s until one is added.');
  if (data?.notInGrid) notes.push(`${rm(data.notInGrid)} of cleaner pay is on units or months with no figures above, so it is not in the grids.`);
  if (data?.unpricedCleans) notes.push(`${count(data.unpricedCleans)} finished clean${data.unpricedCleans === 1 ? ' has' : 's have'} no price on its day, so its cleaner pay is left out.`);

  return (
    <>
      <PageHeader title="Unit report" sub="Each unit month by month across the year, by contract kind, in that kind's own figures."
        right={<Button size="sm" variant="secondary" icon={<Icon name="Download" size="sm" />} onClick={exportExcel} disabled={!rows.length}>Export</Button>} />
      <div className="flex flex-col gap-4">
        <ListToolbar
          search={{ value: url.get('q'), onChange: v => url.set({ q: v.trim() }), placeholder: 'Unit or owner', label: 'Search units' }}
          filters={[{ key: 'building', label: 'Building', value: building, onChange: v => url.set({ building: v }), allLabel: 'All buildings',
            options: buildings.map(b => ({ ...b, count: (data?.units ?? []).filter(u => u.building === b.value).length })) }]}
          date={{ label: 'Year', value: year, onChange: v => url.set({ year: v === String(thisYear) ? null : v }), presets: years.map(y => ({ value: y, label: y, sub: y === String(thisYear) ? 'This year' : undefined })) }}
          after={<Segmented label="Contract kind" value={kind} onChange={v => url.set({ kind: v === 'all' ? null : v, report: null })}
            options={[{ key: 'all' as ReportView, label: 'All', count: shown.length }, ...present.map(g => ({ key: g as ReportView, label: GROUP_NAME[g], count: unitsOf(g) }))]} />}
          below={<ChoiceChips label="Report" value={report} onChange={v => url.set({ report: v === 'all' ? null : v })} options={reportOptions} />}
          count={data ? <span className="tabular-nums">Showing {count(new Set(rows.map(r => r.unitId)).size)} of {plural(data.units.length, 'unit')} · {year}</span> : undefined}
        />
        {notes.length > 0 && <p className="m-0 text-meta text-muted-ink">{notes.join(' ')}</p>}
        {error && <StaleBanner message={data ? `Showing the last figures we have. ${error}` : error} onRetry={reload} />}
        {loading && !data ? <TableSkeleton rows={8} cols={7} />
          : !rows.length ? <EmptyState kind={building || kind !== 'all' || q ? 'filtered' : 'empty'} title="No figures for this year." />
          : blocks.filter(b => shows(b.key)).map(b => {
            const parts = groups.map(g => ({ group: g, grid: byGroup.get(g)?.find(x => x.key === b.key) })).filter((p): p is Part => !!p.grid);
            if (!parts.some(p => listed(p.grid, shown).length)) return null;
            return (
              <SectionCard key={b.key} title={blockLabel(b.key, b.label, kind)} note={blockNote(b.key, kind)}>
                <Grid parts={parts} units={shown} months={months} toDate={data?.toDate ?? null} showGroups={kind === 'all'} codeOf={codeOf} />
              </SectionCard>
            );
          })}
      </div>
    </>
  );
}
