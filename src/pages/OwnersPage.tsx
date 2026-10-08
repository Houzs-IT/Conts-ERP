import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { rm, rmShort, monthLabel, todayMyt, titleCase } from '../lib/format';
import { TONE, cx } from '../lib/design-tokens';
import {
  type Owner, type Payload,
  FALLBACK, netOf, grossOf, guaranteedOf, managedNetOf, managedGrossOf, terms,
  Roll, AddOwnerModal,
} from './owners/shared';
import { useUrlState, usePhone, ListCard, SearchBox, FilterSelect, Chip, MonthStepper, STICKY_HEAD, shiftMonth, useFinanceFilters } from './finance/listKit';

/**
 * Owners list. Each row opens the full owner profile at `#/owners/:id`
 * (OwnerProfilePage) — the real profile with per-unit P&L, expenses and the
 * owner-level default fee — rather than a small drawer. Add-owner lives here;
 * link unit, contract, invite, delete and the per-unit financials all live on
 * the profile. The rows, stats and fee model are shared with the profile so the
 * two surfaces never drift.
 *
 * About 120 owners: the whole list comes in one response (~60 KB) and is
 * searched and sorted here, which keeps sorting by net instant.
 */

const COLS = 'grid-cols-[minmax(0,1.7fr)_minmax(0,1.5fr)_minmax(0,0.9fr)_minmax(96px,0.85fr)_minmax(104px,0.9fr)_minmax(96px,0.75fr)]';

type SortKey = 'name' | 'units' | 'gross' | 'net';
const SORT_KEYS: SortKey[] = ['name', 'units', 'gross', 'net'];
type ModelFilter = '' | 'management' | 'grr' | 'none';

/** Terms shown for an owner in the list. A single-unit owner reads exactly as
 *  that unit's terms; a multi-unit owner shows the shared terms when every unit
 *  matches, otherwise "Mixed" (rather than misleadingly showing only the first
 *  unit's). No units → em dash. */
function ownerTerms(o: Owner): string {
  if (o.units.length === 0) return '—';
  const all = o.units.map(terms);
  return all.every(t => t === all[0]) ? all[0] : 'Mixed';
}
const unitsText = (o: Owner) => o.units.length === 0 ? 'No units yet' : o.units.length === 1 ? o.units[0].unitLabel : `${o.units.length} units`;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).map(n => n[0]).slice(0, 2).join('').toUpperCase();

export default function OwnersPage() {
  const url = useUrlState();
  const phone = usePhone();
  const thisMonth = todayMyt().slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(url.get('month')) ? url.get('month') : thisMonth;
  const q = url.get('q').toLowerCase();
  const building = url.get('building');
  const model = (['management', 'grr', 'none'].includes(url.get('model')) ? url.get('model') : '') as ModelFilter;
  const sortRaw = url.get('sort', 'name');
  const desc = sortRaw.startsWith('-');
  const sortKey: SortKey = SORT_KEYS.includes(sortRaw.replace(/^-/, '') as SortKey) ? sortRaw.replace(/^-/, '') as SortKey : 'name';

  const { data, loading, error, reload } = useApi<Payload>(`/owners${month === thisMonth ? '' : `?month=${month}`}`, FALLBACK);
  const filters = useFinanceFilters();
  const toast = useToast();
  const navigate = useNavigate();
  const [modal, setModal] = useState(false);

  const all = useMemo(() => data?.data ?? [], [data]);
  const counts = useMemo(() => ({
    all: all.length,
    management: all.filter(o => o.units.some(u => u.model === 'management')).length,
    grr: all.filter(o => o.units.some(u => u.model === 'grr')).length,
    none: all.filter(o => o.units.length === 0).length,
  }), [all]);

  const rows = useMemo(() => {
    const list = all.filter(o =>
      (!q || o.displayName.toLowerCase().includes(q) || (o.email ?? '').toLowerCase().includes(q) || o.units.some(u => u.unitLabel.toLowerCase().includes(q))) &&
      (!building || o.units.some(u => u.buildingId === building)) &&
      (!model || (model === 'none' ? o.units.length === 0 : o.units.some(u => u.model === model))));
    const val = (o: Owner) => sortKey === 'units' ? o.units.length : sortKey === 'gross' ? grossOf(o) : sortKey === 'net' ? netOf(o) : 0;
    list.sort((a, b) => sortKey === 'name'
      ? a.displayName.localeCompare(b.displayName) * (desc ? -1 : 1)
      : (val(a) - val(b)) * (desc ? -1 : 1) || a.displayName.localeCompare(b.displayName));
    return list;
  }, [all, q, building, model, sortKey, desc]);

  const unitCount = all.reduce((s, o) => s + o.units.length, 0);
  // Portfolio rollup — pure client compute over loaded owners, reusing the same per-owner net the profile shows.
  const portfolioNet = all.reduce((s, o) => s + netOf(o), 0);
  const portfolioGuaranteed = all.reduce((s, o) => s + guaranteedOf(o), 0);
  const portfolioManagedNet = all.reduce((s, o) => s + managedNetOf(o), 0);
  const portfolioManagedGross = all.reduce((s, o) => s + managedGrossOf(o), 0);
  const shownNet = rows.reduce((s, o) => s + netOf(o), 0);
  const shownGross = rows.reduce((s, o) => s + grossOf(o), 0);
  const filtered = !!(q || building || model);
  const monthText = month === thisMonth ? 'this month' : monthLabel(month);

  const openProfile = (id: string) => navigate(`/owners/${encodeURIComponent(id)}`);
  // Numbers sort biggest first on the first click; names A to Z.
  const sortBy = (k: SortKey) => url.set({ sort: sortKey === k ? (desc ? k : `-${k}`) : (k === 'name' ? null : `-${k}`) });

  async function addOwner(o: Omit<Owner, 'id' | 'units' | 'portalInvited' | 'contract' | 'defaultManagementFeePct'>) {
    try {
      const made = await api.post<{ id: string }>('/owners', o);
      toast({ tone: 'success', title: 'Owner added.', body: `${o.displayName} — link a unit next.` });
      setModal(false);
      navigate(`/owners/${encodeURIComponent(made.id)}`);
    } catch (e) {
      toast({ tone: 'critical', title: 'Owner was not added.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
    }
  }

  const Head = ({ k, label, right }: { k: SortKey; label: string; right?: boolean }) => (
    <button onClick={() => sortBy(k)} aria-sort={sortKey === k ? (desc ? 'descending' : 'ascending') : undefined}
      className={cx('p-0 bg-transparent border-none cursor-pointer font-sans text-meta font-semibold inline-flex items-center gap-1', right ? 'justify-end' : '', sortKey === k ? 'text-ink' : 'text-muted-ink')}>
      {label}{sortKey === k && <span aria-hidden className="text-caption">{desc ? '▼' : '▲'}</span>}
    </button>
  );

  return (
    <>
      <PageHeader title="Owners" sub={`${all.length} owners · ${unitCount} units under management`}
        right={<Button variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal(true)}>Add owner</Button>} />

      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      <Card>
        <div className="flex gap-[30px] gap-y-3 flex-wrap items-center py-4 px-[22px]">
          <Roll label={`Owner payouts, ${monthText} (estimate)`} value={rmShort(portfolioNet)} strong />
          <Roll label="from managed units" value={rmShort(portfolioManagedNet)} />
          <Roll label="guaranteed rent (GRR units)" value={rmShort(portfolioGuaranteed)} />
          <Roll label={`Booking revenue, managed units`} value={rmShort(portfolioManagedGross)} />
          <div className="ml-auto"><MonthStepper label={monthLabel(month)} onStep={by => url.set({ month: shiftMonth(month, by) === thisMonth ? null : shiftMonth(month, by) })} /></div>
        </div>
        <div className="px-[22px] pb-3 -mt-1 text-meta text-muted-ink text-pretty">
          Managed units: revenue collected on bookings that start in the month, less the fee and owner-charged expenses. Guaranteed-rent units pay the owner their fixed monthly amount whatever the bookings bring in, so it is counted on its own and not as a share of revenue. The owner statement is the figure that is paid.
        </div>
      </Card>

      <div className="flex flex-col gap-2">
        <div className={cx('flex gap-[7px] shrink-0', phone ? 'overflow-x-auto -mx-4 px-4 pb-1' : 'flex-wrap')}>
          <Chip on={!model} onClick={() => url.set({ model: null })} count={counts.all}>All owners</Chip>
          <Chip on={model === 'management'} onClick={() => url.set({ model: 'management' })} count={counts.management}>Management fee</Chip>
          <Chip on={model === 'grr'} onClick={() => url.set({ model: 'grr' })} count={counts.grr}>Guaranteed rent</Chip>
          <Chip on={model === 'none'} onClick={() => url.set({ model: 'none' })} count={counts.none}>No units</Chip>
        </div>
        <div className="flex flex-wrap gap-2">
          <SearchBox className="flex-[2_1_240px]" label="Search owners" placeholder="Search owner, email or unit" value={url.get('q')} onChange={v => url.set({ q: v || null })} />
          {filters && (
            <FilterSelect className="flex-[1_1_180px]" label="Building" all="All buildings" value={building} onChange={v => url.set({ building: v || null })}
              options={filters.buildings.map(b => ({ value: b.id, label: b.name }))} />
          )}
          {phone && (
            <FilterSelect className="flex-[1_1_180px]" label="Sort by" all="Sort: name A-Z" value={sortRaw === 'name' ? '' : sortRaw}
              onChange={v => url.set({ sort: v || null })}
              options={[{ value: '-net', label: 'Sort: net, highest first' }, { value: 'net', label: 'Sort: net, lowest first' }, { value: '-gross', label: 'Sort: gross, highest first' }, { value: '-units', label: 'Sort: most units' }]} />
          )}
        </div>
      </div>

      <ListCard busy={loading && !!data}>
        {loading && !data ? <TableSkeleton rows={8} cols={phone ? 2 : 6} /> : rows.length === 0 ? (
          <div className="py-[44px] px-[22px] text-center flex flex-col items-center gap-2">
            <span className="text-copy font-medium">{all.length === 0 ? 'No owners yet.' : 'No owners match these filters.'}</span>
            {filtered && <button onClick={() => url.set({ q: null, building: null, model: null })} className="font-sans text-copy text-gold-ink bg-transparent border-none cursor-pointer">Clear filters</button>}
          </div>
        ) : phone ? (
          <div>
            {rows.map(o => (
              <button key={o.id} onClick={() => openProfile(o.id)}
                className="w-full text-left flex items-center gap-3 py-[11px] px-4 bg-card border-none [border-bottom:1px_solid_var(--color-line-soft)] cursor-pointer font-sans text-ink">
                <span className="w-[32px] h-[32px] flex-none rounded-full bg-black text-gold grid place-items-center text-caption font-semibold">{initials(o.displayName)}</span>
                <div className="flex flex-col gap-[2px] min-w-0 flex-1">
                  <span className="text-copy font-medium truncate">{titleCase(o.displayName)}</span>
                  <span className="text-meta text-muted-ink truncate">{unitsText(o)} · {ownerTerms(o)}</span>
                </div>
                <div className="flex flex-col items-end gap-[2px] shrink-0">
                  <span className="text-copy font-semibold tabular-nums">{rm(netOf(o), { cents: false })}</span>
                  <span className="text-caption text-muted-ink">net</span>
                </div>
              </button>
            ))}
            <div className="flex items-center justify-between py-3 px-4 bg-page text-copy font-semibold">
              <span>{rows.length} {rows.length === 1 ? 'owner' : 'owners'}</span>
              <span className="tabular-nums">{rm(shownNet, { cents: false })}</span>
            </div>
          </div>
        ) : (
          <div role="table" aria-label="Owners">
            <div role="row" className={cx(COLS, 'grid gap-[14px] py-[9px] px-[22px]', STICKY_HEAD)}>
              <Head k="name" label="Owner" /><Head k="units" label="Units" /><div>Terms</div>
              <Head k="gross" label={`Booking revenue, ${month === thisMonth ? 'month' : monthLabel(month)}`} right />
              <Head k="net" label={`Owner payout, ${month === thisMonth ? 'month' : monthLabel(month)}`} right />
              <div>Portal</div>
            </div>
            {rows.map(o => (
              <div key={o.id} role="row" tabIndex={0} onClick={() => openProfile(o.id)} onKeyDown={e => { if (e.key === 'Enter') openProfile(o.id); }}
                className={cx(COLS, 'grid gap-[14px] items-center min-h-[52px] py-[7px] px-[22px] [border-bottom:1px_solid_var(--color-line-soft)] cursor-pointer hover:bg-page')}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-[30px] h-[30px] flex-none rounded-full bg-black text-gold grid place-items-center text-caption font-semibold">{initials(o.displayName)}</span>
                  <div className="flex flex-col gap-px min-w-0">
                    <span className="text-copy font-medium truncate" title={o.displayName}>{titleCase(o.displayName)}</span>
                    {o.email && <span className="text-meta text-muted-ink truncate" title={o.email}>{o.email}</span>}
                  </div>
                </div>
                <span className="text-copy text-muted-ink truncate" title={o.units.map(u => u.unitLabel).join(', ')}>{unitsText(o)}</span>
                <span className="text-copy text-muted-ink truncate">{ownerTerms(o)}</span>
                <span className="text-copy text-right text-muted-ink tabular-nums whitespace-nowrap">{rm(grossOf(o), { cents: false })}</span>
                <span className={cx('text-copy text-right font-medium tabular-nums whitespace-nowrap', netOf(o) < 0 ? TONE.critical.text : '')}>{rm(netOf(o), { cents: false })}</span>
                <div className="flex items-center justify-between gap-2 min-w-0">
                  {o.portalInvited ? <Badge tone="success" label="Active" /> : <Badge tone="neutral" label="Not invited" />}
                  <Icon name="ChevronRight" size="sm" color="var(--color-muted-ink)" />
                </div>
              </div>
            ))}
            <div className={cx(COLS, 'grid gap-[14px] items-center py-[12px] px-[22px] bg-page text-copy font-semibold')}>
              <span>{filtered ? `${rows.length} of ${all.length} owners` : `${rows.length} owners`}</span><span /><span />
              <span className="text-right tabular-nums whitespace-nowrap">{rm(shownGross, { cents: false })}</span>
              <span className="text-right tabular-nums whitespace-nowrap">{rm(shownNet, { cents: false })}</span>
              <span />
            </div>
          </div>
        )}
      </ListCard>

      {modal && <AddOwnerModal onClose={() => setModal(false)} onSubmit={addOwner} />}
    </>
  );
}
