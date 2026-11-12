import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { StatusBadge } from '../components/StatusBadge';
import { MoneyText } from '../components/MoneyText';
import { DataTable, type Column } from '../components/DataTable';
import { FilterBar } from '../components/FilterBar';
import { StatTile, StatRow } from '../components/Metric';
import { ConfirmDialog, type ConfirmSpec } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { api, notifyFailure } from '../lib/api';
import { useApi } from '../lib/useApi';
import { monthLabel, rm, todayMyt, personName } from '../lib/format';
import { statusOf, statusLabel } from '../lib/status';
import { useUrlState, SearchBox, MonthStepper, shiftMonth } from './finance/listKit';
import { DeductionPanel, type DeductionType } from './units/DeductionPanel';

/** Units > Deductions (PLAN-deduction-panel.md): the owner workbook's misc deductions sheet for one month. Additional
 *  deductions (owner-paid costs before the operator's share) and owner adjustments (O2, after it), as the statement
 *  takes them (GET /api/finance/deductions). "Add deduction" opens the side panel. Pill words: src/lib/status.ts. */

type Status = 'open' | 'held' | 'settled' | 'final';
export interface DeductionLine {
  id: string; type: DeductionType; unitId: string | null; unitLabel: string | null; ownerId: string | null; ownerName: string | null;
  date: string; remarks: string; reference: string | null; amount: number; status: Status; hasReceipt: boolean;
}
interface Payload { month: string; canAdd: boolean; canAddO2: boolean; data: DeductionLine[] }
type Filter = 'all' | DeductionType;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const sum = (rows: DeductionLine[]): number => rows.reduce((n, r) => n + r.amount, 0);
const isType = (v: string): v is DeductionType => v === 'additional' || v === 'o2';

export default function DeductionsPage(): JSX.Element {
  const url = useUrlState();
  const navigate = useNavigate();
  const thisMonth = todayMyt().slice(0, 7);
  const month = MONTH.test(url.get('month')) ? url.get('month') : thisMonth;
  const typeParam = url.get('type');
  const filter: Filter = isType(typeParam) ? typeParam : 'all';
  const q = url.get('q').trim().toLowerCase();
  const { data, loading, error, reload } = useApi<Payload>(`/finance/deductions?month=${month}`);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const toast = useToast();

  const canRemove = (line: DeductionLine): boolean =>
    line.status !== 'final' && (line.type === 'additional' ? !!data?.canAdd : !!data?.canAddO2 && !!line.ownerId);
  const removePath = ({ type, id, ownerId }: DeductionLine): string => (type === 'additional'
    ? `/expenses/${encodeURIComponent(id)}`
    : `/owners/${encodeURIComponent(ownerId ?? '')}/adjustments/${encodeURIComponent(id)}`);
  const askRemove = (line: DeductionLine): void => setConfirm({
    title: 'Remove this deduction?',
    body: `${line.unitLabel ?? 'No unit'}, ${rm(line.amount)}${line.remarks ? `: ${line.remarks}` : ''}.`,
    meta: 'It comes off the owner statement. This cannot be undone; add it again if it was removed by mistake.',
    confirmLabel: 'Remove', busyLabel: 'Removing…', danger: true,
    onConfirm: async () => {
      try {
        const { regenerate } = await api.del<{ regenerate?: string | null }>(removePath(line));
        toast({ tone: 'success', title: 'Deduction removed.',
          body: regenerate ? `Regenerate the ${monthLabel(regenerate)} owner statements to take it off that statement.` : line.unitLabel ?? undefined });
        setConfirm(null);
        reload();
      } catch (failure) { notifyFailure(failure); }
    },
  });
  const removeButton = (line: DeductionLine, sizeClass: string): JSX.Element | null => (canRemove(line) ? (
    <button type="button" aria-label="Remove deduction" title="Remove deduction" onClick={event => { event.stopPropagation(); askRemove(line); }}
      className={`grid place-items-center flex-none ${sizeClass} rounded-control bg-transparent border border-solid border-line text-muted-ink cursor-pointer`}>
      <Icon name="Trash2" size="sm" />
    </button>
  ) : null);

  const rows = useMemo(() => data?.data ?? [], [data]);
  const additional = useMemo(() => rows.filter(r => r.type === 'additional'), [rows]);
  const o2 = useMemo(() => rows.filter(r => r.type === 'o2'), [rows]);
  const visible = useMemo(() => rows.filter(r => (filter === 'all' || r.type === filter)
    && (!q || [r.unitLabel ?? '', r.ownerName ?? '', r.remarks].some(s => s.toLowerCase().includes(q)))), [rows, filter, q]);
  const money = (n: number | undefined): string | undefined => (n === undefined ? undefined : rm(n));

  const columns: Column<DeductionLine>[] = [
    { key: 'date', label: 'Date', type: 'date', value: r => r.date, width: 120 },
    { key: 'unit', label: 'Unit', value: r => r.unitLabel ?? 'No unit', hideable: false, width: 180, render: r => <span className="font-medium truncate block" title={r.unitLabel ?? undefined}>{r.unitLabel ?? '—'}</span> },
    { key: 'type', label: 'Type', type: 'status', value: r => statusLabel('deduction_type', r.type), status: r => statusOf('deduction_type', r.type), width: 170, filter: { kind: 'select' } },
    { key: 'total', label: 'Total', type: 'money', value: r => r.amount, width: 130,
      render: r => <MoneyText sen={r.amount} mode="exact" className="tabular-nums whitespace-nowrap" /> },
    { key: 'remarks', label: 'Remarks', value: r => r.remarks, width: 240, render: r => <span className="truncate block" title={r.remarks}>{r.remarks || '—'}</span> },
    { key: 'owner', label: 'Owner', type: 'person', value: r => (r.ownerName ? personName(r.ownerName) : null), width: 160 },
    { key: 'status', label: 'Status', type: 'status', value: r => statusLabel('deduction', r.status), status: r => statusOf('deduction', r.status), width: 160, filter: { kind: 'select' } },
    { key: 'actions', label: '', width: 52, align: 'right', noExport: true, sortable: false, filter: false, hideable: false,
      render: r => removeButton(r, 'w-[30px] h-[30px]') },
  ];

  return (
    <>
      <PageHeader title="Deductions" sub="Additional deductions and owner adjustments (O2) on the owner statements, month by month."
        primary={data?.canAdd ? <Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setAdding(true)}>Add deduction</Button> : undefined} />
      <StatRow cols={3}>
        <StatTile label="Additional deductions" value={money(data ? sum(additional) : undefined)} loading={loading && !data} hint="Before the operator's share" />
        <StatTile label="Owner adjustments (O2)" value={money(data ? sum(o2) : undefined)} loading={loading && !data} hint="After the operator's share" />
        <StatTile label="Effect on payouts" value={money(data ? sum(rows) : undefined)} loading={loading && !data} hint={`${monthLabel(month)}, all owners`} />
      </StatRow>
      <DataTable<DeductionLine> id="deductions" columns={columns} rows={data ? visible : null} rowKey={r => `${r.type}-${r.id}`} loading={loading} error={error} onRetry={reload}
        onRowClick={r => { if (r.ownerId) navigate(`/owners/${encodeURIComponent(r.ownerId)}`); }}
        viewParams={['month', 'type', 'q']} filtered={filter !== 'all' || !!q} onClearFilters={() => url.set({ type: null, q: null, page: null })}
        noun={['deduction', 'deductions']} exportName={`deductions-${month}`}
        empty={{ title: `No deductions for ${monthLabel(month)}.`, body: data?.canAdd ? 'Add an additional deduction or an owner adjustment (O2) for a unit.' : 'Nothing was deducted or given back this month.', icon: 'Receipt' }}
        header={<div className="py-3 px-[22px] max-md:px-4 [border-bottom:1px_solid_var(--color-line)]">
          <FilterBar<Filter> label="Deduction type" value={filter} onChange={k => url.set({ type: k === 'all' ? null : k, page: null })}
            views={[{ key: 'all', label: 'All', count: data ? rows.length : undefined }, { key: 'additional', label: 'Additional deduction', count: data ? additional.length : undefined },
              { key: 'o2', label: 'O2', count: data ? o2.length : undefined }]} />
        </div>}
        toolbar={<>
          <MonthStepper label={monthLabel(month)} note={month === thisMonth ? 'so far' : undefined} onStep={by => url.set({ month: shiftMonth(month, by), page: null })} />
          <SearchBox className="flex-1 min-w-[200px]" label="Search deductions" placeholder="Search unit, owner or remarks" value={url.get('q')} onChange={v => url.set({ q: v || null, page: null })} />
        </>}
        renderCard={r => (
          <span className="flex flex-col gap-1 min-w-0 w-full">
            <span className="flex items-start justify-between gap-2">
              <span className="text-copy font-medium min-w-0 [overflow-wrap:anywhere]">{r.unitLabel ?? 'No unit'}</span>
              <MoneyText sen={r.amount} mode="exact" className="text-copy tabular-nums whitespace-nowrap" />
            </span>
            <span className="text-meta text-muted-ink [overflow-wrap:anywhere]">{r.remarks || '—'}</span>
            <span className="flex items-center justify-between gap-2">
              <span className="flex flex-wrap items-center gap-1.5">
                <StatusBadge entity="deduction_type" value={r.type} size="sm" />
                <StatusBadge entity="deduction" value={r.status} size="sm" />
              </span>
              {removeButton(r, 'w-11 h-11')}
            </span>
          </span>
        )}
      />
      <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} />
      {adding && data && <DeductionPanel month={month} canAddO2={data.canAddO2} onClose={() => setAdding(false)} onSaved={reload} />}
    </>
  );
}
