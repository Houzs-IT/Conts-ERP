import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { useToast } from '../components/Toast';
import { api, errorMessage } from '../lib/api';
import { rmShort, monthLabel, todayMyt, titleCase, plural } from '../lib/format';
import { MoneyText } from '../components/MoneyText';
import { Select } from '../components/Select';
import { EmptyState } from '../components/States';
import { cx } from '../lib/design-tokens';
import {
  type Owner, type Payload,
  FALLBACK, netOf, grossOf, guaranteedOf, managedNetOf, managedGrossOf, terms,
  Roll, AddOwnerModal,
} from './owners/shared';
import { useUrlState, usePhone, ListCard, SearchBox, Chip, MonthStepper, STICKY_HEAD, shiftMonth, useFinanceFilters } from './finance/listKit';
import { MODELS, type RevenueModel } from '../lib/revenueModel';
import { ModelChip } from './units/ContractTab';

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

const COLS = 'grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,1.6fr)_minmax(96px,0.85fr)_minmax(104px,0.9fr)_minmax(96px,0.75fr)]';

type SortKey = 'name' | 'units' | 'gross' | 'net';
const SORT_KEYS: SortKey[] = ['name', 'units', 'gross', 'net'];
type ModelFilter = '' | RevenueModel | 'none';
const modelOf = (u: Owner['units'][number]): RevenueModel => u.revenueModel ?? (u.model === 'grr' ? 'grr' : 'management');

/** Terms shown for an owner in the list. A single-unit owner reads exactly as that unit's terms; an owner with
 *  several units shows them all when they match, else how many differ, and the row opens to one line per unit
 *  (never only the first unit's terms). No units: em dash. */
function ownerTerms(o: Owner): string {
  if (o.units.length === 0) return '—';
  const all = o.units.map(terms);
  if (all.length === 1) return all[0];
  return all.every(t => t === all[0]) ? `All ${all.length}: ${all[0]}` : `${new Set(all).size} different terms`;
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
  const model = ([...MODELS.map(m => m.key as string), 'none'].includes(url.get('model')) ? url.get('model') : '') as ModelFilter;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setOpen(m => ({ ...m, [id]: !m[id] }));
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
    ...Object.fromEntries(MODELS.map(m => [m.key, all.filter(o => o.units.some(u => modelOf(u) === m.key)).length])) as Record<RevenueModel, number>,
    none: all.filter(o => o.units.length === 0).length,
  }), [all]);

  const rows = useMemo(() => {
    const list = all.filter(o =>
      (!q || o.displayName.toLowerCase().includes(q) || (o.email ?? '').toLowerCase().includes(q) || o.units.some(u => u.unitLabel.toLowerCase().includes(q))) &&
      (!building || o.units.some(u => u.buildingId === building)) &&
      (!model || (model === 'none' ? o.units.length === 0 : o.units.some(u => modelOf(u) === model))));
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
      toast({ tone: 'success', title: 'Owner added.', body: `${titleCase(o.displayName)}: link a unit next.` });
      setModal(false);
      navigate(`/owners/${encodeURIComponent(made.id)}`);
    } catch (e) {
      toast({ tone: 'critical', title: 'Owner was not added.', body: errorMessage(e, 'Try again in a moment.') });
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
      <PageHeader title="Owners" sub={`${plural(all.length, 'owner')} · ${plural(unitCount, 'unit')} under management`}
        primary={<Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal(true)}>Add owner</Button>} />

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
          Each unit is worked out the way its owner statement is, by its revenue model: income split by night into the month, less the costs the owner pays, then the share, minimum or fixed rent, and owner credits and charges. Guaranteed rent is counted on its own, not as a share of revenue. Until the month's statement is final, these are estimates.
        </div>
      </Card>

      <div className="flex items-center gap-2 flex-wrap">
        <SearchBox className="flex-1 min-w-[200px]" label="Search owners" placeholder="Search owner, email or unit" value={url.get('q')} onChange={v => url.set({ q: v || null })} />
        {filters && (
          <Select className="flex-[0_1_200px]" label="Building" value={building} onChange={v => url.set({ building: v || null })}
            options={[{ value: '', label: 'All buildings' }, ...[...filters.buildings].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })).map(b => ({ value: b.id, label: b.name }))]} />
        )}
        {phone && (
          <Select className="flex-[1_1_180px]" label="Sort by" value={sortRaw === 'name' ? '' : sortRaw}
            onChange={v => url.set({ sort: v || null })}
            options={[{ value: '', label: 'Sort: name A-Z' }, { value: '-net', label: 'Sort: net, highest first' }, { value: 'net', label: 'Sort: net, lowest first' }, { value: '-gross', label: 'Sort: gross, highest first' }, { value: '-units', label: 'Sort: most units' }]} />
        )}
        <div className={cx('flex gap-2', phone ? 'w-full overflow-x-auto pb-1' : 'flex-wrap')}>
          <Chip on={!model} onClick={() => url.set({ model: null })} count={counts.all}>All owners</Chip>
          {MODELS.filter(m => counts[m.key] > 0 || model === m.key).map(m => (
            <Chip key={m.key} on={model === m.key} onClick={() => url.set({ model: m.key })} count={counts[m.key]}>{m.label}</Chip>
          ))}
          <Chip on={model === 'none'} onClick={() => url.set({ model: 'none' })} count={counts.none}>No units</Chip>
        </div>
        {filtered && <Button size="sm" variant="tertiary" onClick={() => url.set({ q: null, building: null, model: null })}>Clear filters</Button>}
      </div>

      <ListCard busy={loading && !!data}>
        {loading && !data ? <TableSkeleton rows={8} cols={phone ? 2 : 6} /> : rows.length === 0 ? (
          all.length === 0
            ? <EmptyState bare title="No owners yet." body="Add an owner, then link their units and set the fee or guaranteed rent." />
            : <EmptyState bare kind="filtered" title="No owners match these filters." action={{ label: 'Clear filters', onClick: () => url.set({ q: null, building: null, model: null }) }} />
        ) : phone ? (
          <div>
            {rows.map(o => (
              <button key={o.id} onClick={() => openProfile(o.id)}
                className="w-full text-left flex items-center gap-3 py-[11px] px-4 bg-card border-none [border-bottom:1px_solid_var(--color-line-soft)] cursor-pointer font-sans text-ink">
                <span className="w-[32px] h-[32px] flex-none rounded-full bg-black text-gold grid place-items-center text-caption font-semibold">{initials(o.displayName)}</span>
                <div className="flex flex-col gap-[2px] min-w-0 flex-1">
                  <span className="text-copy font-medium truncate" title={o.displayName}>{titleCase(o.displayName)}</span>
                  {o.units.length <= 1
                    ? <span className="text-meta text-muted-ink truncate" title={`${o.units.map(u => u.unitLabel).join(', ') || unitsText(o)} · ${ownerTerms(o)}`}>{unitsText(o)} · {ownerTerms(o)}</span>
                    : o.units.map(u => <span key={u.unitId} className="text-meta text-muted-ink truncate" title={`${u.unitLabel} · ${terms(u)}`}>{u.unitLabel.split(' ').pop()} · {terms(u)}</span>)}
                </div>
                <div className="flex flex-col items-end gap-[2px] shrink-0">
                  <MoneyText sen={netOf(o)} mode="exact" tone="auto" strong className="text-copy" />
                  <span className="text-caption text-muted-ink">net</span>
                </div>
              </button>
            ))}
            <div className="flex items-center justify-between py-3 px-4 bg-page text-copy font-semibold">
              <span>{plural(rows.length, 'owner')}</span>
              <MoneyText sen={shownNet} mode="exact" />
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
              <Fragment key={o.id}>
              <div role="row" tabIndex={0} onClick={() => openProfile(o.id)} onKeyDown={e => { if (e.key === 'Enter') openProfile(o.id); }}
                className={cx(COLS, 'grid gap-[14px] items-center min-h-[52px] py-[7px] px-[22px] [border-bottom:1px_solid_var(--color-line-soft)] cursor-pointer hover:bg-page')}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-[30px] h-[30px] flex-none rounded-full bg-black text-gold grid place-items-center text-caption font-semibold">{initials(o.displayName)}</span>
                  <div className="flex flex-col gap-px min-w-0">
                    <span className="text-copy font-medium truncate" title={o.displayName}>{titleCase(o.displayName)}</span>
                    {o.email && <span className="text-meta text-muted-ink truncate" title={o.email}>{o.email}</span>}
                  </div>
                </div>
                <span className="text-copy text-muted-ink truncate" title={o.units.map(u => u.unitLabel).join(', ')}>{unitsText(o)}</span>
                {o.units.length > 1 ? (
                  <button type="button" aria-expanded={!!open[o.id]} onClick={e => { e.stopPropagation(); toggle(o.id); }} onKeyDown={e => e.stopPropagation()}
                    className="flex items-center gap-1.5 min-w-0 p-0 bg-transparent border-none cursor-pointer [font:inherit] text-copy! text-gold-ink text-left">
                    <Icon name={open[o.id] ? 'ChevronDown' : 'ChevronRight'} size="sm" />
                    <span className="truncate">{ownerTerms(o)}</span>
                  </button>
                ) : (
                  <span className="text-copy text-muted-ink truncate" title={ownerTerms(o)}>{ownerTerms(o)}</span>
                )}
                <MoneyText sen={grossOf(o)} mode="exact" tone="muted" className="text-copy text-right" />
                <MoneyText sen={netOf(o)} mode="exact" tone="auto" className="text-copy text-right font-medium" />
                <div className="flex items-center justify-between gap-2 min-w-0">
                  {o.portalInvited ? <StatusBadge tone="success" label="Active" /> : <StatusBadge tone="neutral" label="Not invited" />}
                  <Icon name="ChevronRight" size="sm" color="var(--color-muted-ink)" />
                </div>
              </div>
              {open[o.id] && o.units.map(u => (
                <a key={u.unitId} role="row" href={`#/properties/units/${encodeURIComponent(u.unitId)}?tab=contract`}
                  className={cx(COLS, 'grid gap-[14px] items-center min-h-[40px] py-[5px] px-[22px] bg-page [border-bottom:1px_solid_var(--color-line-soft)] no-underline text-inherit! hover:bg-muted')}>
                  <span />
                  <span className="text-meta text-ink truncate pl-2" title={u.unitLabel}>{titleCase(u.unitLabel)}</span>
                  <span className="min-w-0 truncate"><ModelChip model={modelOf(u)} label={terms(u)} /></span>
                  <MoneyText sen={u.gross} mode="exact" tone="muted" className="text-meta text-right" />
                  <MoneyText sen={u.net} mode="exact" tone="auto" className="text-meta text-right" />
                  <span />
                </a>
              ))}
              </Fragment>
            ))}
            <div className={cx(COLS, 'grid gap-[14px] items-center py-[12px] px-[22px] bg-page text-copy font-semibold')}>
              <span>{filtered ? `${rows.length} of ${plural(all.length, 'owner')}` : plural(rows.length, 'owner')}</span><span /><span />
              <MoneyText sen={shownGross} mode="exact" className="text-right" />
              <MoneyText sen={shownNet} mode="exact" className="text-right" />
              <span />
            </div>
          </div>
        )}
      </ListCard>

      {modal && <AddOwnerModal onClose={() => setModal(false)} onSubmit={addOwner} />}
    </>
  );
}
