import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { StatRow, StatTile } from '../components/Metric';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { StatusBadge } from '../components/StatusBadge';
import { DataTable, type Column } from '../components/DataTable';
import { FilterBar } from '../components/FilterBar';
import { useApi } from '../lib/useApi';
import { useSession } from '../lib/session';
import { mayRun } from '../lib/areaAccess';
import { date, titleCase, plural, buildingName } from '../lib/format';
import { cx, TONE } from '../lib/design-tokens';
import { useUrlState, SearchBox } from './finance/listKit';
import { LettingModal, LETTING_STATUS, leftText, type Letting, type LettingsPayload } from './units/LettingTab';
import { mayEditUnits } from './units/shared';

/** Agent to let (staff sheet UNIT, 17 Oct 2026): every unit we are finding a long-term tenant for, on the owner's
 *  behalf. Rented ones whose agreement ends within 90 days come first, flagged, so they are let again for next year. */

type Filter = 'all' | 'looking' | 'rented' | 'soon' | 'closed';

export default function LettingsPage() {
  const { data, loading, error, reload } = useApi<LettingsPayload>('/lettings');
  const roster = useApi<{ data: { id: string; unitNumber: string; propertyName: string; ownerName: string }[] }>('/units');
  const { user } = useSession();
  const canEdit = mayRun(user, 'agentToLet') || mayEditUnits(user);
  const money = canEdit;
  const navigate = useNavigate();
  const url = useUrlState();
  const [modal, setModal] = useState<null | { letting: Letting | null }>(null);
  const filter = (['looking', 'rented', 'soon', 'closed'].includes(url.get('state')) ? url.get('state') : 'all') as Filter;
  const q = url.get('q').toLowerCase();
  const rows = useMemo(() => data?.data ?? [], [data]);
  const counts = useMemo(() => ({
    all: rows.length, looking: rows.filter(r => r.status === 'looking').length, rented: rows.filter(r => r.status === 'rented').length,
    soon: rows.filter(r => r.remind).length, closed: rows.filter(r => r.status === 'closed').length,
  }), [rows]);
  const visible = useMemo(() => rows.filter(r => (filter === 'all' || (filter === 'soon' ? r.remind : r.status === filter))
    && (!q || [r.unitLabel, r.ownerName, r.tenantName ?? ''].some(s => s.toLowerCase().includes(q))))
    // Until a column is sorted: due to be let again first, then looking, then the rest.
    .sort((a, b) => Number(b.remind) - Number(a.remind) || (a.remind ? (a.daysLeft ?? 0) - (b.daysLeft ?? 0) : 0) || Number(b.status === 'looking') - Number(a.status === 'looking')), [rows, filter, q]);
  const days = data?.remindDays ?? 90;

  const columns: Column<Letting>[] = [
    { key: 'unit', label: 'Unit', value: r => r.unitLabel, hideable: false, width: 180, render: r => <span className="font-medium truncate block" title={r.unitLabel}>{r.unitLabel}</span> },
    { key: 'building', label: 'Building', value: r => buildingName(r.building), hidden: true, width: 160, filter: { kind: 'select' } },
    { key: 'owner', label: 'Owner', type: 'person', value: r => titleCase(r.ownerName), width: 150 },
    { key: 'status', label: 'Status', type: 'status', value: r => LETTING_STATUS[r.status].label, status: r => LETTING_STATUS[r.status], width: 140, filter: { kind: 'select' } },
    { key: 'tenant', label: 'Tenant', value: r => r.tenantName, width: 150, sub: r => r.tenantPhone },
    { key: 'starts', label: 'Starts', type: 'date', value: r => r.startsOn, width: 110 },
    { key: 'ends', label: 'Ends', type: 'date', value: r => r.endsOn, width: 150,
      render: r => (
        <span className="flex flex-col gap-[2px]">
          <span className="tabular-nums whitespace-nowrap">{r.endsOn ? date(r.endsOn) : '—'}</span>
          {r.status === 'rented' && r.daysLeft != null && <span className="self-start"><StatusBadge tone={r.remind ? 'warning' : 'neutral'} label={leftText(r.daysLeft)} size="sm" /></span>}
        </span>
      ) },
    ...(money ? [
      { key: 'rent', label: 'Rent / month', type: 'money', value: (r: Letting) => r.monthlyRent ?? null, width: 110 } satisfies Column<Letting>,
      { key: 'fee', label: 'Agent fee', type: 'money', value: (r: Letting) => r.agentFee ?? null, width: 100 } satisfies Column<Letting>,
    ] : []),
    { key: 'notes', label: 'Notes', value: r => r.notes, hidden: true, width: 220 },
  ];

  const unitOptions = (roster.data?.data ?? []).map(u => ({ id: u.id, label: `${buildingName(u.propertyName)} ${u.unitNumber}`, hint: titleCase(u.ownerName) }));
  const tiles: { key: Filter; label: string; hint: string; tone?: 'warning' | 'success' }[] = [
    { key: 'looking', label: 'Looking for a tenant', hint: 'Not rented yet', tone: undefined },
    { key: 'rented', label: 'Rented', hint: 'Agreement running', tone: 'success' },
    { key: 'soon', label: `Ending within ${days} days`, hint: 'Find a tenant for next year', tone: 'warning' },
  ];
  return (
    <>
      <PageHeader title="Agent to let" sub={data ? `${plural(counts.all, 'unit')} we are letting for owners · ${counts.soon} ending within ${days} days` : 'Loading…'}
        primary={canEdit && data?.ready !== false ? <Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal({ letting: null })}>Record a unit to let</Button> : undefined} />
      {/* Each tile is the count and the filter (StatTile, Conts DS v2); the third spans the row on a phone. */}
      <StatRow cols={3}>
        {tiles.map((t, i) => {
          const n = data ? counts[t.key] : undefined, on = filter === t.key;
          return (
            <StatTile key={t.key} label={t.label} value={n === undefined ? undefined : String(n)} hint={t.hint} active={on}
              tone={t.tone === 'warning' && n ? 'warning' : undefined} className={i === tiles.length - 1 ? 'max-sm:col-span-2' : undefined}
              onClick={() => url.set({ state: on ? null : t.key, page: null })} />
          );
        })}
      </StatRow>
      <DataTable<Letting> id="lettings" columns={columns} rows={data ? visible : null} rowKey={r => r.id} loading={loading} error={error} onRetry={reload}
        onRowClick={r => (canEdit ? setModal({ letting: r }) : navigate(`/properties/units/${encodeURIComponent(r.unitId)}?tab=letting`))}
        rowTone={r => (r.remind ? 'warning' : r.status === 'closed' ? 'muted' : null)}
        viewParams={['state', 'q']} filtered={filter !== 'all' || !!q} onClearFilters={() => url.set({ state: null, q: null, page: null })}
        noun={['letting', 'lettings']} exportName="agent-to-let"
        empty={{ title: data?.ready === false ? 'Agent to let needs the latest database update.' : 'No units to let yet.', body: 'Record a unit we are finding a long-term tenant for.', icon: 'KeyRound' }}
        header={<div className="py-3 px-[22px] max-md:px-4 [border-bottom:1px_solid_var(--color-line)]">
          <FilterBar<Filter> label="Letting status" value={filter} onChange={k => url.set({ state: k === 'all' ? null : k, page: null })}
            views={[{ key: 'all', label: 'All', count: data ? counts.all : undefined }, { key: 'looking', label: 'Looking', count: counts.looking }, { key: 'rented', label: 'Rented', count: counts.rented },
              { key: 'soon', label: `Ending within ${days} days`, count: counts.soon }, { key: 'closed', label: 'Closed', count: counts.closed }]} />
        </div>}
        toolbar={<SearchBox className="flex-1 min-w-[200px]" label="Search lettings" placeholder="Search unit, owner or tenant" value={url.get('q')} onChange={v => url.set({ q: v || null, page: null })} />}
        renderCard={r => (
          <span className="flex flex-col gap-1 min-w-0 w-full">
            <span className="flex items-start justify-between gap-2"><span className="text-copy font-medium min-w-0 [overflow-wrap:anywhere]">{r.unitLabel}</span><StatusBadge tone={LETTING_STATUS[r.status].tone} label={LETTING_STATUS[r.status].label} size="sm" /></span>
            <span className="text-meta text-muted-ink">{titleCase(r.ownerName)}{r.tenantName ? ` · tenant ${titleCase(r.tenantName)}` : ''}</span>
            {r.endsOn && <span className={cx('text-meta', r.remind ? TONE.warning.text : 'text-muted-ink')}>{r.startsOn ? date(r.startsOn) : "?"} to {date(r.endsOn)}{r.status === 'rented' && r.daysLeft != null ? ` · ${leftText(r.daysLeft)}` : ''}</span>}
          </span>
        )}
      />
      {modal && <LettingModal letting={modal.letting} units={unitOptions} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
    </>
  );
}
