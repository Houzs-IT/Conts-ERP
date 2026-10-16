import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card } from '../../components/Card';
import { StatusBadge } from '../../components/StatusBadge';
import { DataTable, type Column } from '../../components/DataTable';
import { PersonCell } from '../../components/DataTableParts';
import { useApi } from '../../lib/useApi';
import { humanize, dateShort } from '../../lib/format';
import { STATUS_VOCAB } from '../../lib/status';
import { StatusChips, DateRange } from './ListFilters';

type CleanStatus = 'unassigned' | 'waiting' | 'cleaning' | 'done';
type RepairStatus = 'new' | 'assigned' | 'awaiting_owner' | 'in_progress' | 'repair_finished' | 'done';
interface CleanRow { id: string; title: string; kind: string; state: string; status: CleanStatus; day: string | null; dueAt: string | null; completedAt: string | null; assigneeName: string | null; cleaners?: string[] }
interface RepairRow {
  id: string; title: string; detail: string | null; state: string; status: RepairStatus; vendorName: string | null; blocksUnit: boolean; chargeTo: string;
  reportedAt: string; resolvedAt: string | null; quotedAmount?: number | null; finalAmount?: number | null;
}
interface Payload { cleaning: CleanRow[]; maintenance: RepairRow[] }

const CHARGE_LABEL: Record<string, string> = { owner: 'Owner', guest_deposit: 'Guest deposit', the_conts: 'The Conts', warranty: 'Warranty' };
const CLEAN_ORDER: CleanStatus[] = ['unassigned', 'waiting', 'cleaning', 'done'];
const REPAIR_ORDER: RepairStatus[] = ['new', 'assigned', 'awaiting_owner', 'in_progress', 'repair_finished', 'done'];

/** The unit's cleaning jobs and maintenance jobs, each with its own date range and status chips, every job (not only
 *  the latest few). Filters live in the address: ?jfrom=&jto= for both lists, ?clean= and ?repair= for the chips. */
export default function JobsTab({ unitId, stem }: { unitId: string; stem: string }) {
  const [params, setParams] = useSearchParams();
  const from = params.get('jfrom') ?? '', to = params.get('jto') ?? '';
  const clean = (params.get('clean') ?? 'all') as CleanStatus | 'all';
  const repair = (params.get('repair') ?? 'all') as RepairStatus | 'all';
  const q = useApi<Payload>(`/units/jobs?unitId=${encodeURIComponent(unitId)}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`);
  const set = (patch: Record<string, string>) => setParams(p => {
    const n = new URLSearchParams(p);
    for (const [k, v] of Object.entries(patch)) { if (v && v !== 'all') n.set(k, v); else n.delete(k); }
    return n;
  }, { replace: true });

  const cleaning = q.data?.cleaning ?? null, repairs = q.data?.maintenance ?? null;
  const cleanCount = (k: CleanStatus | 'all') => cleaning ? (k === 'all' ? cleaning.length : cleaning.filter(r => r.status === k).length) : undefined;
  const repairCount = (k: RepairStatus | 'all') => repairs ? (k === 'all' ? repairs.length : repairs.filter(r => r.status === k).length) : undefined;
  const range = <DateRange from={from} to={to} onChange={(f, t) => set({ jfrom: f, jto: t })} />;
  const money = repairs?.some(r => r.quotedAmount !== undefined) ?? false;

  const cleanColumns = useMemo<Column<CleanRow>[]>(() => [
    { key: 'day', label: 'Date', type: 'date', value: t => t.day, width: 110, hideable: false },
    { key: 'title', label: 'Cleaning job', value: t => t.title, width: 180 },
    { key: 'kind', label: 'Type', value: t => humanize(t.kind), width: 100 },
    { key: 'assignee', label: 'Cleaner', type: 'person', value: t => t.assigneeName ?? 'Unassigned', width: 180,
      // Several cleaners on one job: their names, not one avatar for the lot.
      render: t => (t.cleaners?.length ?? 0) > 1 ? <span className="text-copy block truncate" title={t.assigneeName ?? undefined}>{t.assigneeName}</span> : <PersonCell name={t.assigneeName ?? 'Unassigned'} /> },
    { key: 'when', label: 'Due or done', type: 'datetime', value: t => t.completedAt ?? t.dueAt, width: 140, sub: t => (t.completedAt ? 'Done' : t.dueAt ? 'Due' : null) },
    { key: 'status', label: 'Status', type: 'status', value: t => STATUS_VOCAB.cleaning[t.status].label, filter: false, width: 150,
      status: t => STATUS_VOCAB.cleaning[t.status] },
  ], []);
  const repairColumns = useMemo<Column<RepairRow>[]>(() => [
    { key: 'reported', label: 'Reported', type: 'date', value: m => m.reportedAt, width: 110, hideable: false },
    { key: 'title', label: 'Job', value: m => m.title, width: 200,
      render: m => (
        <span className="flex items-center gap-2 min-w-0">
          <span className="font-semibold whitespace-nowrap overflow-hidden text-ellipsis" title={m.title}>{m.title}</span>
          {m.blocksUnit && <StatusBadge tone="critical" label="Blocks the unit" size="sm" />}
        </span>
      ),
      sub: m => (m.detail ? <span title={m.detail}>{m.detail}</span> : null) },
    { key: 'vendor', label: 'Assigned to', value: m => m.vendorName, width: 150 },
    { key: 'charge', label: 'Charged to', value: m => CHARGE_LABEL[m.chargeTo] ?? humanize(m.chargeTo), width: 130 },
    { key: 'status', label: 'Status', type: 'status', value: m => STATUS_VOCAB.maintenance[m.status].label, filter: false, width: 170,
      status: m => STATUS_VOCAB.maintenance[m.status] },
    ...(money ? [{ key: 'amount', label: 'Amount', type: 'money' as const, value: (m: RepairRow) => m.finalAmount ?? m.quotedAmount ?? null, width: 120,
      sub: (m: RepairRow) => (m.finalAmount != null ? 'Final' : m.quotedAmount != null ? 'Quoted' : null) }] : []),
  ], [money]);

  const head = (title: string, n: number | undefined) => (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[16px] font-semibold tracking-[-0.01em]">{title}</span>
      <span className="text-meta text-muted-ink min-h-[18px]">{n == null ? 'Loading…' : from || to ? `${n} in these dates` : `${n} in all`}</span>
    </div>
  );
  const shownClean = cleaning ? (clean === 'all' ? cleaning : cleaning.filter(r => r.status === clean)) : null;
  const shownRepair = repairs ? (repair === 'all' ? repairs : repairs.filter(r => r.status === repair)) : null;

  return (
    <>
      <Card>
        <DataTable<CleanRow> id="unit.tasks" urlPrefix="tasks." bare noViews noColumns pageSize={25} maxHeight="none"
          columns={cleanColumns} rows={shownClean} rowKey={t => t.id} loading={q.loading} error={q.error} onRetry={q.reload}
          noun={['cleaning job', 'cleaning jobs']} exportName={`${stem}-cleaning-jobs`}
          filtered={!!(from || to || clean !== 'all')} onClearFilters={() => set({ jfrom: '', jto: '', clean: '' })}
          empty={{ title: from || to || clean !== 'all' ? 'No cleaning job matches.' : 'No cleaning jobs for this unit.', icon: 'Sparkles' }}
          header={
            <div className="py-4 px-5 flex flex-col gap-3 [border-bottom:1px_solid_var(--color-line-soft)]">
              {head('Cleaning jobs', cleaning?.length)}
              <StatusChips label="Cleaning job status" value={clean} onChange={k => set({ clean: k })}
                options={[{ key: 'all' as const, label: 'All', count: cleanCount('all') }, ...CLEAN_ORDER.map(k => ({ key: k, label: STATUS_VOCAB.cleaning[k].label, count: cleanCount(k) }))]} />
            </div>
          }
          toolbar={range}
          renderCard={t => (
            <span className="flex items-center gap-3">
              <span className="flex flex-col gap-[2px] flex-1 min-w-0">
                <span className="text-copy font-semibold truncate">{t.day ? dateShort(t.day) : 'No date'} · {humanize(t.kind)}</span>
                <span className="text-meta text-muted-ink truncate">{t.assigneeName ?? 'Unassigned'}</span>
              </span>
              <StatusBadge label={STATUS_VOCAB.cleaning[t.status].label} tone={STATUS_VOCAB.cleaning[t.status].tone} size="sm" />
            </span>
          )} />
      </Card>
      <Card>
        <DataTable<RepairRow> id="unit.maintenance" urlPrefix="jobs." bare noViews noColumns pageSize={25} maxHeight="none"
          columns={repairColumns} rows={shownRepair} rowKey={m => m.id} loading={q.loading} error={q.error} onRetry={q.reload}
          noun={['maintenance job', 'maintenance jobs']} exportName={`${stem}-maintenance`}
          filtered={!!(from || to || repair !== 'all')} onClearFilters={() => set({ jfrom: '', jto: '', repair: '' })}
          empty={{ title: from || to || repair !== 'all' ? 'No maintenance job matches.' : 'No maintenance jobs reported.', icon: 'Wrench' }}
          header={
            <div className="py-4 px-5 flex flex-col gap-3 [border-bottom:1px_solid_var(--color-line-soft)]">
              {head('Maintenance', repairs?.length)}
              <StatusChips label="Maintenance job status" value={repair} onChange={k => set({ repair: k })}
                options={[{ key: 'all' as const, label: 'All', count: repairCount('all') }, ...REPAIR_ORDER.map(k => ({ key: k, label: STATUS_VOCAB.maintenance[k].label, count: repairCount(k) }))]} />
            </div>
          }
          toolbar={range}
          renderCard={m => (
            <span className="flex items-center gap-3">
              <span className="flex flex-col gap-[2px] flex-1 min-w-0">
                <span className="text-copy font-semibold truncate">{m.title}</span>
                <span className="text-meta text-muted-ink truncate">{dateShort(m.reportedAt)} · {m.vendorName ?? 'Unassigned'}</span>
              </span>
              <StatusBadge label={STATUS_VOCAB.maintenance[m.status].label} tone={STATUS_VOCAB.maintenance[m.status].tone} size="sm" />
            </span>
          )} />
      </Card>
    </>
  );
}
