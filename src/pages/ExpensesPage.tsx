import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import Icon from '../components/Icon';
import PageHeader from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, notifyFailure, ApiFailure, errorMessage } from '../lib/api';
import { isStaged, stagedToast } from '../lib/approvals';
import { refreshNavCounts } from '../lib/navBadges';
import { monthLabel, dateShort, todayMyt, plural, count as fmtCount, titleCase } from '../lib/format';
import { DataTable, type Column } from '../components/DataTable';
import { fetchAllPages } from '../lib/export';
import { MoneyText, moneyString } from '../components/MoneyText';
import { Select, SearchSelect, type SelectOption } from '../components/Select';
import { EmptyState } from '../components/States';
import { MoneyInput, DateField } from '../components/inputs';
import { TONE, cx } from '../lib/design-tokens';
import type { Tone } from '../lib/types';
import { HistoryDisclosure } from '../components/RecordHistory';
import { Eyebrow, Figure, Segmented } from '../components/Metric';
import { FilterBar } from '../components/FilterBar';
import {
  useUrlState, ListCard, SearchBox, shiftMonth,
  useFinanceFilters, type FinanceFilters,
} from './finance/listKit';

// Category is a closed list. The monthly-expense dialog only offers the recurring
// operating categories (internet / electricity / water / cleaning / maintenance /
// other, per BUTTONS.md §10); the richer set below also covers expenses that flow
// in from maintenance completion and channel settlement, so their rows still label.
type Category =
  | 'internet' | 'electricity' | 'water' | 'cleaning'
  | 'housekeeping' | 'maintenance' | 'utilities' | 'consumables'
  | 'furniture' | 'management_fee' | 'channel_fee' | 'other';

const CAT_LABEL: Record<Category, string> = {
  internet: 'Internet', electricity: 'Electricity', water: 'Water', cleaning: 'Cleaning',
  housekeeping: 'Cleaning', maintenance: 'Maintenance', utilities: 'Utilities',
  consumables: 'Consumables', furniture: 'Furniture', management_fee: 'Operator share',
  channel_fee: 'Service fee', other: 'Other',
};
const CAT_TONE: Record<Category, Tone> = {
  internet: 'info', electricity: 'warning', water: 'info', cleaning: 'info',
  housekeeping: 'info', maintenance: 'warning', utilities: 'neutral',
  consumables: 'neutral', furniture: 'info', management_fee: 'neutral',
  channel_fee: 'neutral', other: 'neutral',
};
const catLabel = (c: string) => CAT_LABEL[c as Category] ?? c.replace(/_/g, ' ').replace(/^./, x => x.toUpperCase());
const catTone = (c: string): Tone => CAT_TONE[c as Category] ?? 'neutral';

// The dialog's category set — the monthly deductions an operator adds by hand.
const ADD_CATEGORIES: Category[] = ['internet', 'electricity', 'water', 'cleaning', 'maintenance', 'other'];

type ChargeTo = 'owner' | 'guest_deposit' | 'the_conts' | 'warranty';
const CHARGE_LABEL: Record<string, string> = {
  owner: 'Owner', guest_deposit: 'Guest deposit', the_conts: 'The Conts', warranty: 'Warranty',
};

interface Expense {
  id: string; unitNumber: string; propertyName: string; category: Category;
  description: string; amount: number; incurredOn: string; reference: string | null; chargeTo: ChargeTo;
  unitId?: string; locked?: boolean;
  // When set, this row is a line item under another expense (its parent). The
  // grouped view nests it under that rollup; the parent then carries no amount of
  // its own — its children hold the money. See api.md.
  parentExpenseId?: string | null;
  /** Grouped view only: line items under a rollup header. */
  childCount?: number; children?: Expense[];
}
interface Payload {
  data: Expense[]; generatedAt: string; sentPeriods?: string[];
  filtersApplied: { month: string };
  page: number; pageSize: number; total: number; totalAmount: number; pageTotal: number;
  byCategory: { category: string; count: number; amount: number }[];
  months: { month: string; count: number; amount: number }[];
}

const PAGE_SIZE = 50;
const SIZES = [25, 50, 100, 200];
const SORTS = ['date', 'date_asc', 'amount', 'amount_asc', 'unit', 'unit_desc'] as const;
type Sort = typeof SORTS[number];
/** The table writes `sort=<column>:asc|desc`; the endpoint reads its own names. Old links carry those names directly. */
const SORT_PARAM: Record<string, Sort> = {
  'date:desc': 'date', 'date:asc': 'date_asc', 'amount:desc': 'amount', 'amount:asc': 'amount_asc', 'unit:asc': 'unit', 'unit:desc': 'unit_desc',
};

const thisMonth = () => todayMyt().slice(0, 7);

// Text inputs match the Select controls beside them (13px copy). Preflight is off in
// this project, so borders carry border-solid.
const fieldMono = 'block w-full box-border h-10 px-3 py-0 border border-solid border-line rounded-control outline-none bg-card text-ink font-mono text-copy font-normal';
const labelClass = 'text-meta font-medium text-muted-ink';

/** The query string for one request: the page's filters plus the per-request extras. */
function qs(base: Record<string, string>, extra: Record<string, string | number>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...extra })) if (v !== '' && v !== undefined) p.set(k, String(v));
  return p.toString();
}

export default function ExpensesPage() {
  const toast = useToast();
  const url = useUrlState();
  const filters = useFinanceFilters();

  // Everything that changes what is listed lives in the URL, so a refresh, a
  // shared link or the back button lands on the same view.
  const month = url.get('month');                 // '' = the latest month with expenses (server picks)
  const cat = url.get('category');
  const building = url.get('building');
  const unit = url.get('unit');
  const owner = url.get('owner');
  const q = url.get('q');
  const view: 'grouped' | 'list' = url.get('view') === 'list' ? 'list' : 'grouped';
  const rawSort = url.get('sort');
  const sort: Sort = SORT_PARAM[rawSort] ?? ((SORTS as readonly string[]).includes(rawSort) ? rawSort as Sort : 'date');
  const page = Math.max(1, Number(url.get('page')) || 1);
  const size = SIZES.includes(Number(url.get('size'))) ? Number(url.get('size')) : PAGE_SIZE;

  const base = { month, category: cat, building, unit, owner, q };
  // The grouped view's first paint only needs the totals; each category loads its rows when opened.
  const path = view === 'list'
    ? `/finance/expenses?${qs(base, { view: 'list', sort, page, pageSize: size })}`
    : `/finance/expenses?${qs(base, { pageSize: 0 })}`;
  const { data, loading, error, reload } = useApi<Payload>(path);
  const [edits, setEdits] = useState<Record<string, Partial<Expense>>>({});
  const [nonce, setNonce] = useState(0);
  const refresh = () => { reload(); setNonce(n => n + 1); };

  const shownMonth = month || data?.filtersApplied.month || thisMonth();
  const monthAll = shownMonth === 'all';
  const sentPeriods = useMemo(() => new Set(data?.sentPeriods ?? []), [data]);
  const total = data?.total ?? 0, totalAmount = data?.totalAmount ?? 0;
  const filtered = !!(cat || building || unit || owner || q);
  const clearFilters = () => url.set({ category: null, building: null, unit: null, owner: null, q: null, page: null });
  const setFilter = (patch: Record<string, string | null>) => url.set({ ...patch, page: null });

  const unitOptions = useMemo<SelectOption[]>(() => (filters?.units ?? [])
    .filter(u => (!building || u.buildingId === building) && (!owner || u.ownerId === owner))
    .map(u => ({ value: u.id, label: u.unitNumber, group: filters?.buildings.find(b => b.id === u.buildingId)?.name ?? '' })), [filters, building, owner]);
  const ownerOptions = useMemo<SelectOption[]>(() => (filters?.owners ?? []).map(o => ({ value: o.id, label: titleCase(o.name) })), [filters]);
  const buildingOptions = useMemo<SelectOption[]>(() => [
    { value: '', label: 'All buildings' },
    ...[...(filters?.buildings ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })).map(b => ({ value: b.id, label: b.name })),
  ], [filters]);

  const monthOptions = useMemo(() => {
    const list = (data?.months ?? []).map(m => m.month);
    if (!monthAll && !list.includes(shownMonth)) list.push(shownMonth);
    return list.sort().reverse();
  }, [data, shownMonth, monthAll]);
  const stepMonth = (by: number) => setFilter({ month: shiftMonth(monthAll ? thisMonth() : shownMonth, by) });

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [reporting, setReporting] = useState(false);
  const [formFields, setFormFields] = useState<Record<string, string>>({});

  async function createExpense(input: { unitId: string; category: Category; amount: number; incurredOn: string; reference: string; description: string }) {
    try {
      setFormFields({});
      const res = await api.post<unknown>('/expenses', input);
      setCreating(false);
      // Above the approval threshold it waits for a second person and is not on the list yet.
      if (isStaged(res)) { toast(stagedToast(res)); void refreshNavCounts(); return; }
      toast({ tone: 'success', title: 'Expense added.', body: `${catLabel(input.category)} · ${moneyString(input.amount, 'exact')} on ${dateShort(input.incurredOn)}.` });
      refresh();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setFormFields(e.fields);
      toast({ tone: 'critical', title: 'Expense was not added.', body: errorMessage(e, 'Try again in a moment.') });
    }
  }

  async function saveEdit(id: string, delta: Partial<Expense>) {
    try {
      setFormFields({});
      const res = await api.patch<unknown>(`/expenses/${id}`, delta);
      if (isStaged(res)) { setEditing(null); toast(stagedToast(res)); void refreshNavCounts(); return; }
      setEdits(e => ({ ...e, [id]: { ...e[id], ...delta } }));
      setEditing(null);
      toast({ tone: 'success', title: 'Expense updated.', body: 'The change lands on this period’s statement.' });
      refresh();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setFormFields(e.fields);
      const locked = e instanceof ApiFailure && e.status === 409;
      toast({ tone: locked ? 'warning' : 'critical', title: locked ? 'That period is locked.' : 'Expense was not updated.', body: errorMessage(e, 'Try again in a moment.') });
    }
  }

  async function downloadReport(scope: { month: string; unit: string }) {
    const query = qs({ ...base, month: scope.month, unit: scope.unit }, {});
    try {
      const res = await fetch(`/api/expenses/report?${query}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('The report could not be generated. Try again in a moment.');
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href; a.download = `expenses-${scope.month || 'all'}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 0);
      setReporting(false);
      toast({ tone: 'success', title: 'Report downloaded.', body: 'The CSV header prints the filters applied and when it was generated.' });
    } catch (e) { notifyFailure(e); }
  }

  /** Every expense under the current filters and sort, for the table's Export. */
  async function fetchAll(onProgress: (got: number, of: number) => void) {
    const scope = { ...base, month: month || data?.filtersApplied.month || '' };
    const r = await fetchAllPages<Expense>(async (pg, sz) => {
      const p = await api.get<Payload>(`/finance/expenses?${qs(scope, { view: 'list', sort, page: pg, pageSize: sz, export: 1 })}`);
      return { rows: p.data.map(withEdits), total: p.total };
    }, { onProgress });
    return r.rows;
  }

  const columns = useMemo<Column<Expense>[]>(() => [
    { key: 'description', label: 'Description', value: r => r.description || catLabel(r.category), hideable: false, width: 230, filter: false,
      sub: r => (r.chargeTo !== 'owner' ? `Charged to ${CHARGE_LABEL[r.chargeTo] ?? r.chargeTo}` : null) },
    { key: 'unit', label: 'Unit', value: r => r.unitNumber, text: r => `${r.unitNumber} ${r.propertyName}`, exportValue: r => r.unitNumber,
      sortKey: 'unit', width: 140, filter: false, sub: r => r.propertyName },
    { key: 'building', label: 'Building', value: r => r.propertyName, hidden: true, filter: false, width: 150 },
    { key: 'category', label: 'Category', type: 'status', value: r => r.category, width: 130,
      status: r => ({ label: catLabel(r.category), tone: catTone(r.category) }),
      filter: { kind: 'select', param: 'category', multi: false, options: (Object.keys(CAT_LABEL) as Category[]).map(c => ({ value: c, label: CAT_LABEL[c] })) } },
    { key: 'date', label: 'Date', type: 'date', value: r => r.incurredOn, sortKey: 'date', width: 120, filter: false,
      sub: r => (r.locked ? 'Statement final' : null) },
    { key: 'reference', label: 'Reference', type: 'ref', value: r => r.reference, width: 130, filter: false },
    { key: 'chargeTo', label: 'Charged to', value: r => CHARGE_LABEL[r.chargeTo] ?? r.chargeTo, hidden: true, filter: false, width: 130 },
    { key: 'amount', label: 'Amount', type: 'money', value: r => r.amount, sortKey: 'amount', width: 120, filter: false,
      render: r => <MoneyText sen={r.amount} mode="exact" className="font-medium" /> },
    { key: 'edit', label: '', width: 84, align: 'right', noExport: true, sortable: false, filter: false, hideable: false,
      render: r => (
        <Button size="sm" variant="secondary" onClick={e => { e.stopPropagation(); setEditing(r); }}
          title={r.locked ? `The ${monthLabel(r.incurredOn.slice(0, 7))} statement is final, so this expense is locked.` : 'Edit this expense'}
          style={r.locked ? { color: 'var(--color-text-muted)' } : undefined}>
          {r.locked ? 'Locked' : 'Edit'}
        </Button>
      ) },
  ], []);

  const withEdits = (e: Expense): Expense => ({ ...e, ...edits[e.id] });
  const rows = (data?.data ?? []).map(withEdits);
  const firstLoad = loading && !data;
  const cats = data?.byCategory ?? [];
  const catCount = cats.reduce((n, c) => n + c.count, 0);
  // Pills read A to Z with Other last, so a category is always in the same place.
  const catPills = [...cats].sort((a, b) =>
    Number(a.category === 'other') - Number(b.category === 'other') || catLabel(a.category).localeCompare(catLabel(b.category)));

  const subParts = [monthAll ? 'All months' : monthLabel(shownMonth), plural(total, 'entry', 'entries'), moneyString(totalAmount, 'exact')];

  return (
    <>
      <PageHeader
        title="Expenses"
        sub={data ? subParts.join(' · ') : 'Loading…'}
        actions={<Button size="sm" variant="secondary" onClick={() => setReporting(true)}>Generate report</Button>}
        primary={<Button size="sm" variant="primary" onClick={() => setCreating(true)}>Add expense</Button>}
      />

      {error && view === 'grouped' && <StaleBanner message={`Showing the last figures we have. ${error}`} onRetry={refresh} />}

      {/* Category chips carry counts for the month and the other filters, so a click never lands on nothing. */}
      <FilterBar label="Expense category" className="shrink-0" value={cat}
        onChange={k => setFilter({ category: k && k !== cat ? k : null })}
        views={[
          { key: '', label: 'All categories', count: data ? catCount : undefined },
          ...catPills.map(c => ({ key: c.category as string, label: catLabel(c.category), count: c.count })),
          ...(cat && !cats.some(c => c.category === cat) ? [{ key: cat as string, label: catLabel(cat), count: 0 }] : []),
        ]} />

      <div className="flex flex-wrap gap-2 items-center shrink-0">
        <SearchBox className="flex-[2_1_220px]" label="Search expenses" placeholder="Search expenses" value={q} onChange={v => setFilter({ q: v || null })} />
        <Select className="flex-[1_1_140px]" label="Building" value={building} onChange={v => setFilter({ building: v || null, unit: null })} options={buildingOptions} />
        <SearchSelect className="flex-[1_1_160px]" label="Unit" allLabel="All units" placeholder="Search units" value={unit} onChange={v => setFilter({ unit: v || null })} options={unitOptions} />
        <SearchSelect className="flex-[1_1_160px]" label="Owner" allLabel="All owners" placeholder="Search owners" value={owner} onChange={v => setFilter({ owner: v || null, unit: null })} options={ownerOptions} />

        {/* View toggle — grouped drill-down (default) or the flat list. */}
        <Segmented<'grouped' | 'list'> label="Expenses view" value={view} onChange={v => setFilter({ view: v === 'grouped' ? null : v })}
          options={[{ key: 'grouped', label: 'Grouped' }, { key: 'list', label: 'List' }]} />

        {/* Month — stepper plus a menu of the months that have expenses. */}
        <div className="flex flex-[1_0_150px] sm:flex-none sm:w-[168px] items-center h-9 rounded-control border border-solid border-line bg-card min-w-0">
          <button aria-label="Previous month" onClick={() => stepMonth(-1)} className="h-full w-8 shrink-0 grid place-items-center cursor-pointer bg-transparent border-none text-muted-ink hover:text-ink"><Icon name="ChevronLeft" size="sm" /></button>
          <label className="relative flex-1 min-w-0 h-full">
            <span className="absolute w-px h-px overflow-hidden [clip:rect(0_0_0_0)]">Month</span>
            <select value={monthAll ? 'all' : shownMonth} onChange={e => setFilter({ month: e.target.value })}
              className="w-full h-full appearance-none bg-transparent border-none outline-none text-center font-sans text-copy font-medium text-ink cursor-pointer tabular-nums px-1 [text-align-last:center]">
              {monthOptions.map(m => <option key={m} value={m}>{monthLabel(m)}{sentPeriods.has(m) ? ' · sent' : ''}</option>)}
              <option value="all">All months</option>
            </select>
          </label>
          <button aria-label="Next month" onClick={() => stepMonth(1)} className="h-full w-8 shrink-0 grid place-items-center cursor-pointer bg-transparent border-none text-muted-ink hover:text-ink"><Icon name="ChevronRight" size="sm" /></button>
        </div>
      </div>

      {view === 'list' ? (
        <DataTable<Expense>
          id="expenses" columns={columns} rows={data && data.pageSize > 0 ? rows : null} rowKey={r => r.id}
          loading={loading} error={error} onRetry={refresh} onRowClick={r => setEditing(r)}
          server={{ total, page: data?.page ?? page, pageSize: data?.pageSize || size, sizes: SIZES, defaultPageSize: PAGE_SIZE, fetchAll }}
          viewParams={['month', 'category', 'building', 'unit', 'owner', 'q']} filtered={filtered} onClearFilters={clearFilters}
          noun={['expense', 'expenses']} exportName="expenses"
          empty={{ title: monthAll ? 'No expenses yet.' : `No expenses in ${monthLabel(shownMonth)}.`, body: 'Add one, or step to another month.' }}
          selectable
          renderCard={r => <ExpenseCard e={r} />}
          footer={data && total > 0 ? <>
            <TotalBar count={total} amount={totalAmount} />
            {total > (data.pageSize || size) && <div className="px-[22px] pb-3 text-meta text-muted-ink max-md:px-4">Totals cover everything the filters match, not just this page.</div>}
          </> : null}
        />
      ) : (
        <ListCard busy={loading && !!data}>
          {firstLoad ? (
            <div className="p-2"><TableSkeleton rows={8} cols={3} /></div>
          ) : total === 0 ? (
            filtered
              ? <EmptyState bare kind="filtered" title="No expenses match these filters." action={{ label: 'Clear filters', onClick: clearFilters }} />
              : <EmptyState bare title={monthAll ? 'No expenses yet.' : `No expenses in ${monthLabel(shownMonth)}.`} body="Add one, or step to another month." />
          ) : (
            <GroupedTree
              key={`${path}#${nonce}`}
              title="Total deductions" period={monthAll ? 'All months' : monthLabel(shownMonth)}
              total={totalAmount} count={total}
              cats={cat ? cats.filter(c => c.category === cat) : cats}
              base={base} sort={sort} withEdits={withEdits} onEdit={setEditing}
              openInList={c => url.set({ view: 'list', category: c, page: null })}
            />
          )}
        </ListCard>
      )}

      {creating && <ExpenseModal mode="create" fieldErrors={formFields} filters={filters} defaultBuilding={building} defaultUnit={unit} onClose={() => { setCreating(false); setFormFields({}); }} onSubmit={createExpense} />}
      {editing && (
        <ExpenseModal
          mode="edit"
          expense={editing}
          filters={filters}
          locked={!!editing.locked}
          lockReason={`The ${monthLabel(editing.incurredOn.slice(0, 7))} statement is final, so this expense can no longer be edited.`}
          fieldErrors={formFields}
          onClose={() => { setEditing(null); setFormFields({}); }}
          onSave={delta => saveEdit(editing.id, delta)}
        />
      )}
      {reporting && (
        <ReportModal
          units={unitOptions}
          periods={(data?.months ?? []).map(m => m.month)}
          defaultUnit={unit}
          defaultPeriod={monthAll ? '' : shownMonth}
          filterNote={[cat && catLabel(cat), building && filters?.buildings.find(b => b.id === building)?.name, owner && filters?.owners.find(o => o.id === owner)?.name, q && `“${q}”`].filter(Boolean).join(' · ')}
          onClose={() => setReporting(false)}
          onGenerate={(u, m) => downloadReport({ unit: u, month: m })}
        />
      )}
    </>
  );
}

function TotalBar({ count, amount }: { count: number; amount: number }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3.5 px-[22px] max-md:px-4 [border-top:1px_solid_var(--color-line)]">
      <Eyebrow>Total · {plural(count, 'expense')}</Eyebrow>
      <Figure value={moneyString(amount, 'exact')} className="text-[18px] font-semibold tracking-[-0.015em] text-ink" />
    </div>
  );
}

/** Phone row: what, where, when on the left; amount and category on the right. Tapping it opens the edit dialog. */
function ExpenseCard({ e }: { e: Expense }) {
  return (
    <span className="flex gap-3 items-start text-ink">
      <span className="flex flex-col gap-[3px] min-w-0 flex-1">
        <span className="text-copy font-medium truncate">{e.description || catLabel(e.category)}</span>
        <span className="text-meta text-muted-ink truncate">{e.propertyName} {e.unitNumber}</span>
        <span className="text-meta text-muted-ink">{dateShort(e.incurredOn)}{e.locked ? ' · locked' : ''}</span>
      </span>
      <span className="flex flex-col items-end gap-[5px] shrink-0">
        <MoneyText sen={e.amount} mode="exact" strong className="text-copy" />
        <StatusBadge tone={catTone(e.category)} label={catLabel(e.category)} size="sm" />
      </span>
    </span>
  );
}

// ---- Grouped drill-down ----------------------------------------------------
// L1 Total -> L2 category (server totals) -> L3 that category's expenses, loaded
// a page at a time when the category is opened -> L4 line items under a rollup.

function GroupedTree({ title, period, total, count, cats, base, sort, withEdits, onEdit, openInList }: {
  title: string; period: string; total: number; count: number;
  cats: { category: string; count: number; amount: number }[];
  base: Record<string, string>; sort: Sort;
  withEdits: (e: Expense) => Expense; onEdit: (e: Expense) => void; openInList: (category: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(['total']));
  const toggle = (key: string) => setOpen(s => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const totalOpen = open.has('total');
  return (
    <div role="tree" aria-label={`${title}, ${period}`}>
      <TreeRow depth={0} kind="total" label={title} sub={`${period} · ${plural(count, 'item')}`} amount={total} expanded={totalOpen} onToggle={() => toggle('total')} />
      {totalOpen && cats.map(c => {
        const key = `cat:${c.category}`;
        return (
          <div key={key}>
            <TreeRow depth={1} kind="category" label={catLabel(c.category)} tone={catTone(c.category)} sub={plural(c.count, 'item')} amount={c.amount}
              expanded={open.has(key)} onToggle={() => toggle(key)} />
            {open.has(key) && (
              <CategoryRows base={base} category={c.category} count={c.count} sort={sort} open={open} toggle={toggle}
                withEdits={withEdits} onEdit={onEdit} openInList={() => openInList(c.category)} />
            )}
          </div>
        );
      })}
    </div>
  );
}

const TREE_PAGE = 50;

function CategoryRows({ base, category, count, sort, open, toggle, withEdits, onEdit, openInList }: {
  base: Record<string, string>; category: string; count: number; sort: Sort;
  open: Set<string>; toggle: (k: string) => void;
  withEdits: (e: Expense) => Expense; onEdit: (e: Expense) => void; openInList: () => void;
}) {
  const [page, setPage] = useState(1);
  const { data, loading } = useApi<Payload>(`/finance/expenses?${qs(base, { category, view: 'tree', sort, page, pageSize: TREE_PAGE })}`);
  if (!data) return <div className="py-1" style={{ paddingLeft: 54 }}><TableSkeleton rows={Math.min(3, count)} cols={2} /></div>;
  const pages = Math.ceil(data.pageTotal / TREE_PAGE);
  return (
    <div className={cx('transition-opacity duration-150', loading ? 'opacity-60' : '')}>
      {data.data.map(raw => {
        const e = withEdits(raw);
        const kids = e.children ?? [];
        const key = `exp:${e.id}`;
        return (
          <div key={e.id}>
            <TreeRow depth={2} kind="expense" label={e.description || catLabel(e.category)}
              sub={`${e.propertyName} ${e.unitNumber} · ${dateShort(e.incurredOn)}${e.reference ? ` · ${e.reference}` : ''}`}
              amount={e.amount} tone={catTone(e.category)} count={kids.length ? kids.length : undefined}
              expanded={open.has(key)} onToggle={kids.length ? () => toggle(key) : undefined}
              locked={!!e.locked} onEdit={kids.length ? undefined : () => onEdit(e)} />
            {open.has(key) && kids.map(k0 => {
              const k = withEdits(k0);
              return (
                <TreeRow key={k.id} depth={3} kind="expense" label={k.description || catLabel(k.category)}
                  sub={`${dateShort(k.incurredOn)}${k.reference ? ` · ${k.reference}` : ''}`}
                  amount={k.amount} tone={catTone(k.category)} locked={!!k.locked} onEdit={() => onEdit(k)} />
              );
            })}
          </div>
        );
      })}
      {pages > 1 && (
        <div className="flex items-center gap-3 flex-wrap min-h-[42px] py-2 pr-[18px] [border-bottom:1px_solid_var(--color-line-soft)] text-meta text-muted-ink" style={{ paddingLeft: 54 }}>
          <span className="tabular-nums">{fmtCount((page - 1) * TREE_PAGE + 1)}–{fmtCount(Math.min(data.pageTotal, page * TREE_PAGE))} of {fmtCount(data.pageTotal)}</span>
          <Button size="sm" variant="tertiary" disabled={page <= 1} disabledReason="This is the first page." onClick={() => setPage(p => p - 1)}>Previous</Button>
          <Button size="sm" variant="tertiary" disabled={page >= pages} disabledReason="This is the last page." onClick={() => setPage(p => p + 1)}>Next</Button>
          <Button size="sm" variant="tertiary" onClick={openInList} style={{ marginLeft: 'auto' }}>Open all in list</Button>
        </div>
      )}
    </div>
  );
}

// ---- One drill-down row ----------------------------------------------------
// Total / category / expense share this row; the chevron, indent, colour dot and
// Edit affordance switch on the kind. Leaf expenses carry the Edit button.

function TreeRow({ depth, kind, label, sub, amount, tone, count, expanded, onToggle, locked, onEdit }: {
  depth: number; kind: 'total' | 'category' | 'expense'; label: string; sub?: string; amount: number; tone?: Tone; count?: number;
  expanded?: boolean; onToggle?: () => void; locked?: boolean; onEdit?: () => void;
}) {
  const isTotal = kind === 'total', isCategory = kind === 'category';
  const expandable = !!onToggle;
  return (
    <div
      role="treeitem"
      aria-expanded={expandable ? expanded : undefined}
      className={cx(
        'flex items-center gap-[10px] min-h-[46px] py-[8px] pr-[18px] [border-bottom:1px_solid_var(--color-line-soft)]',
        isTotal ? 'min-h-[60px] font-semibold [border-bottom-color:var(--color-line)]' : isCategory ? 'font-medium' : '',
        isCategory && expanded ? 'bg-page' : '',
        expandable ? 'cursor-pointer' : '',
      )}
      style={{ paddingLeft: 14 + depth * 20 }}
      onClick={expandable ? onToggle : undefined}
    >
      {expandable ? (
        <span aria-hidden className="w-[18px] h-[18px] grid place-items-center shrink-0 text-muted-ink"><Icon name={expanded ? 'ChevronDown' : 'ChevronRight'} size="sm" /></span>
      ) : <span className="w-[18px] shrink-0" aria-hidden />}

      {tone && !isTotal && <span className={cx('w-[7px] h-[7px] rounded-full shrink-0', TONE[tone].dot)} aria-hidden />}

      <div className="flex flex-col gap-px min-w-0 flex-1">
        <span className={cx('truncate', isTotal ? 'text-[16px] tracking-[-0.01em]' : 'text-copy')} title={label}>
          {label}
          {count != null && count > 0 && kind !== 'expense' && <span className="ml-[6px] text-caption font-normal text-muted-ink">· {plural(count, 'item')}</span>}
          {count != null && count > 0 && kind === 'expense' && <span className="ml-[6px] text-caption font-normal text-muted-ink">· {plural(count, 'line')}</span>}
        </span>
        {sub && <span className="text-meta text-muted-ink truncate" title={sub}>{sub}{locked ? ' · statement final' : ''}</span>}
      </div>

      <MoneyText sen={amount} mode="exact" className={cx('shrink-0 text-right', isTotal ? 'text-[16px] font-semibold' : 'text-copy')} />

      {onEdit ? (
        <Button size="sm" variant="secondary" onClick={e => { e.stopPropagation(); onEdit(); }}
          title={locked ? 'The statement for this month is final, so this expense is locked.' : 'Edit this expense'}
          style={{ width: 72, flexShrink: 0, ...(locked ? { color: 'var(--color-text-muted)' } : {}) }}>
          {locked ? 'Locked' : 'Edit'}
        </Button>
      ) : <span className="w-[72px] shrink-0 hidden sm:block" aria-hidden />}
    </div>
  );
}

// ---- Local modal shell -----------------------------------------------------

function Modal({ title, sub, onClose, footer, children, width = 520 }: {
  title: string; sub?: string; onClose: () => void; footer: ReactNode; children: ReactNode; width?: number;
}) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      className="fixed inset-0 z-[60] grid place-items-center p-4 sm:p-6 bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={onClose} className="absolute inset-0" />
      <div className="relative w-full max-h-[90vh] overflow-y-auto bg-card rounded-card [box-shadow:var(--shadow-overlay)] [animation:dialog-in_var(--motion-slow)_var(--ease-out)_both]" style={{ maxWidth: width }}>
        <div className="pt-[22px] px-[22px] pb-[18px] flex flex-col gap-1">
          <h2 className="m-0 text-title leading-[1.3] font-semibold [text-wrap:pretty]">{title}</h2>
          {sub && <p className="m-0 text-copy leading-[1.55] text-muted-ink [text-wrap:pretty]">{sub}</p>}
        </div>
        <div className="px-[22px] pb-5 flex flex-col gap-[14px]">{children}</div>
        <div className="py-[14px] px-[22px] [border-top:1px_solid_var(--color-line)] bg-page flex items-center justify-end gap-[9px] flex-wrap">
          {footer}
        </div>
      </div>
    </div>
  );
}

function LabeledField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className={labelClass}>{label}</label>
      {children}
    </div>
  );
}

// ---- Add / edit expense ----------------------------------------------------

function ExpenseModal({ mode, expense, filters, defaultBuilding, defaultUnit, locked, lockReason, fieldErrors = {}, onClose, onSubmit, onSave }: {
  fieldErrors?: Record<string, string>;
  mode: 'create' | 'edit';
  expense?: Expense;
  filters?: FinanceFilters | null;
  defaultBuilding?: string;
  defaultUnit?: string;
  locked?: boolean;
  lockReason?: string;
  onClose: () => void;
  onSubmit?: (e: { unitId: string; category: Category; amount: number; incurredOn: string; reference: string; description: string }) => Promise<void> | void;
  onSave?: (delta: Partial<Expense>) => Promise<void> | void;
}) {
  const startUnit = defaultUnit ? filters?.units.find(u => u.id === defaultUnit) : undefined;
  const [buildingId, setBuildingId] = useState(startUnit?.buildingId ?? defaultBuilding ?? '');
  const [unitId, setUnitId] = useState(startUnit?.id ?? '');
  const [category, setCategory] = useState<Category>(expense?.category ?? 'internet');
  const [sen, setSen] = useState<number | null>(expense ? expense.amount : null);
  const [incurredOn, setIncurredOn] = useState(expense?.incurredOn ?? todayMyt());
  const [reference, setReference] = useState(expense?.reference ?? '');
  const [description, setDescription] = useState(expense?.description ?? '');
  const [busy, setBusy] = useState(false);

  const readOnly = mode === 'edit' && !!locked;
  // A new deduction needs a reference so the statement line can be traced. Imported
  // expenses arrived without one, so an edit does not insist on it.
  const needsRef = mode === 'create';
  const valid = !readOnly && (mode === 'edit' || unitId !== '') && !!sen && sen > 0 && incurredOn !== ''
    && (!needsRef || reference.trim() !== '') && description.trim() !== '';

  // The dialog's category select must always be able to show the current value,
  // even when it came in from a category outside the add-set.
  const catOptions = ADD_CATEGORIES.includes(category) ? ADD_CATEGORIES : [category, ...ADD_CATEGORIES];
  const unitChoices = (filters?.units ?? []).filter(u => !buildingId || u.buildingId === buildingId);
  const buildingName = (id: string) => filters?.buildings.find(b => b.id === id)?.name ?? '';

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!valid || !sen || busy) return;
    setBusy(true);
    try {
      if (mode === 'create') {
        await onSubmit?.({ unitId, category, description: description.trim(), amount: sen, incurredOn, reference: reference.trim() });
      } else {
        await onSave?.({ category, description: description.trim(), amount: sen, incurredOn, ...(reference.trim() ? { reference: reference.trim() } : {}) });
      }
    } finally { setBusy(false); }
  }

  const disabledReason = readOnly ? 'This expense is locked.'
    : mode === 'create' && !unitId ? 'Pick the unit first.'
    : !sen || sen <= 0 ? 'Enter the amount.'
    : needsRef && !reference.trim() ? 'A reference is required on every new expense.'
    : !description.trim() ? 'Add a short description.'
    : 'Complete the required fields.';

  return (
    <Modal
      title={mode === 'create' ? 'Add monthly expense' : 'Edit expense'}
      sub={mode === 'create'
        ? 'Logs a deduction against the unit for the owner statement. Every expense needs a category, date, amount and reference.'
        : `${expense?.propertyName} ${expense?.unitNumber}`}
      onClose={onClose}
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</Button>
        {!readOnly && (
          <Button size="sm" variant="primary" onClick={() => submit()} loading={busy} disabled={!valid} disabledReason={disabledReason}>
            {mode === 'create' ? 'Add expense' : 'Save changes'}
          </Button>
        )}
      </>}>
      {readOnly && (
        <div className={cx('py-[10px] px-3 rounded-control', TONE.warning.bg, 'text-warning text-meta [text-wrap:pretty]')}>
          {lockReason}
        </div>
      )}
      <form onSubmit={submit} className="flex flex-col gap-[14px]">
        {mode === 'create' && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-[14px]">
            <Select showLabel size="md" label="Building" value={buildingId} onChange={v => { setBuildingId(v); setUnitId(''); }}
              options={[{ value: '', label: 'All buildings' }, ...[...(filters?.buildings ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })).map(b => ({ value: b.id, label: b.name }))]} />
            <SearchSelect showLabel size="md" label="Unit" allLabel="Pick a unit" placeholder="Search units" value={unitId} onChange={setUnitId}
              options={unitChoices.map(u => ({ value: u.id, label: u.unitNumber, group: buildingName(u.buildingId) }))} />
          </div>
        )}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-[14px]">
          <Select showLabel size="md" label="Category" disabled={readOnly} value={category} onChange={v => setCategory(v as Category)}
            options={catOptions.map(c => ({ value: c, label: catLabel(c) }))} />
          <MoneyInput label="Amount (RM)" disabled={readOnly} valueSen={sen} onChangeSen={setSen} placeholder="185.00" error={fieldErrors.amount} />
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-[14px]">
          <DateField label="Date" required disabled={readOnly} value={incurredOn} onChange={setIncurredOn} error={fieldErrors.incurredOn} />
          <LabeledField label={needsRef ? 'Reference' : 'Reference (optional)'}><input required={needsRef} disabled={readOnly} value={reference} onChange={e => setReference(e.target.value)} placeholder="INV-2026-0912" className={fieldMono} /></LabeledField>
        </div>
        <LabeledField label="Description">
          <textarea disabled={readOnly} value={description} onChange={e => setDescription(e.target.value)} placeholder="Internet, September" rows={2}
            className="block w-full box-border px-3 py-[10px] border border-solid border-line rounded-control outline-none bg-card text-ink font-sans text-copy font-normal h-auto resize-y leading-[1.5]" />
        </LabeledField>
      </form>
      {mode === 'edit' && expense && <div className="mt-4"><HistoryDisclosure entity="expenses" id={expense.id} /></div>}
    </Modal>
  );
}

// ---- Generate report -------------------------------------------------------

function ReportModal({ units, periods, defaultUnit, defaultPeriod, filterNote, onClose, onGenerate }: {
  units: SelectOption[]; periods: string[]; defaultUnit: string; defaultPeriod: string; filterNote: string;
  onClose: () => void; onGenerate: (unit: string, period: string) => Promise<void>;
}) {
  const [unit, setUnit] = useState(defaultUnit);
  const [busy, setBusy] = useState(false);
  // A month of a big portfolio takes a few seconds to build; without this the button looks dead.
  const generate = async () => { setBusy(true); try { await onGenerate(unit, period); } finally { setBusy(false); } };
  const [period, setPeriod] = useState(defaultPeriod);
  const picked = units.find(u => u.value === unit);
  const unitLabel = unit ? (picked ? `${picked.group ?? ''} ${picked.label}`.trim() : unit) : 'All units';
  const periodText = period ? monthLabel(period) : 'All months';
  // Keep the active month in the list even when it has no expenses, so the
  // select always shows what will be exported.
  const periodOptions = !period || periods.includes(period) ? periods : [period, ...periods];

  return (
    <Modal title="Generate expenses report" sub="Exports a CSV whose header prints the filters applied and the time it was generated." onClose={onClose} width={480}
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={generate} loading={busy}>Download CSV</Button>
      </>}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-[14px]">
        <SearchSelect showLabel label="Unit" allLabel="All units" placeholder="Search units" value={unit} onChange={setUnit} options={units} />
        <Select showLabel label="Month" value={period} onChange={setPeriod}
          options={[{ value: '', label: 'All months' }, ...periodOptions.map(p => ({ value: p, label: monthLabel(p) }))]} />
      </div>
      <div className="py-[10px] px-3 rounded-control bg-page border border-solid border-line text-meta text-muted-ink">
        Scope: {unitLabel} · {periodText}{filterNote ? ` · ${filterNote}` : ''}
      </div>
    </Modal>
  );
}
