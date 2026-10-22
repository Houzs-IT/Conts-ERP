import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { StatTile, StatRow, Segmented, Eyebrow } from '../components/Metric';
import { Select } from '../components/Select';
import { NumberInput } from '../components/inputs';
import { Drawer } from '../components/Dialog';
import { EmptyState } from '../components/States';
import Icon from '../components/Icon';
import { TableSkeleton } from '../components/DataState';
import { SearchBox } from './finance/listKit';
import { useApi } from '../lib/useApi';
import { useMedia } from '../lib/useMedia';
import { cx } from '../lib/design-tokens';
import { count, monthLabel, percent, plural, rmShort, todayMyt } from '../lib/format';
import { overallFigures, overallTotals, type OverallInput, type OverallTotals } from '../lib/ownerOverall';
import { GainLoss, LEVELS, OwnerOverallDetail, contractName, money, unitStatus, type Level, type ReportRow } from './OwnerOverallDetail';

/** #/portfolio/owner-report — the overall owner report (the owner workbook's overall report sheet) for one month: every LT and PS
 *  unit's revenue, deductions, owner payout and the company's gain or loss on it, from GET /api/portfolio/owner-report.
 *  The whole month is about a row per unit, so search, filters and sorting happen here. */

interface ApiRow extends OverallInput { unitId: string; code: string; building: string; ownerName: string }
interface Payload { month: string; excluded: number; rows: ApiRow[]; generatedAt: string }

type Group = 'inc' | 'ded' | 'pro' | 'pay' | 'res';
type Kind = 'money' | 'occ' | 'int' | 'ownpct' | 'gl';
type Key = Exclude<keyof OverallTotals, 'units' | 'losing'> | 'ownerPct';
interface Col { key: Key; label: string; level: Level; group: Group; kind: Kind }

const GROUP_LABEL: Record<Group, string> = { inc: 'Income', ded: 'Deductions', pro: 'Profit', pay: 'Owner payout', res: 'Result' };
/** Income reads green, deductions red, the owner's money blue (owner, Oct 2026); profit and result stay ink. */
const GROUP_TONE: Partial<Record<Group, string>> = { inc: 'text-success', ded: 'text-danger', pay: 'text-info' };
const COLS: Col[] = [
  { key: 'occupancy', label: 'Occupancy', level: 1, group: 'inc', kind: 'occ' },
  { key: 'nights', label: 'Nights', level: 2, group: 'inc', kind: 'int' },
  { key: 'revenue', label: 'Total revenue', level: 1, group: 'inc', kind: 'money' },
  { key: 'revPerNight', label: 'Rev / night', level: 2, group: 'inc', kind: 'money' },
  { key: 'cleaning', label: 'Cleaning', level: 1, group: 'ded', kind: 'money' },
  { key: 'electricity', label: 'Electricity', level: 2, group: 'ded', kind: 'money' },
  { key: 'water', label: 'Water', level: 2, group: 'ded', kind: 'money' },
  { key: 'internet', label: 'Internet', level: 2, group: 'ded', kind: 'money' },
  { key: 'sewerage', label: 'Indah Water', level: 2, group: 'ded', kind: 'money' },
  { key: 'utilities', label: 'Utilities', level: 1, group: 'ded', kind: 'money' },
  { key: 'additional', label: 'Add. ded.', level: 1, group: 'ded', kind: 'money' },
  { key: 'misc', label: 'Misc', level: 1, group: 'ded', kind: 'money' },
  { key: 'deductions', label: 'Total deduction', level: 1, group: 'ded', kind: 'money' },
  { key: 'gp', label: 'GP', level: 1, group: 'pro', kind: 'money' },
  { key: 'ownerPct', label: 'Owner %', level: 1, group: 'pay', kind: 'ownpct' },
  { key: 'ltGrr', label: 'LT / GRR', level: 1, group: 'pay', kind: 'money' },
  { key: 'o1', label: 'O1', level: 1, group: 'pay', kind: 'money' },
  { key: 'o2', label: 'O2', level: 1, group: 'pay', kind: 'money' },
  { key: 'payout', label: 'Owner payout', level: 1, group: 'pay', kind: 'money' },
  { key: 'gainLoss', label: 'Gain / Loss', level: 1, group: 'res', kind: 'gl' },
];
const colOf = (key: string) => COLS.find(c => c.key === key) ?? COLS[0];
/** Money is typed in ringgit; everything else as it is shown (percent, nights). */
const inSen = (c: Col) => c.kind === 'money' || c.kind === 'gl';

type Contract = 'all' | 'LT' | 'PS';
type Quick = 'losing' | 'gaining' | 'vacant' | null;
type Sort = { key: Key | 'code'; dir: 1 | -1 } | null;

const LEVEL_KEY = 'ownerOverall.level';
function readLevel(): Level {
  try { return localStorage.getItem(LEVEL_KEY) === '2' ? 2 : 1; } catch { return 1; }
}

/** The last twelve months, newest first; last month (the latest complete one) is the default. */
function monthOptions() {
  const t = todayMyt();
  let y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
  return Array.from({ length: 13 }, () => {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    m--; if (!m) { m = 12; y--; }
    return { value: key, label: monthLabel(key, { long: true }) };
  });
}

const CELL = 'px-2 sm:px-3 py-2 whitespace-nowrap align-middle';
const DIVIDER = '[border-left:1px_solid_var(--color-line)]';
const UNIT_EDGE = 'sticky left-0 z-[1] [border-right:1px_solid_var(--color-line)]';
/** A selected row's tint over the card colour, so the sticky Unit cell stays solid in the dark theme too. */
/** A row's keyboard focus, drawn on its cells: an outline on the row itself is painted under their backgrounds. */
const FOCUS = 'group-focus-visible:shadow-[inset_0_2px_0_var(--color-gold),inset_0_-2px_0_var(--color-gold)]';
const FOCUS_FIRST = 'group-focus-visible:shadow-[inset_2px_0_0_var(--color-gold),inset_0_2px_0_var(--color-gold),inset_0_-2px_0_var(--color-gold)]';
const FOCUS_LAST = 'group-focus-visible:shadow-[inset_-2px_0_0_var(--color-gold),inset_0_2px_0_var(--color-gold),inset_0_-2px_0_var(--color-gold)]';
const SELECTED_BG ='[background:linear-gradient(var(--color-gold-tint),var(--color-gold-tint)),var(--color-card)]';
/** Wide screens: the unit panel runs the full height on the right and the page narrows beside it (panel width, less the
 *  main area's own 28px right padding, plus a 16px gap) instead of being covered. */
const PANEL = 440;
const PANEL_ROOM = PANEL - 28 + 16;

function Value({ c, v }: { c: Col; v: number }) {
  const dash = <span className="text-faint">—</span>;
  // A negative figure stays red whatever its group (an O2 charge, a loss-making GP).
  const tone = v < 0 ? 'text-danger' : GROUP_TONE[c.group];
  switch (c.kind) {
    case 'gl': return <GainLoss sen={v} />;
    case 'occ': return v ? (
      <span className="inline-flex items-center justify-center gap-2">
        <span aria-hidden className="h-1 w-10 rounded-full bg-muted overflow-hidden"><span className="block h-full bg-line-strong" style={{ width: `${Math.min(v, 100)}%` }} /></span>
        <span className={cx('tabular-nums', tone)}>{percent(v)}</span>
      </span>) : dash;
    case 'int': return v ? <span className={cx('tabular-nums', tone)}>{count(v)}</span> : dash;
    case 'ownpct': return v ? <span className={cx('tabular-nums', tone)}>{v}%</span> : dash;
    default: return v ? <span className={cx('tabular-nums', tone)}>{money(v)}</span> : dash;
  }
}

export default function OwnerOverallReportPage() {
  const MONTHS = useMemo(monthOptions, []);
  const [params, setParams] = useSearchParams();
  const month = MONTHS.some(o => o.value === params.get('month')) ? params.get('month')! : MONTHS[1].value;
  const { data, loading, error, reload } = useApi<Payload>(`/portfolio/owner-report?month=${month}`);

  const [q, setQ] = useState('');
  const [contract, setContract] = useState<Contract>('all');
  const [level, setLevelState] = useState<Level>(readLevel);
  const [rangeKey, setRangeKey] = useState<Key>('gainLoss');
  const [lo, setLo] = useState<number | null>(null);
  const [hi, setHi] = useState<number | null>(null);
  const [quick, setQuick] = useState<Quick>(null);
  const [sort, setSort] = useState<Sort>(null);
  const [selected, setSelected] = useState<string | null>(null);

  // Below this the app's own menu leaves too little room for the page beside the panel, so the panel slides over it.
  // At 1440px a docked panel left the table three rows tall under the KPI strip and the filters.
  const wide = useMedia('(min-width: 1600px)');
  const phone = useMedia('(max-width: 639.98px)');
  const [panelTop, setPanelTop] = useState(0);

  const setLevel = useCallback((l: Level) => {
    setLevelState(l);
    try { localStorage.setItem(LEVEL_KEY, String(l)); } catch { /* private window: the level just isn't remembered */ }
  }, []);

  const all = useMemo<ReportRow[]>(() => (data?.rows ?? []).map(({ unitId, code, building, ownerName, ...input }) =>
    ({ ...overallFigures(input), unitId, code, building, ownerName })), [data]);

  const range = colOf(rangeKey);
  const shownValue = (r: ReportRow) => (inSen(range) ? r[range.key] / 100 : r[range.key]);
  const extent = useMemo(() => {
    if (!all.length) return null;
    const vs = all.map(shownValue);
    return { min: Math.min(...vs), max: Math.max(...vs) };
  }, [all, rangeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = all.filter(r => (contract === 'all' || r.contract === contract)
      && (!needle || r.code.toLowerCase().includes(needle) || r.building.toLowerCase().includes(needle))
      && (lo === null || shownValue(r) >= lo) && (hi === null || shownValue(r) <= hi)
      && (quick !== 'losing' || r.gainLoss < 0) && (quick !== 'gaining' || r.gainLoss >= 0) && (quick !== 'vacant' || r.nights === 0));
    const byCode = (a: ReportRow, b: ReportRow) => a.code.localeCompare(b.code, 'en', { numeric: true });
    if (!sort) return list.sort(byCode);
    const { key, dir } = sort;
    return list.sort((a, b) => (key === 'code' ? byCode(a, b) : a[key] - b[key] || byCode(a, b)) * dir);
  }, [all, q, contract, lo, hi, quick, sort, rangeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = (['LT', 'PS'] as const).map(c => ({ contract: c, rows: filtered.filter(r => r.contract === c) })).filter(g => g.rows.length);
  // Previous / next follow the table as shown: long term first, then profit sharing, each in the current sort.
  const order = groups.flatMap(g => g.rows);
  const at = order.findIndex(r => r.unitId === selected);
  const row = at >= 0 ? order[at] : null;
  const totals = overallTotals(filtered);
  const cols = COLS.filter(c => c.level <= level);
  const groupStart = (i: number) => i > 0 && cols[i - 1].group !== cols[i].group;
  // The band header: one cell per run of columns in the same group.
  const bands: { group: Group; span: number }[] = [];
  for (const c of cols) { const last = bands[bands.length - 1]; if (last?.group === c.group) last.span++; else bands.push({ group: c.group, span: 1 }); }

  const step = useCallback((by: -1 | 1) => {
    const next = order[at + by];
    if (!next) return;
    setSelected(next.unitId);
    document.querySelector(`[data-unit-row="${next.unitId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [order, at]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || t?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === '1' || e.key === '2') { setLevel(Number(e.key) as Level); return; }
      if (!row) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); step(e.key === 'ArrowDown' ? 1 : -1); }
      else if (e.key === 'Escape' && wide) setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [row, step, wide, setLevel]);

  function toggleSort(key: Key | 'code') {
    setSort(s => (s?.key !== key ? { key, dir: -1 } : s.dir === -1 ? { key, dir: 1 } : null));
  }
  function reset() { setQ(''); setContract('all'); setLo(null); setHi(null); setQuick(null); setSort(null); }

  const sortButton = (key: Key | 'code', label: string) => {
    const on = sort?.key === key;
    return (
      <button type="button" onClick={() => toggleSort(key)} title={`Sort by ${label}`}
        className={cx('inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer font-sans text-meta font-semibold whitespace-nowrap max-sm:whitespace-normal',
          on ? 'text-ink' : 'text-muted-ink hover:text-ink')}>
        {label}<span aria-hidden className="inline-flex w-3">{on && (sort.dir === 1
          ? <Icon name="ChevronUp" size="sm" style={{ width: 12, height: 12 }} />
          : <Icon name="ChevronDown" size="sm" style={{ width: 12, height: 12 }} />)}</span>
      </button>
    );
  };
  const ariaSort = (key: Key | 'code') => (sort?.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined);

  const totalRow = (label: string, t: OverallTotals, grand: boolean) => (
    <tr>
      <td className={cx(CELL, UNIT_EDGE, 'text-caption font-semibold uppercase tracking-[0.09em] text-muted-ink max-sm:whitespace-normal',
        grand ? 'bg-muted [border-top:2px_solid_var(--color-line-strong)]' : 'bg-card [border-top:1px_solid_var(--color-line-strong)]')}>{label}</td>
      {cols.map((c, i) => (
        <td key={c.key} className={cx(CELL, 'text-center font-semibold', groupStart(i) && DIVIDER,
          grand ? 'bg-muted [border-top:2px_solid_var(--color-line-strong)]' : 'bg-card [border-top:1px_solid_var(--color-line-strong)]')}>
          {c.key === 'ownerPct' ? null : <Value c={c} v={t[c.key]} />}
        </td>
      ))}
    </tr>
  );

  const ltCount = all.filter(r => r.contract === 'LT').length;
  const detail = row && (
    <OwnerOverallDetail row={row} all={all} level={level} onLevel={setLevel} onClose={() => setSelected(null)}
      onStep={step} position={at + 1} total={order.length} />
  );
  const chip = (key: Exclude<Quick, null>, label: string, n: number) => (
    <button type="button" aria-pressed={quick === key} onClick={() => setQuick(v => (v === key ? null : key))}
      className={cx('h-8 px-3 rounded-full border border-solid text-meta font-medium cursor-pointer whitespace-nowrap transition-colors duration-[var(--motion-fast)]',
        quick === key ? 'bg-black text-white border-black' : 'bg-card text-ink border-line hover:border-line-strong')}>
      {label} <span className={cx('tabular-nums', quick === key ? 'opacity-70' : 'text-muted-ink')}>{count(n)}</span>
    </button>
  );

  const panel = wide && !!detail;
  useLayoutEffect(() => {
    if (panel) setPanelTop(document.querySelector('[data-app-main]')?.getBoundingClientRect().top ?? 0);
  }, [panel]);

  let body: ReactNode;
  if (!data && loading) body = <TableSkeleton rows={10} cols={6} />;
  else if (!data && error) body = <EmptyState title="The report could not load." body={error} action={{ label: 'Try again', onClick: reload }} icon="AlertTriangle" />;
  else if (!all.length) body = <EmptyState title={`No unit figures for ${monthLabel(month, { long: true })}.`} icon="BarChart3"
    body="Long-term and profit-sharing units appear here once they have reservations, costs or a fixed rent in the month." />;
  else if (!filtered.length) body = <EmptyState kind="filtered" title="No units match these filters." body="Widen the range or clear the search." action={{ label: 'Reset filters', onClick: reset }} />;
  else body = (
    <table className="w-max min-w-full border-separate border-spacing-0 text-copy">
      <thead className="sticky top-0 z-[3]">
        <tr>
          <th scope="col" rowSpan={2} aria-sort={ariaSort('code')}
            className={cx(CELL, UNIT_EDGE, 'z-[4] bg-muted text-left align-bottom [border-bottom:1px_solid_var(--color-line)]')}>{sortButton('code', 'Unit')}</th>
          {bands.map((b, i) => (
            <th key={b.group} scope="colgroup" colSpan={b.span}
              className={cx('px-3 pt-2 pb-1 bg-muted text-center text-caption font-semibold uppercase tracking-[0.09em] [border-bottom:1px_solid_var(--color-line-soft)]', GROUP_TONE[b.group] ?? 'text-muted-ink', i > 0 && DIVIDER)}>
              {GROUP_LABEL[b.group]}
            </th>
          ))}
        </tr>
        <tr>
          {cols.map((c, i) => (
            <th key={c.key} scope="col" aria-sort={ariaSort(c.key)}
              className={cx(CELL, 'bg-muted text-center [border-bottom:1px_solid_var(--color-line)]', groupStart(i) && DIVIDER)}>
              {sortButton(c.key, c.label)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {groups.map((g, gi) => (
          <Fragment key={g.contract}>
            <tr>
              <td colSpan={cols.length + 1} className={cx('px-3 py-1.5 bg-sunken', gi > 0 && '[border-top:1px_solid_var(--color-line)]')}>
                <span className="sticky left-3 text-caption font-semibold uppercase tracking-[0.09em] text-muted-ink">
                  {contractName(g.contract)}<span className="ml-2 normal-case tracking-normal font-normal">{plural(g.rows.length, 'unit')}</span>
                </span>
              </td>
            </tr>
            {g.rows.map(r => {
              const on = r.unitId === selected, st = unitStatus(r);
              const bg = on ? SELECTED_BG : 'bg-card group-hover:bg-page group-focus-visible:bg-page';
              return (
                <tr key={r.unitId} data-unit-row={r.unitId} tabIndex={0} aria-selected={on} className="group cursor-pointer outline-none scroll-mt-16"
                  onClick={() => setSelected(r.unitId)} onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) setSelected(r.unitId); }}>
                  <td className={cx(CELL, UNIT_EDGE, bg, '[border-top:1px_solid_var(--color-line-soft)] max-sm:whitespace-normal', on && 'shadow-[inset_3px_0_0_var(--color-gold)]', FOCUS_FIRST)}>
                    {/* A phone wraps the code at its hyphen (CONTINEW- / B1703A) so the Unit column stays narrow. */}
                    <span className="flex items-center gap-2 min-w-0 max-sm:max-w-[92px] sm:max-w-[200px]">
                      <span aria-hidden className={cx('h-1.5 w-1.5 shrink-0 rounded-full', st.tone === 'success' ? 'bg-success-line' : st.tone === 'critical' ? 'bg-danger-line' : 'bg-neutral-line')} />
                      <span className="font-medium sm:truncate max-sm:leading-tight" title={`${r.code} · ${r.building}`}>{r.code}</span>
                    </span>
                  </td>
                  {cols.map((c, i) => (
                    <td key={c.key} className={cx(CELL, bg, 'text-center [border-top:1px_solid_var(--color-line-soft)]', groupStart(i) && DIVIDER,
                      i === cols.length - 1 ? FOCUS_LAST : FOCUS)}>
                      <Value c={c} v={r[c.key]} />
                    </td>
                  ))}
                </tr>
              );
            })}
            {totalRow(`${phone ? g.contract : contractName(g.contract)} total`, overallTotals(g.rows), false)}
          </Fragment>
        ))}
        {groups.length > 1 && totalRow('Grand total', totals, true)}
      </tbody>
    </table>
  );

  return (
    <div className="flex flex-col gap-4 md:gap-5 md:flex-1 md:min-h-0 transition-[margin] duration-[var(--motion-standard)]" style={{ marginRight: panel ? PANEL_ROOM : 0 }}>
      <PageHeader
        title="Overall unit report"
        sub={data ? <>
          {[plural(all.length, 'unit'), `${count(ltCount)} long term`, `${count(all.length - ltCount)} profit sharing`,
            ...(data.excluded ? [`${plural(data.excluded, 'long-term let or master lease', 'long-term lets and master leases')} not listed`] : []), 'amounts in RM']
            .map((part, n) => <span key={n}>{n > 0 && ' · '}<span className="inline-block">{part}</span></span>)}
          {/* The definition gets its own line, so it never wraps into the counts. */}
          <span className="block text-meta">Gain/Loss = GP − owner base (LT, or the higher of O1 and GRR), before O2</span>
        </> : 'Every unit\'s month, as on the owner statements'}
        actions={<Select label="Month" value={month} options={MONTHS} className="w-[180px]"
          onChange={v => setParams(p => { const n = new URLSearchParams(p); if (v === MONTHS[1].value) n.delete('month'); else n.set('month', v); return n; }, { replace: true })} />}
      />

      <StatRow cols={5}>
        {/* Full width until the five tiles share one row, so the two-column grid has no tile left alone. */}
        <StatTile hero className="col-span-2 xl:col-span-1" label="Total revenue" value={data ? rmShort(totals.revenue) : undefined} loading={loading && !data}
          hint={`${plural(totals.units, 'unit')} · ${percent(totals.occupancy)} occupancy`} />
        <StatTile label="Total deduction" value={data ? rmShort(totals.deductions) : undefined} loading={loading && !data}
          hint={totals.revenue ? `${percent((totals.deductions / totals.revenue) * 100)} of revenue` : '—'} />
        <StatTile label="Gross profit" value={data ? rmShort(totals.gp) : undefined} loading={loading && !data}
          hint={totals.revenue ? `${percent(totals.margin)} margin` : '—'} />
        <StatTile label="Owner payout" value={data ? rmShort(totals.payout) : undefined} loading={loading && !data} hint="LT, GRR and shares, with O2" />
        <StatTile label="Gain / Loss" value={data ? rmShort(totals.gainLoss) : undefined} loading={loading && !data}
          tone={totals.gainLoss < 0 ? 'critical' : 'success'} hint={`${count(totals.losing)} of ${plural(totals.units, 'unit')} losing`} />
      </StatRow>

      <div className="rounded-card border border-solid border-line bg-card p-3 flex flex-wrap items-end gap-x-4 gap-y-3" aria-label="Filters" role="group">
        <div className="flex flex-col gap-1 grow sm:grow-0 min-w-[200px]">
          <Eyebrow>Search</Eyebrow>
          <SearchBox value={q} onChange={setQ} placeholder="Unit code or building" label="Search units" className="sm:w-[220px]" />
        </div>
        <div className="flex flex-col gap-1">
          <Eyebrow>Contract</Eyebrow>
          <Segmented label="Contract" value={contract} onChange={setContract}
            options={[{ key: 'all', label: 'All' }, { key: 'LT', label: 'Long term' }, { key: 'PS', label: 'Profit sharing' }]} />
        </div>
        <div className="flex flex-col gap-1">
          <Eyebrow>Detail level</Eyebrow>
          <Segmented label="Detail level" value={`${level}`} onChange={k => setLevel(Number(k) as Level)} options={LEVELS} />
        </div>
        <div className="flex flex-col gap-1">
          <Eyebrow>Range filter</Eyebrow>
          <div className="flex flex-wrap items-center gap-1.5">
            <Select label="Column to filter" value={rangeKey} className="w-[160px]" onChange={v => { setRangeKey(v as Key); setLo(null); setHi(null); }}
              options={COLS.map(c => ({ value: c.key, label: c.label }))} />
            <div className="w-[120px] [&_input]:h-[var(--control-height-sm)]!"><NumberInput aria-label="Minimum" value={lo} onChange={setLo} decimals={2} allowNegative
              placeholder={extent ? `${Number(extent.min.toFixed(2))}` : 'Min'} /></div>
            <span className="text-meta text-muted-ink">to</span>
            <div className="w-[120px] [&_input]:h-[var(--control-height-sm)]!"><NumberInput aria-label="Maximum" value={hi} onChange={setHi} decimals={2} allowNegative
              placeholder={extent ? `${Number(extent.max.toFixed(2))}` : 'Max'} /></div>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Eyebrow>Quick</Eyebrow>
          <div className="flex flex-wrap gap-1.5">
            {chip('losing', 'Losing', all.filter(r => r.gainLoss < 0).length)}
            {chip('gaining', 'Gaining', all.filter(r => r.gainLoss >= 0).length)}
            {chip('vacant', '0% occupancy', all.filter(r => r.nights === 0).length)}
            <button type="button" onClick={reset} className="h-8 px-3 rounded-full border-none bg-transparent text-meta text-muted-ink cursor-pointer hover:text-ink">Reset</button>
          </div>
        </div>
        <span className="ml-auto self-center text-meta text-muted-ink tabular-nums">Showing {count(filtered.length)} of {count(all.length)}</span>
      </div>

      {/* The page fills the screen and only the table scrolls; under 220px for it the page scrolls instead. A phone scrolls the page. */}
      <div className="max-md:h-[72vh] max-md:shrink-0 md:flex-1 md:min-h-[220px] overflow-auto overscroll-contain rounded-card border border-solid border-line bg-card" data-keep-scroll="owner-overall">
        {body}
      </div>
      {panel && (
        <aside aria-labelledby="owner-overall-unit" className="fixed right-0 bottom-0 z-[20] bg-card [border-left:1px_solid_var(--color-line)] shadow-[var(--shadow-overlay)]"
          style={{ top: panelTop, width: PANEL }}>
          {detail}
        </aside>
      )}
      {!wide && <Drawer open={!!detail} onClose={() => setSelected(null)} width={phone ? 640 : 460} labelledBy="owner-overall-unit">{detail}</Drawer>}
    </div>
  );
}
