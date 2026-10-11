import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { useToast } from '../components/Toast';
import { api, errorMessage } from '../lib/api';
import { rmShort, monthLabel, todayMyt, titleCase, plural } from '../lib/format';
import { MoneyText } from '../components/MoneyText';
import { Select } from '../components/Select';
import {
  type Owner, type Payload,
  FALLBACK, netOf, grossOf, guaranteedOf, managedNetOf, managedGrossOf, terms,
  Roll, AddOwnerModal,
} from './owners/shared';
import { FilterBar } from '../components/FilterBar';
import { useUrlState, usePhone, SearchBox, MonthStepper, shiftMonth, useFinanceFilters } from './finance/listKit';
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

  // Name order until someone sorts by a column.
  const rows = useMemo(() => all.filter(o =>
    (!q || o.displayName.toLowerCase().includes(q) || (o.email ?? '').toLowerCase().includes(q) || o.units.some(u => u.unitLabel.toLowerCase().includes(q))) &&
    (!building || o.units.some(u => u.buildingId === building)) &&
    (!model || (model === 'none' ? o.units.length === 0 : o.units.some(u => modelOf(u) === model))))
    .sort((a, b) => a.displayName.localeCompare(b.displayName)), [all, q, building, model]);

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
  const clearFilters = () => url.set({ q: null, building: null, model: null, page: null });
  const monthCol = month === thisMonth ? 'month' : monthLabel(month);

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

  // Column filters are off: the totals under the table add up the owners the page's own search and chips leave.
  const columns = useMemo<Column<Owner>[]>(() => [
    { key: 'owner', label: 'Owner', value: o => o.displayName, hideable: false, width: 220, filter: false,
      render: o => (
        <span className="flex items-center gap-2.5 min-w-0">
          <span className="w-[30px] h-[30px] flex-none rounded-full bg-black text-gold grid place-items-center text-caption font-semibold">{initials(o.displayName)}</span>
          <span className="flex flex-col gap-px min-w-0">
            <span className="text-copy font-medium truncate" title={o.displayName}>{titleCase(o.displayName)}</span>
            {o.email && <span className="text-meta text-muted-ink truncate" title={o.email}>{o.email}</span>}
          </span>
        </span>
      ) },
    { key: 'email', label: 'Email', value: o => o.email || null, hidden: true, filter: false, width: 200 },
    { key: 'phone', label: 'Phone', type: 'phone', value: o => o.phone, hidden: true, filter: false, width: 140 },
    { key: 'units', label: 'Units', type: 'number', align: 'left', value: o => o.units.length, width: 140, filter: false,
      render: o => <span className="text-copy text-muted-ink truncate block" title={o.units.map(u => u.unitLabel).join(', ')}>{unitsText(o)}</span> },
    { key: 'unitList', label: 'Unit list', value: o => o.units.map(u => u.unitLabel).join(', ') || null, hidden: true, filter: false, width: 220 },
    { key: 'terms', label: 'Terms', value: o => ownerTerms(o), width: 220, filter: false,
      text: o => o.units.length > 1 ? o.units.map(u => `${u.unitLabel}: ${terms(u)}`).join('; ') : ownerTerms(o),
      render: o => o.units.length > 1 ? (
        <span className="flex flex-col gap-1 min-w-0 py-0.5">
          <button type="button" aria-expanded={!!open[o.id]} onClick={e => { e.stopPropagation(); toggle(o.id); }} onKeyDown={e => e.stopPropagation()}
            className="flex items-center gap-1.5 min-w-0 p-0 bg-transparent border-none cursor-pointer [font-family:inherit] text-copy text-gold-ink text-left">
            <Icon name={open[o.id] ? 'ChevronDown' : 'ChevronRight'} size="sm" />
            <span className="truncate">{ownerTerms(o)}</span>
          </button>
          {open[o.id] && o.units.map(u => (
            <a key={u.unitId} href={`#/properties/units/${encodeURIComponent(u.unitId)}?tab=contract`} onClick={e => e.stopPropagation()}
              className="flex items-center justify-between gap-2 min-w-0 pl-5 no-underline text-inherit! hover:underline" title={`${u.unitLabel} · ${terms(u)}`}>
              <span className="text-meta text-ink truncate">{titleCase(u.unitLabel)}</span>
              <span className="shrink-0"><ModelChip model={modelOf(u)} label={terms(u)} /></span>
            </a>
          ))}
        </span>
      ) : <span className="text-copy text-muted-ink truncate block" title={ownerTerms(o)}>{ownerTerms(o)}</span> },
    { key: 'gross', label: `Gross Income, ${monthCol}`, type: 'money', value: o => grossOf(o), width: 150, filter: false,
      render: o => <MoneyText sen={grossOf(o)} mode="exact" tone="muted" className="text-copy" /> },
    { key: 'net', label: `Owner payout, ${monthCol}`, type: 'money', value: o => netOf(o), width: 150, filter: false,
      render: o => <MoneyText sen={netOf(o)} mode="exact" tone="auto" className="text-copy font-medium" /> },
    { key: 'guaranteed', label: `Guaranteed rent, ${monthCol}`, type: 'money', value: o => guaranteedOf(o), hidden: true, filter: false, width: 150 },
    { key: 'defaultFee', label: 'Default fee %', type: 'number', value: o => o.defaultManagementFeePct, hidden: true, filter: false, width: 110 },
    { key: 'portal', label: 'Portal', type: 'status', width: 120, filter: false,
      status: o => (o.portalInvited ? { label: 'Active', tone: 'success' } : { label: 'Not invited', tone: 'neutral' }) },
  ], [open, monthCol]);

  return (
    <>
      <PageHeader title="Owners" sub={data ? `${plural(all.length, 'owner')} · ${plural(unitCount, 'unit')} under management` : 'Loading owners…'}
        primary={<Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal(true)}>Add owner</Button>} />

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5 pt-5 pb-4 px-5 sm:px-[22px]">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-5 flex-1 min-w-[min(100%,560px)] items-end">
            <Roll label={`Owner payouts, ${monthText} (estimate)`} value={data ? rmShort(portfolioNet) : undefined} strong />
            <Roll label="from managed units" value={data ? rmShort(portfolioManagedNet) : undefined} />
            <Roll label="guaranteed rent (GRR units)" value={data ? rmShort(portfolioGuaranteed) : undefined} />
            <Roll label={`Gross Income, managed units`} value={data ? rmShort(portfolioManagedGross) : undefined} />
          </div>
          <MonthStepper label={monthLabel(month)} onStep={by => url.set({ month: shiftMonth(month, by) === thisMonth ? null : shiftMonth(month, by) })} />
        </div>
        <div className="px-5 sm:px-[22px] pt-4 pb-4 [border-top:1px_solid_var(--color-line-soft)] text-meta text-muted-ink text-pretty">
          Each unit is worked out the way its owner statement is, by its payout model: income split by night into the month, less the costs the owner pays, then the share, minimum or fixed rent, and Owner Adjustments. Guaranteed rent is counted on its own, not as a share of earnings. Until the month's statement is final, these are estimates.
        </div>
      </Card>

      <DataTable<Owner>
        id="owners" phoneSort={false} columns={columns} rows={data ? rows : null} rowKey={o => o.id}
        loading={loading} error={error} onRetry={reload} onRowClick={o => openProfile(o.id)}
        pageSize={0} viewParams={['q', 'building', 'model', 'month']} filtered={filtered} onClearFilters={clearFilters}
        noun={['owner', 'owners']} exportName="owners"
        empty={{ title: 'No owners yet.', body: 'Add an owner, then link their units and set the fee or guaranteed rent.', action: { label: 'Add owner', onClick: () => setModal(true) } }}
        header={
          <div className="py-3 px-[22px] max-md:px-4 [border-bottom:1px_solid_var(--color-line)]">
            <FilterBar<ModelFilter> label="Owners by fee model" value={model} onChange={k => url.set({ model: k || null, page: null })}
              views={[
                { key: '', label: 'All owners', count: data ? counts.all : undefined },
                ...MODELS.filter(m => counts[m.key] > 0 || model === m.key).map(m => ({ key: m.key as ModelFilter, label: m.label, count: counts[m.key] })),
                { key: 'none', label: 'No units', count: data ? counts.none : undefined },
              ]} />
          </div>
        }
        toolbar={<>
          <SearchBox className="flex-1 min-w-[200px]" label="Search owners" placeholder="Search owner, email or unit" value={url.get('q')} onChange={v => url.set({ q: v || null, page: null })} />
          {filters && (
            <Select className="flex-[0_1_200px] max-md:flex-[1_1_160px]" label="Building" value={building} onChange={v => url.set({ building: v || null, page: null })}
              options={[{ value: '', label: 'All buildings' }, ...[...filters.buildings].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })).map(b => ({ value: b.id, label: b.name }))]} />
          )}
          {phone && (
            <Select className="flex-[1_1_180px]" label="Sort by" value={url.get('sort')}
              onChange={v => url.set({ sort: v || null })}
              options={[{ value: '', label: 'Sort: name A-Z' }, { value: 'net:desc', label: 'Sort: net, highest first' }, { value: 'net:asc', label: 'Sort: net, lowest first' }, { value: 'gross:desc', label: 'Sort: gross, highest first' }, { value: 'units:desc', label: 'Sort: most units' }]} />
          )}
          {filtered && <Button size="sm" variant="tertiary" onClick={clearFilters}>Clear filters</Button>}
        </>}
        footer={rows.length > 0 && (
          <div className="flex items-center gap-x-5 gap-y-1 flex-wrap py-3 px-[22px] max-md:px-4 bg-page [border-top:1px_solid_var(--color-line)] text-copy font-semibold">
            <span>{filtered ? `${rows.length} of ${plural(all.length, 'owner')}` : plural(rows.length, 'owner')}</span>
            <span className="ml-auto max-md:ml-0 inline-flex items-baseline gap-1.5"><span className="text-meta text-muted-ink font-normal">Gross Income</span><MoneyText sen={shownGross} mode="exact" /></span>
            <span className="inline-flex items-baseline gap-1.5"><span className="text-meta text-muted-ink font-normal">Owner payout</span><MoneyText sen={shownNet} mode="exact" /></span>
          </div>
        )}
        renderCard={o => (
          <span className="flex items-center gap-3 min-w-0">
            <span className="w-[32px] h-[32px] flex-none rounded-full bg-black text-gold grid place-items-center text-caption font-semibold">{initials(o.displayName)}</span>
            <span className="flex flex-col gap-[2px] min-w-0 flex-1">
              <span className="text-copy font-medium truncate" title={o.displayName}>{titleCase(o.displayName)}</span>
              {o.units.length <= 1
                ? <span className="text-meta text-muted-ink truncate" title={`${o.units.map(u => u.unitLabel).join(', ') || unitsText(o)} · ${ownerTerms(o)}`}>{unitsText(o)} · {ownerTerms(o)}</span>
                : o.units.map(u => <span key={u.unitId} className="text-meta text-muted-ink truncate" title={`${u.unitLabel} · ${terms(u)}`}>{u.unitLabel.split(' ').pop()} · {terms(u)}</span>)}
            </span>
            <span className="flex flex-col items-end gap-[2px] shrink-0">
              <MoneyText sen={netOf(o)} mode="exact" tone="auto" strong className="text-copy" />
              <span className="text-caption text-muted-ink">net</span>
            </span>
          </span>
        )}
      />

      {modal && <AddOwnerModal onClose={() => setModal(false)} onSubmit={addOwner} />}
    </>
  );
}
