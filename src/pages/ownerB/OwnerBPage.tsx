import { lazy, Suspense, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';
import { DataTable, type Column } from '../../components/DataTable';
import { MoneyText } from '../../components/MoneyText';
import { RowsSkeleton } from '../../components/Loading';
import { Segmented } from '../../components/ops/OpsUi';
import { useApi } from '../../lib/useApi';
import { useSession } from '../../lib/session';
import { areaOpen } from '../../lib/navigation';
import { titleCase, plural } from '../../lib/format';
import { useUrlState, usePhone, SearchBox } from '../finance/listKit';
import { type Owner, type Payload, netOf } from '../owners/shared';
import { portalBadge } from '../owners/portalAccess';
import { SampleTab } from './SampleTab';

const StatementsPage = lazy(() => import('../StatementsPage'));
const PayoutsPage = lazy(() => import('../PayoutsPage'));

type Tab = 'owners' | 'statements' | 'payouts' | 'sample';
/** The list keys the Statements and Payouts tabs keep in the address; cleared when the tab changes. */
const TAB_KEYS = ['q', 'month', 'sort', 'state', 'period', 'page', 'size'];

/**
 * Owner B (owner, 2 Nov 2026): the integrated owners module, a Beta built beside Owners (A) so the two can be compared.
 * One place for the owners list and profiles, View as owner (an owner's real portal, read-only), the month's
 * statements and payouts, and the sample owner portal that replaced the Owner Showcase. Owners (A) is unchanged.
 * Each tab follows its own permission area: Owners needs Owners, Statements and Payouts need Finance.
 */
export default function OwnerBPage() {
  const url = useUrlState();
  const { user } = useSession();
  const owners = !!user && areaOpen(user.role, 'owners', user.access);
  const money = !!user && areaOpen(user.role, 'finance', user.access);
  const phone = usePhone();
  const asked = url.get('view') as Tab;
  // Money is not worked on the phone (owner, 11 Oct 2026): as on Owners, Statements and Payouts show there only when a link opened one.
  const moneyTabs = money && (!phone || asked === 'statements' || asked === 'payouts');
  const tabs = useMemo(() => [
    ...(owners ? [{ value: 'owners' as Tab, label: 'Owners' }] : []),
    ...(moneyTabs ? [{ value: 'statements' as Tab, label: 'Statements' }, { value: 'payouts' as Tab, label: 'Payouts' }] : []),
    { value: 'sample' as Tab, label: 'Owner portal (sample)' },
  ], [owners, moneyTabs]);
  const tab: Tab = tabs.some(t => t.value === asked) ? asked : tabs[0].value;
  const pick = (v: Tab) => url.set({ view: v === tabs[0].value ? null : v, ...Object.fromEntries(TAB_KEYS.map(k => [k, null])) });

  return (
    <>
      <PageHeader title="Owner B"
        badge={<StatusBadge tone="info" label="Beta" />}
        sub="The new owners module, beside Owners for comparison: owners, View as owner, statements, payouts and the sample owner portal." />
      <Segmented<Tab> label="Owner B" value={tab} onChange={pick} options={tabs} className="self-start" />
      {tab === 'owners' && <OwnerBList money={money} />}
      {(tab === 'statements' || tab === 'payouts') && (
        <Suspense fallback={<RowsSkeleton rows={8} cols={5} />}>
          {tab === 'statements' ? <StatementsPage embedded /> : <PayoutsPage embedded />}
        </Suspense>
      )}
      {tab === 'sample' && <SampleTab />}
    </>
  );
}

const unitsText = (o: Owner) => o.units.length === 0 ? 'No units' : o.units.length === 1 ? o.units[0].unitLabel : plural(o.units.length, 'unit');

function OwnerBList({ money }: { money: boolean }) {
  const url = useUrlState();
  const navigate = useNavigate();
  const q = url.get('q').trim().toLowerCase();
  const { data, loading, error, reload } = useApi<Payload>('/owners');
  const all = useMemo(() => [...(data?.data ?? [])].sort((a, b) => a.displayName.localeCompare(b.displayName)), [data]);
  const rows = useMemo(() => all.filter(o => !q || [o.displayName, o.email, o.phone ?? '', ...o.units.map(u => u.unitLabel)].join(' ').toLowerCase().includes(q)), [all, q]);
  const open = (o: Owner) => navigate(`/owner-b/${encodeURIComponent(o.id)}`);
  const viewAs = (o: Owner) => navigate(`/owner-b/${encodeURIComponent(o.id)}/portal`);

  const columns: Column<Owner>[] = [
    { key: 'name', label: 'Owner', width: 220, value: o => o.displayName,
      render: o => <span className="font-medium">{titleCase(o.displayName)}</span>, sub: o => o.email },
    { key: 'units', label: 'Units', width: 220, value: o => o.units.length, render: o => unitsText(o),
      sub: o => (o.units.length > 1 ? o.units.map(u => u.unitLabel.split(' ').pop()).join(', ') : null) },
    { key: 'portal', label: 'Portal', type: 'status', width: 120, value: o => portalBadge(o, true).label, status: o => portalBadge(o, true) },
    ...(money ? [{ key: 'net', label: 'Net this month', type: 'money', width: 140, align: 'right', value: (o: Owner) => netOf(o) } satisfies Column<Owner>] : []),
    ...(money ? [{ key: 'viewAs', label: '', width: 150, align: 'right', noExport: true, sortable: false, filter: false,
      render: (o: Owner) => (
        <Button size="sm" variant="secondary" icon={<Icon name="Eye" size="sm" />} disabled={o.units.length === 0}
          disabledReason="This owner has no units, so their portal is empty."
          onClick={e => { e.stopPropagation(); viewAs(o); }}>View as owner</Button>
      ) } satisfies Column<Owner>] : []),
  ];

  return (
    <DataTable<Owner>
      id="owner-b" columns={columns} rows={data ? rows : null} rowKey={o => o.id} loading={loading} error={error} onRetry={reload}
      onRowClick={open} pageSize={0} viewParams={['q']} filtered={!!q} onClearFilters={() => url.set({ q: null })}
      noun={['owner', 'owners']} exportName="owners-b"
      empty={{ title: 'No owners yet.', body: 'Owners are added on Owners; they appear here at once.' }}
      toolbar={<SearchBox className="flex-1 min-w-[200px]" label="Search owners" placeholder="Search owner, email, phone or unit" value={url.get('q')} onChange={v => url.set({ q: v || null })} />}
      renderCard={o => (
        <span className="flex items-center gap-3 min-w-0">
          <span className="flex flex-col gap-[2px] min-w-0 flex-1">
            <span className="text-copy font-medium truncate">{titleCase(o.displayName)}</span>
            <span className="text-meta text-muted-ink truncate">{unitsText(o)} · {portalBadge(o, true).label}</span>
          </span>
          {money && <MoneyText sen={netOf(o)} mode="exact" tone="auto" strong className="text-copy shrink-0" />}
          {money && o.units.length > 0 && (
            <Link to={`/owner-b/${encodeURIComponent(o.id)}/portal`} onClick={e => e.stopPropagation()} aria-label={`View as ${titleCase(o.displayName)}`}
              className="w-11 h-11 flex-none grid place-items-center rounded-control border border-solid border-line text-ink">
              <Icon name="Eye" size="sm" />
            </Link>
          )}
        </span>
      )}
    />
  );
}
