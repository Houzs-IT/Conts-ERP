import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { StatusBadge } from '../components/StatusBadge';
import { DataTable, type Column } from '../components/DataTable';
import { FilterBar } from '../components/FilterBar';
import { useConfirm } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { date, plural, rm, titleCase } from '../lib/format';
import type { StatusTone } from '../lib/status';
import { useUrlState, SearchBox } from './finance/listKit';
import { ScheduledChanges, type ScheduleUnit } from './units/ScheduledChanges';
import { CLEAN_KINDS } from './units/UnitCleaning';

type Kind = 'cleaning' | 'maintenance' | 'contract';
interface Figures { owner: number | null; cost: number | null }
export interface ScheduledRow {
  id: string; kind: Kind; scope: 'unit' | 'list'; unitId: string | null; unitLabel: string; ownerName: string | null;
  itemId: string | null; what: string; cleanKind: string | null; effectiveFrom: string; setBy: string | null; setAt: string | null;
  now?: Figures | null; next?: Figures | null; layouts?: number | null; termsNow?: string | null; termsNext?: string;
}
interface Payload { dated: boolean; mayEdit: boolean; money: boolean; rows: ScheduledRow[] }

const KIND: Record<Kind, { label: string; tone: StatusTone }> = {
  cleaning: { label: 'Cleaning', tone: 'info' }, maintenance: { label: 'Maintenance', tone: 'warning' }, contract: { label: 'Contract', tone: 'accent' },
};
const nameOf = (r: ScheduledRow) => CLEAN_KINDS.find(([k]) => k === r.cleanKind)?.[1] ?? r.what;
// Empty today means no price at all; empty on a change means the list price from that date.
const amounts = (f: Figures | null | undefined, empty: string) => {
  const one = (sen: number | null) => (sen == null ? empty : rm(sen));
  return f ? `Owner ${one(f.owner)} · Cost ${one(f.cost)}` : null;
};
const textNow = (r: ScheduledRow) => (r.kind === 'contract' ? r.termsNow ?? 'No earlier contract' : amounts(r.now, 'not set'));
const textNext = (r: ScheduledRow) => (r.kind === 'contract' ? r.termsNext ?? null : r.layouts ? `New prices for ${plural(r.layouts, 'layout')}` : amounts(r.next, 'list price'));

/** Scheduled changes (owner, 30 Oct 2026): one list of everything set to change on a later date, so the office can see
 *  what is coming. A price change is cancelled here; a contract is changed on the unit's Contract tab, a list price
 *  under Service prices. New changes are added in the side panel. */
export default function ScheduledChangesPage() {
  const { data, loading, error, reload } = useApi<Payload>('/units/scheduled-changes');
  const roster = useApi<{ data: { id: string; unitNumber: string; propertyName: string; ownerName: string }[] }>('/units');
  const navigate = useNavigate();
  const toast = useToast();
  const url = useUrlState();
  const [dialog, ask] = useConfirm();
  const [adding, setAdding] = useState(false);
  const filter = (['cleaning', 'maintenance', 'contract'].includes(url.get('kind')) ? url.get('kind') : 'all') as Kind | 'all';
  const q = url.get('q').toLowerCase();
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const count = (k: Kind) => rows.filter(r => r.kind === k).length;
  const visible = useMemo(() => rows.filter(r => (filter === 'all' || r.kind === filter)
    && (!q || [r.unitLabel, r.ownerName ?? '', nameOf(r)].some(s => s.toLowerCase().includes(q)))), [rows, filter, q]);
  const units: ScheduleUnit[] = (roster.data?.data ?? []).map(u => ({ id: u.id, label: `${u.propertyName} ${u.unitNumber}`, building: u.propertyName, hint: titleCase(u.ownerName) }));

  const open = (r: ScheduledRow) => navigate(r.scope === 'list' ? '/system/settings/services' : `/properties/units/${encodeURIComponent(r.unitId ?? '')}${r.kind === 'contract' ? '?tab=contract' : ''}`);
  async function cancel(r: ScheduledRow) {
    const sure = await ask({ title: 'Cancel this scheduled change?', body: `${nameOf(r)} on ${r.unitLabel} from ${date(r.effectiveFrom)}. The unit keeps the price it has now.`, confirmLabel: 'Cancel the change', cancelLabel: 'Keep it', danger: true });
    if (sure === null) return;
    try {
      await api.del(`/housekeeping/unit-prices?unitId=${encodeURIComponent(r.unitId ?? '')}&itemId=${encodeURIComponent(r.itemId ?? '')}&effectiveFrom=${r.effectiveFrom}`);
      toast({ tone: 'success', title: 'Scheduled change cancelled.', body: `${nameOf(r)} on ${r.unitLabel} from ${date(r.effectiveFrom)}.` });
      reload();
    } catch (e) { notifyFailure(e); }
  }

  const columns: Column<ScheduledRow>[] = [
    { key: 'from', label: 'Applies from', type: 'date', value: r => r.effectiveFrom, hideable: false, width: 110 },
    { key: 'unit', label: 'Unit', value: r => r.unitLabel, hideable: false, width: 150, render: r => <span className="font-medium truncate block" title={r.unitLabel}>{r.unitLabel}</span> },
    { key: 'kind', label: 'Type', type: 'status', value: r => KIND[r.kind].label, status: r => KIND[r.kind], width: 110 },
    { key: 'what', label: 'What changes', value: r => nameOf(r), width: 150 },
    { key: 'now', label: 'Now', value: r => textNow(r), width: 220 },
    { key: 'next', label: 'Changes to', value: r => textNext(r), width: 220 },
    { key: 'owner', label: 'Owner', type: 'person', value: r => (r.ownerName ? titleCase(r.ownerName) : null), hidden: true, width: 150 },
    { key: 'setBy', label: 'Set by', value: r => r.setBy, width: 120, sub: r => (r.setAt ? date(r.setAt) : null) },
    { key: 'action', label: '', value: () => null, hideable: false, filter: false, sortable: false, width: 90,
      render: r => (data?.mayEdit && r.scope === 'unit' && r.kind !== 'contract'
        ? <span onClick={e => e.stopPropagation()}><Button size="sm" variant="tertiary" onClick={() => void cancel(r)}>Cancel</Button></span>
        : <span className="text-meta text-muted-ink">Open</span>) },
  ];

  return (
    <>
      <PageHeader title="Scheduled changes" sub={data ? `${plural(rows.length, 'change')} waiting for a date` : 'Loading…'}
        primary={data?.mayEdit ? <Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setAdding(true)}>Schedule a change</Button> : undefined} />
      {data && !data.dated && <div className="py-[10px] px-[14px] rounded-control bg-gold-tint text-copy">Dated unit prices are not switched on yet. They need a database update (migration 0186). Contracts and list prices still show here.</div>}
      <DataTable<ScheduledRow> id="scheduled-changes" columns={columns} rows={data ? visible : null} rowKey={r => r.id} loading={loading} error={error} onRetry={reload}
        onRowClick={open} viewParams={['kind', 'q']} filtered={filter !== 'all' || !!q} onClearFilters={() => url.set({ kind: null, q: null, page: null })}
        noun={['change', 'changes']} exportName="scheduled-changes"
        empty={{ title: 'Nothing is scheduled.', body: 'Changes set to start on a later date show here.', icon: 'CalendarClock' }}
        header={<div className="py-3 px-[22px] max-md:px-4 [border-bottom:1px_solid_var(--color-line)]">
          <FilterBar<Kind | 'all'> label="Type of change" value={filter} onChange={k => url.set({ kind: k === 'all' ? null : k, page: null })}
            views={[{ key: 'all', label: 'All', count: data ? rows.length : undefined }, { key: 'cleaning', label: 'Cleaning', count: count('cleaning') },
              { key: 'maintenance', label: 'Maintenance', count: count('maintenance') }, ...(data?.money ? [{ key: 'contract' as const, label: 'Contract', count: count('contract') }] : [])]} />
        </div>}
        toolbar={<SearchBox className="flex-1 min-w-[200px]" label="Search scheduled changes" placeholder="Search unit, owner or item" value={url.get('q')} onChange={v => url.set({ q: v || null, page: null })} />}
        renderCard={r => (
          <span className="flex flex-col gap-1 min-w-0 w-full">
            <span className="flex items-start justify-between gap-2"><span className="text-copy font-medium min-w-0 [overflow-wrap:anywhere]">{r.unitLabel}</span><StatusBadge tone={KIND[r.kind].tone} label={KIND[r.kind].label} size="sm" /></span>
            <span className="text-meta text-muted-ink">{nameOf(r)} from {date(r.effectiveFrom)}</span>
            {textNext(r) && <span className="text-meta text-muted-ink">{textNext(r)}</span>}
          </span>
        )}
      />
      {adding && <ScheduledChanges units={units} money={!!data?.money} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
      {dialog}
    </>
  );
}
