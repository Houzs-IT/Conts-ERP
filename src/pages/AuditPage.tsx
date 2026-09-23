import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import Icon from '../components/Icon';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { dateTime } from '../lib/format';
import { cx } from '../lib/design-tokens';

interface AuditRow {
  id: number; actorLabel: string; action: string; entityTable: string; entityId: string;
  before: Record<string, unknown> | null; after: Record<string, unknown> | null;
  source: string; occurredAt: string;
}
interface Payload { generatedAt: string; page: number; pageSize: number; total: number; data: AuditRow[] }

/** entity_table -> friendly label. Keep in sync with every `audit()` call's entityTable — see functions/_lib/db.ts. */
const ENTITY_LABELS: Record<string, string> = {
  users: 'Users', owners: 'Owners', owner_contracts: 'Owner contracts', owner_statements: 'Owner statements',
  properties: 'Properties', units: 'Units', reservations: 'Reservations', reviews: 'Reviews',
  access_credentials: 'Access and keys', documents: 'Documents', expenses: 'Expenses', payouts: 'Payouts',
  tasks: 'Tasks', maintenance_issues: 'Maintenance issues', maintenance_skus: 'Maintenance parts',
  maintenance_stock_moves: 'Maintenance stock', inventory_items: 'Inventory', inspections: 'Inspections',
  message_threads: 'Message threads', messages: 'Messages', cleaners: 'Cleaners', integrations: 'Integrations',
  automations: 'Automations', settings: 'Settings', password_reset_tokens: 'Password resets',
};
const entityLabel = (t: string) => ENTITY_LABELS[t] ?? t.replace(/_/g, ' ');
const actionLabel = (a: string) => a.replace(/[._]/g, ' ');

const PAGE_SIZE = 50;
const COLS = 'grid-cols-[160px_minmax(140px,1fr)_minmax(160px,1.3fr)_minmax(140px,1fr)_110px_28px]';

export default function AuditPage() {
  const [params, setParams] = useSearchParams();
  function updateParams(mut: (p: URLSearchParams) => void) {
    const next = new URLSearchParams(params);
    mut(next);
    next.delete('page'); // any filter change starts back at page 1
    setParams(next, { replace: true });
  }

  const entityTable = params.get('entityTable') ?? '';
  const entityId = params.get('entityId') ?? '';
  const q = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page') ?? 1));

  const query = new URLSearchParams();
  if (entityTable) query.set('entityTable', entityTable);
  if (entityId.trim()) query.set('entityId', entityId.trim());
  query.set('page', String(page));
  query.set('pageSize', String(PAGE_SIZE));

  const { data, loading, error, reload } = useApi<Payload>(`/audit?${query.toString()}`);
  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const shown = q.trim()
    ? rows.filter(r => `${r.actorLabel} ${actionLabel(r.action)}`.toLowerCase().includes(q.trim().toLowerCase()))
    : rows;

  const [openId, setOpenId] = useState<number | null>(null);
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader title="Audit trail" sub={`Every financial and destructive action, who did it and when · ${total} ${total === 1 ? 'entry' : 'entries'}`} />

      {error && <StaleBanner message={error} onRetry={reload} />}

      <Card>
        <div className="flex gap-[10px] flex-wrap items-center py-3 px-[22px] [border-bottom:1px_solid_var(--color-line)]">
          <select value={entityTable} onChange={e => updateParams(p => { if (e.target.value) p.set('entityTable', e.target.value); else p.delete('entityTable'); })}
            className="h-9 px-3 py-0 rounded-control border border-solid border-line bg-white text-ink [font:inherit] text-[13px] cursor-pointer">
            <option value="">All record types</option>
            {Object.keys(ENTITY_LABELS).map(t => <option key={t} value={t}>{ENTITY_LABELS[t]}</option>)}
          </select>
          <input value={entityId} onChange={e => updateParams(p => { if (e.target.value.trim()) p.set('entityId', e.target.value.trim()); else p.delete('entityId'); })}
            placeholder="Filter by record ID"
            className="h-9 w-[220px] box-border rounded-control border border-solid border-line bg-white text-ink [font:inherit] text-[13px] px-3 py-0 outline-none" />
          <input value={q} onChange={e => updateParams(p => { if (e.target.value.trim()) p.set('q', e.target.value); else p.delete('q'); })}
            placeholder="Search by person or action"
            className="h-9 flex-1 min-w-[200px] box-border rounded-control border border-solid border-line bg-white text-ink [font:inherit] text-[13px] px-3 py-0 outline-none" />
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[820px]">
            <div className={cx(COLS, 'grid gap-[14px] py-[9px] px-[22px] bg-muted [border-bottom:1px_solid_var(--color-line)]')}>
              {['When', 'Actor', 'Action', 'Record', 'Source', ''].map(h => (
                <div key={h} className="text-[12px] font-semibold text-muted-ink">{h}</div>
              ))}
            </div>

            {loading && rows.length === 0 ? <TableSkeleton rows={8} cols={6} /> : shown.length === 0 ? (
              <div className="py-[34px] px-[22px] text-center text-[13.5px] text-muted-ink">No activity matches these filters.</div>
            ) : shown.map(r => {
              const open = openId === r.id;
              return (
                <div key={r.id} className="[border-bottom:1px_solid_var(--color-line-soft)]">
                  <div role="button" tabIndex={0} onClick={() => setOpenId(open ? null : r.id)}
                    onKeyDown={e => { if (e.key === 'Enter') setOpenId(open ? null : r.id); }}
                    className={cx(COLS, 'grid gap-[14px] items-center min-h-[50px] py-[9px] px-[22px] cursor-pointer')}>
                    <div className="text-[12.5px] text-muted-ink whitespace-nowrap">{dateTime(r.occurredAt)}</div>
                    <div className="text-[13px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">{r.actorLabel}</div>
                    <div className="text-[13px] whitespace-nowrap overflow-hidden text-ellipsis">{actionLabel(r.action)}</div>
                    <div className="text-[12.5px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">
                      {entityLabel(r.entityTable)} <span className="font-mono text-[11px]">{r.entityId.slice(0, 8)}</span>
                    </div>
                    <div className="text-[12px] text-muted-ink whitespace-nowrap">{r.source.replace(/_/g, ' ')}</div>
                    <div className="flex justify-center">
                      <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size="sm" color="var(--color-line)" />
                    </div>
                  </div>
                  {open && <AuditDiff before={r.before} after={r.after} />}
                </div>
              );
            })}
          </div>
        </div>

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3 py-[10px] px-[22px] flex-wrap">
            <span className="text-[12px] text-muted-ink">Showing {from}–{to} of {total}</span>
            <div className="flex gap-[9px]">
              <button type="button" disabled={page <= 1} onClick={() => updateParams(p => p.set('page', String(page - 1)))}
                className="h-8 px-[13px] py-0 rounded-pill border border-solid border-line bg-page text-[12.5px] font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                Previous
              </button>
              <button type="button" disabled={page >= lastPage} onClick={() => updateParams(p => p.set('page', String(page + 1)))}
                className="h-8 px-[13px] py-0 rounded-pill border border-solid border-line bg-page text-[12.5px] font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                Next
              </button>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

/** Every key touched by either side, oldest state next to newest — a plain read, not a code diff. */
function AuditDiff({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) {
  if (!before && !after) return <div className="py-[10px] px-[22px] pl-[46px] text-[12px] text-muted-ink bg-page">No before/after detail was recorded for this entry.</div>;
  const keys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])).sort();
  const show = (v: unknown) => (v === undefined ? '—' : v === null ? 'empty' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return (
    <div className="py-[10px] px-[22px] pl-[46px] bg-page">
      <div className="border border-solid border-line rounded-card overflow-hidden bg-card">
        {keys.map((k, i) => {
          const b = before?.[k], a = after?.[k];
          const changed = before && after && show(b) !== show(a);
          return (
            <div key={k} className={cx('grid grid-cols-[160px_1fr] gap-3 py-[7px] px-[13px]', i < keys.length - 1 && '[border-bottom:1px_solid_var(--color-line-soft)]')}>
              <span className="text-[11.5px] font-medium text-muted-ink">{k.replace(/_/g, ' ')}</span>
              <span className="text-[12px] font-mono break-all">
                {before && after ? (changed ? <>{show(b)} <span className="text-muted-ink">→</span> {show(a)}</> : show(a)) : show(a ?? b)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
