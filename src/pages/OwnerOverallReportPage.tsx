import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { StatTile, StatRow, Segmented } from '../components/Metric';
import { ListToolbar } from '../components/ListToolbar';
import { Select } from '../components/Select';
import { NumberInput } from '../components/inputs';
import { Drawer } from '../components/Dialog';
import { EmptyState } from '../components/States';
import Icon from '../components/Icon';
import { TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { useMedia } from '../lib/useMedia';
import { saveBlob, toXlsx, type ExportCell, type ExportColumn } from '../lib/export';
import { cx } from '../lib/design-tokens';
import { count, dateShort, monthLabel, percent, personName, plural, rm, todayMyt, buildingName } from '../lib/format';
import { useConfirm } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { api, notifyFailure } from '../lib/api';
import { overallFigures, overallTotals, occupancyLabel, GROUP_NAME, REPORT_GROUPS, type OverallInput, type OverallTotals, type ReportGroup } from '../lib/ownerOverall';
import { GainLoss, LEVELS, OwnerOverallDetail, money, unitStatus, type Level, type ReportRow, type Stage } from './OwnerOverallDetail';

/** /portfolio/owner-report — the overall owner report (the owner workbook's overall report sheet) for one month: every
 *  unit's revenue, deductions, owner payout and the company's gain or loss on it, from GET /api/portfolio/owner-report.
 *  The whole month is about a row per unit, so search, filters and sorting happen here.
 *  From October 2026 a Close band shows each unit's step locks and its owner's statement: Make final once every step is
 *  locked, Unlock final with a reason (owner statement close part 3, mockup screen 5). */

interface ApiRow extends OverallInput {
  unitId: string; ownerId?: string; code: string; building: string; ownerName: string; group: ReportGroup; contractCode: string | null;
  /** The month's steps that list the unit, and the ones locked (part 3). */
  steps?: Stage[]; locked?: Stage[];
  /** The company's share of late changes to an earlier, locked month counted this month, row by row (part 2b). */
  lateItems?: { label: string; amount: number }[];
}
/** The owner's statement for the month, for the Final column (functions/api/portfolio/owner-report.ts OwnerFinal). */
interface OwnerFinal { statementId: string | null; state: 'none' | 'draft' | 'final'; waiting: string | null; by: string | null; at: string | null; paid: boolean; transferring: boolean }
interface Payload {
  month: string; rows: ApiRow[]; generatedAt: string;
  owners?: Record<string, OwnerFinal>; may?: { makeFinal: boolean; unlockFinal: boolean }; lockFrom?: string;
}

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
  // The company's share of late changes to an earlier, locked month (part 2b, chew's choice A), in Gain / Loss. The column
  // is shown only in a month that has one.
  { key: 'late', label: 'Late changes', level: 1, group: 'res', kind: 'money' },
  { key: 'gainLoss', label: 'Gain / Loss', level: 1, group: 'res', kind: 'gl' },
  // Gain / Loss split (part 3, spec call 12): the agent's part (GP x the contract's agent %) and what the company keeps.
  { key: 'agent', label: 'Agent', level: 1, group: 'res', kind: 'money' },
  { key: 'company', label: 'Company', level: 1, group: 'res', kind: 'gl' },
];

/** The three steps a unit is locked on, as the Locks chips name them. */
const STEP_CHIPS: { stage: Stage; label: string; name: string }[] = [
  { stage: 'income', label: 'Income', name: 'Income' }, { stage: 'deductions', label: 'Ded.', name: 'Deductions' }, { stage: 'o2', label: 'O2', name: 'O2' },
];
/** A unit's step locks: a filled chip with a lock when locked, an outline when not, a dash where the step does not list it. */
function LockChips({ steps, locked }: { steps?: Stage[]; locked?: Stage[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      {STEP_CHIPS.map(c => {
        if (!steps?.includes(c.stage)) return <span key={c.stage} title={`${c.name}: not on this step`} className="inline-flex min-w-[24px] justify-center text-meta text-faint">–</span>;
        const done = !!locked?.includes(c.stage);
        return (
          <span key={c.stage} title={`${c.name} ${done ? 'locked' : 'not locked'}`}
            className={cx('inline-flex items-center gap-0.5 rounded-full px-1.5 text-[11px] font-semibold leading-[18px] whitespace-nowrap',
              done ? 'bg-success-bg text-success' : 'text-muted-ink [box-shadow:inset_0_0_0_1px_var(--color-line)]')}>
            {done && <Icon name="Lock" size="sm" style={{ width: 10, height: 10 }} />}{c.label}
          </span>
        );
      })}
    </span>
  );
}
/** The Locks column as text, for the export. */
const locksText = (r: ReportRow) => STEP_CHIPS.filter(c => r.steps?.includes(c.stage)).map(c => `${c.name} ${r.locked?.includes(c.stage) ? 'locked' : 'open'}`).join(', ');
const colOf = (key: string) => COLS.find(c => c.key === key) ?? COLS[0];
/** Money is typed in ringgit; everything else as it is shown (percent, nights). */
const inSen = (c: Col) => c.kind === 'money' || c.kind === 'gl';

type Contract = 'all' | ReportGroup;
type Quick = 'losing' | 'gaining' | 'vacant' | null;
type Sort = { key: Key | 'code'; dir: 1 | -1 } | null;

/** The file always carries every column, whatever level is on screen. Occupancy keeps one decimal, as shown. */
const EXPORT_COLS: ExportColumn[] = [
  { label: 'Unit', kind: 'text' }, { label: 'Building', kind: 'text' }, { label: 'Owner', kind: 'text' }, { label: 'Contract', kind: 'text' },
  ...COLS.map(c => ({ label: c.kind === 'occ' || c.kind === 'ownpct' ? `${c.label} (%)` : c.label, kind: inSen(c) ? 'money' as const : 'number' as const })),
];
const exportFigures = (r: OverallTotals | ReportRow, total: boolean): ExportCell[] =>
  COLS.map(c => (c.key === 'ownerPct' ? (total ? null : (r as ReportRow).ownerPct) : c.kind === 'occ' ? Math.round(r.occupancy * 10) / 10 : r[c.key]));

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
        <span className={cx('tabular-nums', tone)}>{occupancyLabel(v)}</span>
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
  const toast = useToast();
  const [confirmUi, ask] = useConfirm();

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

  const all = useMemo<ReportRow[]>(() => (data?.rows ?? []).map(({ unitId, ownerId, code, building, ownerName, group, contractCode, lateItems, steps, locked, ...input }) =>
    ({ ...overallFigures(input), lateItems: lateItems ?? [], unitId, ownerId, code, building, ownerName, group, contractCode, steps: steps ?? [], locked: locked ?? [] })), [data]);
  const hasLate = all.some(r => r.late !== 0);

  const range = colOf(rangeKey);
  const shownValue = (r: ReportRow) => (inSen(range) ? r[range.key] / 100 : r[range.key]);
  const extent = useMemo(() => {
    if (!all.length) return null;
    const vs = all.map(shownValue);
    return { min: Math.min(...vs), max: Math.max(...vs) };
  }, [all, rangeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = all.filter(r => (contract === 'all' || r.group === contract)
      && (!needle || r.code.toLowerCase().includes(needle) || r.building.toLowerCase().includes(needle))
      && (lo === null || shownValue(r) >= lo) && (hi === null || shownValue(r) <= hi)
      && (quick !== 'losing' || r.gainLoss < 0) && (quick !== 'gaining' || r.gainLoss >= 0) && (quick !== 'vacant' || (r.nights === 0 && r.days > 0)));
    const byCode = (a: ReportRow, b: ReportRow) => a.code.localeCompare(b.code, 'en', { numeric: true });
    if (!sort) return list.sort(byCode);
    const { key, dir } = sort;
    return list.sort((a, b) => (key === 'code' ? byCode(a, b) : a[key] - b[key] || byCode(a, b)) * dir);
  }, [all, q, contract, lo, hi, quick, sort, rangeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = REPORT_GROUPS.map(g => ({ group: g, rows: filtered.filter(r => r.group === g) })).filter(g => g.rows.length);
  // Previous / next follow the table as shown: group by group, each in the current sort.
  const order = groups.flatMap(g => g.rows);
  // The Close band (part 3): from the month the locks start. An owner's buttons sit on the owner's first row as shown.
  const showClose = !!data?.lockFrom && month >= data.lockFrom;
  const owners = data?.owners ?? {};
  const firstOfOwner = new Set<string>();
  { const seen = new Set<string>(); for (const r of order) if (r.ownerId && !seen.has(r.ownerId)) { seen.add(r.ownerId); firstOfOwner.add(r.unitId); } }
  const label = monthLabel(month, { long: true });
  const at = order.findIndex(r => r.unitId === selected);
  const row = at >= 0 ? order[at] : null;
  const totals = overallTotals(filtered);
  // Full detail shows the four bills, so their Utilities total would only repeat them.
  const cols = COLS.filter(c => c.level <= level && (level === 1 || c.key !== 'utilities') && (c.key !== 'late' || hasLate));
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
        className={cx('relative inline-flex items-center bg-transparent border-none p-0 cursor-pointer font-sans text-meta font-semibold whitespace-nowrap max-sm:whitespace-normal',
          on ? 'text-ink' : 'text-muted-ink hover:text-ink')}>
        {/* The arrow hangs outside the label so the label itself sits centred over its column. */}
        {label}<span aria-hidden className="absolute left-full top-1/2 -translate-y-1/2 ml-0.5 inline-flex">{on && (sort.dir === 1
          ? <Icon name="ChevronUp" size="sm" style={{ width: 12, height: 12 }} />
          : <Icon name="ChevronDown" size="sm" style={{ width: 12, height: 12 }} />)}</span>
      </button>
    );
  };
  const ariaSort = (key: Key | 'code') => (sort?.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined);

  async function makeFinal(r: ReportRow, o: OwnerFinal) {
    const yes = await ask({ title: `Make the ${label} statement final for ${personName(r.ownerName)}?`,
      body: 'Its figures are frozen, and it can then be sent to the owner.', confirmLabel: 'Make final' });
    if (yes === null) return;
    try {
      const res = await api.post<{ finalised: number; failed: { id: string; reason: string }[] }>('/statements/finalise', { statementIds: [o.statementId] });
      toast(res.finalised
        ? { tone: 'success', title: 'Statement made final.', body: 'It can now be sent to the owner from Owner statements.' }
        : { tone: 'warning', title: 'Not made final.', body: res.failed[0]?.reason });
      reload();
    } catch (err) {
      notifyFailure(err);
    }
  }

  async function unlockFinal(r: ReportRow, o: OwnerFinal) {
    const reason = await ask({
      title: `Unlock the final ${label} statement?`,
      body: o.paid
        ? `${personName(r.ownerName)}. Already paid: the paid amount stays. The month is worked out again with today's contract, and any difference goes to the next open month as an owner adjustment.`
        : `${personName(r.ownerName)}. The statement goes back to draft so it can be worked out again. A payout not yet transferred is cancelled; sending the statement again makes a new one.`,
      reason: { label: 'Why are you unlocking?', placeholder: 'Owner disputes the cleaning fee', maxLength: 500 },
      confirmLabel: 'Unlock', danger: true,
    });
    if (reason === null) return;
    try {
      const res = await api.post<{ outcome: 'draft' | 'paid'; payoutCancelled?: boolean; posted?: { month: string; amount: number }[] }>('/statements/unlock-final', { statementId: o.statementId, reason });
      toast(res.outcome === 'paid'
        ? { tone: 'success', title: 'Statement unlocked.', body: res.posted?.length ? `The difference went to ${monthLabel(res.posted[0].month, { long: true })} as an owner adjustment.` : 'Nothing has changed since it was paid, so nothing was posted.' }
        : { tone: 'success', title: 'Statement back to draft.', body: `${res.payoutCancelled ? 'Its payout is cancelled. ' : ''}Generate it again, then make it final.` });
      reload();
    } catch (err) {
      notifyFailure(err);
    }
  }

  /** The Final cell: final (by whom, when, Unlock), what it waits for, or Make final. Buttons only on the owner's first row. */
  const finalCell = (r: ReportRow): ReactNode => {
    const o = r.ownerId ? owners[r.ownerId] : undefined;
    if (!o || o.state === 'none') return <span className="text-meta text-muted-ink">No statement yet</span>;
    const first = firstOfOwner.has(r.unitId);
    if (o.state === 'final') return (
      <span className="flex items-center gap-2">
        <span aria-hidden className="inline-flex text-success"><Icon name="Lock" size="sm" /></span>
        <span className="flex min-w-0 flex-col leading-tight">
          <span>Final{o.paid ? ' · paid' : ''}</span>
          <span className="text-meta text-muted-ink">{[o.by, o.at ? dateShort(o.at) : null].filter(Boolean).join(' · ')}</span>
        </span>
        {first && data?.may?.unlockFinal && (
          <Button size="sm" variant="ghost" className="ml-auto" disabled={o.transferring} disabledReason="The payout is being transferred. Unlock it once the transfer is paid or has failed."
            onClick={e => { e.stopPropagation(); void unlockFinal(r, o); }}>Unlock</Button>
        )}
      </span>
    );
    if (o.waiting) return <span className="block max-w-[280px] truncate text-meta text-warning" title={o.waiting}>{o.waiting}</span>;
    return first && data?.may?.makeFinal
      ? <Button size="sm" variant="primary" onClick={e => { e.stopPropagation(); void makeFinal(r, o); }}>Make final</Button>
      : <span className="text-meta text-muted-ink">Ready to make final</span>;
  };

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
      {showClose && [0, 1].map(i => (
        <td key={`close-${i}`} className={cx(CELL, i === 0 && DIVIDER, grand ? 'bg-muted [border-top:2px_solid_var(--color-line-strong)]' : 'bg-card [border-top:1px_solid_var(--color-line-strong)]')} />
      ))}
    </tr>
  );

  /** The Final column as text: what the owner's statement waits for, or who made it final. */
  const finalText = (r: ReportRow): string => {
    const o = r.ownerId ? owners[r.ownerId] : undefined;
    if (!o || o.state === 'none') return 'No statement yet';
    if (o.state === 'final') return ['Final', o.paid ? 'paid' : null, o.by, o.at ? dateShort(o.at) : null].filter(Boolean).join(' · ');
    return o.waiting ?? 'Ready to make final';
  };

  function exportExcel() {
    const rows: ExportCell[][] = [];
    const close = (r: ReportRow | null): ExportCell[] => (showClose ? (r ? [locksText(r), finalText(r)] : [null, null]) : []);
    for (const g of groups) {
      for (const r of g.rows) rows.push([r.code, r.building, r.ownerName, r.contractCode ?? GROUP_NAME[r.group], ...exportFigures(r, false), ...close(r)]);
      rows.push([`${GROUP_NAME[g.group]} total`, null, null, null, ...exportFigures(overallTotals(g.rows), true), ...close(null)]);
    }
    if (groups.length > 1) rows.push(['Grand total', null, null, null, ...exportFigures(totals, true), ...close(null)]);
    const columns: ExportColumn[] = showClose ? [...EXPORT_COLS, { label: 'Locks', kind: 'text' }, { label: 'Final', kind: 'text' }] : EXPORT_COLS;
    // Named for the report month only: the usual export name adds today's date, and two dates read as a range.
    saveBlob(toXlsx(columns, rows, monthLabel(month, { long: true })) as BlobPart, `overall-unit-report-${month}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  const present = REPORT_GROUPS.map(g => ({ group: g, n: all.filter(r => r.group === g).length })).filter(g => g.n);
  // Rent to rent keeps its chip even in a month with no such unit (owner, 5 Nov 2026).
  const chips: ReportGroup[] = [...present.map(p => p.group).filter(g => g !== 'RTR'), 'RTR'];
  const detail = row && (
    <OwnerOverallDetail row={row} all={all} level={level} onLevel={setLevel} onClose={() => setSelected(null)}
      onStep={step} position={at + 1} total={order.length} />
  );
  const panel = wide && !!detail;
  useLayoutEffect(() => {
    if (panel) setPanelTop(document.querySelector('[data-app-main]')?.getBoundingClientRect().top ?? 0);
  }, [panel]);

  let body: ReactNode;
  if (!data && loading) body = <TableSkeleton rows={10} cols={6} />;
  else if (!data && error) body = <EmptyState title="The report could not load." body={error} action={{ label: 'Try again', onClick: reload }} icon="AlertTriangle" />;
  else if (!all.length) body = <EmptyState title={`No unit figures for ${monthLabel(month, { long: true })}.`} icon="BarChart3"
    body="Units appear here once they have reservations, costs or a fixed rent in the month." />;
  else if (!filtered.length) body = <EmptyState kind="filtered" title="No units match these filters." body="Widen the range or clear the search." action={{ label: 'Reset filters', onClick: reset }} />;
  else if (phone) {
    // A phone lists two-line cards (the prototype's Unit report on a phone): the unit and its building, Net Payout to
    // Owner on the right, the month's revenue, deduction and GP under it; a total card closes each group.
    const line = (t: { revenue: number; deductions: number; gp: number }) => `Revenue ${money(t.revenue)} · Deduction ${money(t.deductions)} · GP ${money(t.gp)}`;
    const total = (label: string, t: OverallTotals, grand: boolean) => (
      <div className={cx('flex flex-col gap-0.5 px-4 py-2.5 [border-top:1px_solid_var(--color-line-soft)]', grand ? 'bg-muted' : 'bg-page')}>
        <span className="flex items-baseline justify-between gap-3"><b className="text-copy">{label}</b><b className="text-copy tabular-nums">{rm(t.payout)}</b></span>
        <span className="text-meta text-muted-ink tabular-nums">{line(t)}</span>
      </div>
    );
    body = (
      <div>
        {groups.map(g => (
          <Fragment key={g.group}>
            <div className="px-4 pt-2.5 pb-1.5 bg-sunken text-caption font-semibold uppercase tracking-[0.09em] text-muted-ink">{GROUP_NAME[g.group]} · <span className="normal-case tracking-normal font-normal">{plural(g.rows.length, 'unit')}</span></div>
            {g.rows.map(r => {
              const st = unitStatus(r);
              return (
                <button key={r.unitId} type="button" data-unit-row={r.unitId} onClick={() => setSelected(r.unitId)}
                  className={cx('w-full min-h-[64px] flex flex-col gap-1 px-4 py-2.5 text-left font-sans bg-card border-0 [border-top:1px_solid_var(--color-line-soft)] cursor-pointer', r.unitId === selected && 'shadow-[inset_3px_0_0_var(--color-gold)]')}>
                  <span className="flex items-baseline justify-between gap-3 w-full min-w-0">
                    <span className="flex items-center gap-2 min-w-0">
                      <span aria-hidden className={cx('h-1.5 w-1.5 shrink-0 rounded-full self-center', st.tone === 'success' ? 'bg-success-line' : st.tone === 'critical' ? 'bg-danger-line' : 'bg-neutral-line')} />
                      <b className="text-copy font-semibold text-ink truncate">{r.code}</b>
                      <span className="text-meta text-muted-ink truncate">{buildingName(r.building)}</span>
                    </span>
                    <b className="text-copy text-ink tabular-nums whitespace-nowrap">{rm(r.payout)}</b>
                  </span>
                  <span className="text-meta text-muted-ink tabular-nums truncate w-full">{line(r)}</span>
                  {showClose && (
                    <span className="flex items-center justify-between gap-2 w-full min-w-0">
                      <LockChips steps={r.steps} locked={r.locked} />
                      <span className="text-meta text-muted-ink truncate">{finalText(r)}</span>
                    </span>
                  )}
                </button>
              );
            })}
            {total(`${GROUP_NAME[g.group]} total`, overallTotals(g.rows), false)}
          </Fragment>
        ))}
        {groups.length > 1 && total('Grand total', totals, true)}
      </div>
    );
  } else body = (
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
          {showClose && (
            <th scope="colgroup" colSpan={2} className={cx('px-3 pt-2 pb-1 bg-muted text-center text-caption font-semibold uppercase tracking-[0.09em] text-muted-ink [border-bottom:1px_solid_var(--color-line-soft)]', DIVIDER)}>
              Close
            </th>
          )}
        </tr>
        <tr>
          {cols.map((c, i) => (
            <th key={c.key} scope="col" aria-sort={ariaSort(c.key)}
              className={cx(CELL, 'bg-muted text-center [border-bottom:1px_solid_var(--color-line)]', groupStart(i) && DIVIDER)}>
              {sortButton(c.key, c.label)}
            </th>
          ))}
          {showClose && <>
            <th scope="col" className={cx(CELL, 'bg-muted text-center text-meta font-semibold text-muted-ink [border-bottom:1px_solid_var(--color-line)]', DIVIDER)}>Locks</th>
            <th scope="col" className={cx(CELL, 'bg-muted text-left text-meta font-semibold text-muted-ink [border-bottom:1px_solid_var(--color-line)]')}>Final</th>
          </>}
        </tr>
      </thead>
      <tbody>
        {groups.map((g, gi) => (
          <Fragment key={g.group}>
            <tr>
              <td colSpan={cols.length + 1 + (showClose ? 2 : 0)} className={cx('px-3 py-1.5 bg-sunken', gi > 0 && '[border-top:1px_solid_var(--color-line)]')}>
                <span className="sticky left-3 text-caption font-semibold uppercase tracking-[0.09em] text-muted-ink">
                  {GROUP_NAME[g.group]}<span className="ml-2 normal-case tracking-normal font-normal">{plural(g.rows.length, 'unit')}</span>
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
                      <span className="flex flex-col min-w-0" title={`${r.code} · ${buildingName(r.building)}`}>
                        <span className="font-semibold sm:truncate leading-tight">{r.code}</span>
                        <span className="max-sm:hidden text-meta text-muted-ink truncate leading-tight">{buildingName(r.building)}{r.contractCode ? ` · ${r.contractCode}` : ''}</span>
                      </span>
                    </span>
                  </td>
                  {cols.map((c, i) => (
                    <td key={c.key} className={cx(CELL, bg, 'text-center [border-top:1px_solid_var(--color-line-soft)]', groupStart(i) && DIVIDER,
                      i === cols.length - 1 && !showClose ? FOCUS_LAST : FOCUS)}>
                      <Value c={c} v={r[c.key]} />
                    </td>
                  ))}
                  {showClose && <>
                    <td className={cx(CELL, bg, 'text-center [border-top:1px_solid_var(--color-line-soft)]', DIVIDER, FOCUS)}><LockChips steps={r.steps} locked={r.locked} /></td>
                    <td className={cx(CELL, bg, '[border-top:1px_solid_var(--color-line-soft)]', FOCUS_LAST)}>{finalCell(r)}</td>
                  </>}
                </tr>
              );
            })}
            {totalRow(`${phone ? g.group : GROUP_NAME[g.group]} total`, overallTotals(g.rows), false)}
          </Fragment>
        ))}
        {groups.length > 1 && totalRow('Grand total', totals, true)}
      </tbody>
    </table>
  );

  return (
    <div className="flex flex-col gap-4 md:gap-5 md:flex-1 md:min-h-0 transition-[margin] duration-[var(--motion-standard)]" style={{ marginRight: panel ? PANEL_ROOM : 0 }}>
      <PageHeader
        title="Unit report"
        sub={data ? <>
          {[plural(all.length, 'unit'), ...present.map(g => `${count(g.n)} ${GROUP_NAME[g.group].toLowerCase()}`), 'amounts in RM']
            .map((part, n) => <span key={n}>{n > 0 && ' · '}<span className="inline-block">{part}</span></span>)}
          {/* The definition gets its own line, so it never wraps into the counts. */}
          <span className="block text-meta">Gain/Loss = GP − owner base (the owner's part of the rent, the fixed rent, or the higher of O1 and GRR), before O2{hasLate ? ', plus late changes: the company’s share of changes to an earlier, locked month' : ''}</span>
        </> : 'Every unit\'s month, as on the owner statements'}
        actions={<>
          <Button variant="secondary" icon={<Icon name="Download" size="sm" />} onClick={exportExcel}
            title="The units shown, with these filters and this sort, every column, and the totals."
            disabled={!filtered.length} disabledReason="No units to export for this month and these filters.">Export</Button>
        </>}
      />

      <StatRow cols={5}>
        {/* Full width until the five tiles share one row, so the two-column grid has no tile left alone. */}
        <StatTile hero className="col-span-2 xl:col-span-1" label="Total revenue" value={data ? rm(totals.revenue) : undefined} loading={loading && !data}
          hint={`${plural(totals.units, 'unit')} · ${occupancyLabel(totals.occupancy)} occupancy`} />
        <StatTile label="Total deduction" value={data ? rm(totals.deductions) : undefined} loading={loading && !data}
          hint={totals.revenue ? `${percent((totals.deductions / totals.revenue) * 100)} of revenue` : '—'} />
        <StatTile label="Gross profit" value={data ? rm(totals.gp) : undefined} loading={loading && !data}
          hint={totals.revenue ? `${percent(totals.margin)} margin` : '—'} />
        <StatTile label="Owner payout" value={data ? rm(totals.payout) : undefined} loading={loading && !data} hint="Every income model, with O2" />
        <StatTile label="Gain / Loss" value={data ? rm(totals.gainLoss) : undefined} loading={loading && !data}
          tone={totals.gainLoss < 0 ? 'critical' : 'success'} hint={`${count(totals.losing)} of ${plural(totals.units, 'unit')} losing`} />
      </StatRow>

      <ListToolbar
        search={{ value: q, onChange: setQ, placeholder: 'Unit code or building', label: 'Search units' }}
        filters={[{ key: 'quick', label: 'Show', value: quick ?? '', onChange: v => setQuick((v || null) as Quick), allLabel: 'Every unit', options: [
          { value: 'losing', label: 'Losing', count: all.filter(r => r.gainLoss < 0).length },
          { value: 'gaining', label: 'Gaining', count: all.filter(r => r.gainLoss >= 0).length },
          { value: 'vacant', label: '0% occupancy', count: all.filter(r => r.nights === 0 && r.days > 0).length },
        ] }]}
        panelExtra={<>
          <h5 className="m-0 mb-1.5 text-caption font-semibold uppercase tracking-[0.08em] text-muted-ink">Range filter</h5>
          <div className="flex flex-col gap-1.5">
            <Select label="Column to filter" value={rangeKey} onChange={v => { setRangeKey(v as Key); setLo(null); setHi(null); }}
              options={COLS.map(c => ({ value: c.key, label: c.label }))} />
            <div className="flex items-center gap-1.5">
              <div className="flex-1 min-w-0 [&_input]:h-[var(--control-height-sm)]!"><NumberInput aria-label="Minimum" value={lo} onChange={setLo} decimals={2} allowNegative
                placeholder={extent ? `${Number(extent.min.toFixed(2))}` : 'Min'} /></div>
              <span className="text-meta text-muted-ink">to</span>
              <div className="flex-1 min-w-0 [&_input]:h-[var(--control-height-sm)]!"><NumberInput aria-label="Maximum" value={hi} onChange={setHi} decimals={2} allowNegative
                placeholder={extent ? `${Number(extent.max.toFixed(2))}` : 'Max'} /></div>
            </div>
          </div>
        </>}
        chips={lo !== null || hi !== null ? [{ key: 'range', label: `${range.label}: ${lo ?? 'any'} to ${hi ?? 'any'}`, onRemove: () => { setLo(null); setHi(null); } }] : []}
        date={{ label: 'Month', value: month, presets: MONTHS,
          onChange: v => setParams(p => { const n = new URLSearchParams(p); if (v === MONTHS[1].value) n.delete('month'); else n.set('month', v); return n; }, { replace: true }) }}
        onClearAll={() => setSort(null)}
        below={<>
          <Segmented label="Contract" value={contract} onChange={setContract}
            options={[{ key: 'all' as Contract, label: 'All', count: all.length }, ...chips.map(g => ({ key: g as Contract, label: GROUP_NAME[g], count: all.filter(r => r.group === g).length }))]} />
          {!phone && <span className="ml-auto"><Segmented label="Detail level" value={`${level}`} onChange={k => setLevel(Number(k) as Level)} options={LEVELS} /></span>}
        </>}
        count={<span className="tabular-nums">Showing {count(filtered.length)} of {count(all.length)} · {monthLabel(month, { long: true })}</span>}
      />

      {/* The page fills the screen and only the table scrolls; under 220px for it the page scrolls instead. A phone scrolls the page. */}
      {phone && <div className="overflow-hidden rounded-card border border-solid border-line bg-card">{body}</div>}
      <div hidden={phone} className="max-md:h-[72vh] max-md:shrink-0 md:flex-1 md:min-h-[220px] overflow-auto overscroll-contain rounded-card border border-solid border-line bg-card" data-keep-scroll="owner-overall">
        {phone ? null : body}
      </div>
      {panel && (
        <aside aria-labelledby="owner-overall-unit" className="fixed right-0 bottom-0 z-[20] bg-card [border-left:1px_solid_var(--color-line)] shadow-[var(--shadow-overlay)]"
          style={{ top: panelTop, width: PANEL }}>
          {detail}
        </aside>
      )}
      {!wide && <Drawer open={!!detail} onClose={() => setSelected(null)} width={phone ? 640 : 460} labelledBy="owner-overall-unit">{detail}</Drawer>}
      {confirmUi}
    </div>
  );
}
