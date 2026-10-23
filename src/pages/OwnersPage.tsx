import { lazy, Suspense, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { useToast } from '../components/Toast';
import { api, errorMessage } from '../lib/api';
import { saveBlob, zipStore } from '../lib/export';
import type { Report } from './OwnerIncomeReportPage';
import { rmShort, monthLabel, todayMyt, titleCase, plural } from '../lib/format';
import { phone as formatPhone } from '../lib/phone';
import { MoneyText } from '../components/MoneyText';
import { Select } from '../components/Select';
import {
  type Owner, type Payload,
  FALLBACK, netOf, grossOf, guaranteedOf, managedNetOf, managedGrossOf, terms, addressLines,
  AddOwnerModal,
} from './owners/shared';
import { FilterBar } from '../components/FilterBar';
import { useUrlState, usePhone, SearchBox, MonthStepper, shiftMonth, useFinanceFilters } from './finance/listKit';
import { MODELS, type RevenueModel } from '../lib/revenueModel';
import { ModelChip } from './units/ContractTab';
import { CodeBadge } from './units/UnitExtras';
import { CODES, codeName } from '../lib/revenueModel';
import { Segmented } from '../components/ops/OpsUi';
import { RowsSkeleton } from '../components/Loading';
import { useSession } from '../lib/session';
import { areaOpen } from '../lib/navigation';
import { RowActions, type RowAction } from '../components/RowActions';
import { ConfirmDialog, type ConfirmSpec } from '../components/ConfirmDialog';
import { mayInviteOwners, portalAction, portalBadge } from './owners/portalAccess';

const StatementsPage = lazy(() => import('./StatementsPage'));
const PayoutsPage = lazy(() => import('./PayoutsPage'));

/**
 * Owners list. Each row opens the full owner profile at `/owners/:id`
 * (OwnerProfilePage) — the real profile with per-unit P&L, expenses and the
 * owner-level default fee — rather than a small drawer. Add-owner lives here;
 * link unit, contract, invite, delete and the per-unit financials all live on
 * the profile. The rows, stats and fee model are shared with the profile so the
 * two surfaces never drift.
 *
 * About 120 owners: the whole list comes in one response (~60 KB) and is
 * searched and sorted here, which keeps sorting by net instant.
 *
 * Owner statements and owner payouts live on the owner (owner, 11 Oct 2026). One owner's month is on their profile;
 * the whole month for every owner (generate, mark final, send, start the payout run, mark paid) is this page's
 * Statements and Payouts tabs, for people with the Finance area. `/finance/statements` and `/finance/payouts`
 * redirect here. On a phone the tabs show only when a link opened one.
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
/** Under the name in the list: email and phone, whichever are on file (the Phone column shows the phone alone). */
const contactText = (o: Owner) => [o.email, formatPhone(o.phone)].filter(Boolean).join(' · ');
const addressText = (o: Owner) => addressLines(o.address).join(', ');
/** What the search box matches: name, legal name, email, phone (digits only, so "012 345" finds "+60 12-345..."),
 *  address and unit names. */
const digits = (v: string) => v.replace(/\D/g, '');
function matches(o: Owner, q: string) {
  const qd = digits(q);
  // A Malaysian number typed with its leading 0 is stored as +60...: compare without the 0 / 60.
  const local = (d: string) => d.replace(/^(?:60|0)/, '');
  return [o.displayName, o.legalName, o.email, addressText(o), ...o.units.map(u => u.unitLabel)].some(s => (s ?? '').toLowerCase().includes(q))
    || (qd.length >= 3 && !!o.phone && local(digits(o.phone)).includes(local(qd)));
}
/** The owner's contract code for the list's filter: the one code all their units share, "Mixed", or none. */
const codeText = (o: Owner) => {
  const codes = [...new Set(o.units.map(u => u.contractCode).filter(Boolean))] as string[];
  return codes.length === 0 ? null : codes.length === 1 ? codes[0] : 'Mixed';
};
const bankText = (o: Owner) => (o.hasBankDetails ? 'On file' : 'Missing');
/** The DataTable's own column filters (the Filter button), applied again here so the totals under the table add up
 *  the owners the table shows. Same rules as DataTable: select = any of the ticked values, number = from~to, text = contains. */
function byColumnFilters(list: Owner[], get: (k: string) => string, buildingName: (o: Owner) => string): Owner[] {
  const sel = (k: string, v: string | null) => { const f = get(`f.${k}`); return !f || f.split(',').includes(v ?? ''); };
  const units = get('f.units'), [lo, hi] = units ? units.split('~') : ['', ''];
  const b = get('f.building').toLowerCase();
  return list.filter(o => sel('code', codeText(o)) && sel('portal', portalBadge(o, true).label) && sel('bank', bankText(o))
    && (!lo || o.units.length >= Number(lo)) && (!hi || o.units.length <= Number(hi)) && (!b || buildingName(o).toLowerCase().includes(b)));
}
const initials = (name: string) => name.split(/\s+/).filter(Boolean).map(n => n[0]).slice(0, 2).join('').toUpperCase();

type View = 'owners' | 'statements' | 'payouts';
/** Query keys each tab keeps in the address; switching tabs clears them so one tab's filters never leak into another. */
const TAB_KEYS = ['q', 'building', 'model', 'month', 'sort', 'state', 'period', 'page', 'size'];

export default function OwnersPage() {
  const url = useUrlState();
  const phone = usePhone();
  const { user } = useSession();
  const money = !!user && areaOpen(user.role, 'finance', user.access);
  const asked = url.get('view');
  const view: View = money && (asked === 'statements' || asked === 'payouts') ? asked : 'owners';
  const pick = (v: View) => url.set({ view: v === 'owners' ? null : v, ...Object.fromEntries(TAB_KEYS.map(k => [k, null])) });
  const tabs = money && (!phone || view !== 'owners') ? (
    <Segmented<View> label="Owners, statements and payouts" value={view} onChange={pick} className="self-start"
      options={[{ value: 'owners', label: 'Owners' }, { value: 'statements', label: 'Statements' }, { value: 'payouts', label: 'Payouts' }]} />
  ) : null;
  if (view === 'owners') return <OwnerList tabs={tabs} />;
  return (
    <>
      <PageHeader title="Owners" sub={view === 'statements' ? 'Owner statements for every owner, a month at a time.' : 'Owner payouts for every owner.'} />
      {tabs}
      <Suspense fallback={<RowsSkeleton rows={8} cols={5} />}>
        {view === 'statements' ? <StatementsPage embedded /> : <PayoutsPage embedded />}
      </Suspense>
    </>
  );
}

function OwnerList({ tabs }: { tabs: ReactNode }) {
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
  const buildingNameOf = useMemo(() => new Map((filters?.buildings ?? []).map(b => [b.id, b.name])), [filters]);
  const buildingsOf = (o: Owner) => [...new Set(o.units.map(u => (u.buildingId ? buildingNameOf.get(u.buildingId) : null)).filter(Boolean))].join(', ');
  const toast = useToast();
  const navigate = useNavigate();
  const [modal, setModal] = useState(false);
  const { user } = useSession();
  const inviter = mayInviteOwners(user?.role);
  const [dialog, setDialog] = useState<ConfirmSpec | null>(null);
  // Read through a ref: the memoised columns would otherwise hold a stale toast/dialog closure.
  const actionsRef = useRef<(o: Owner) => RowAction[]>(() => []);
  actionsRef.current = o => {
    const portal = portalAction(o, { toast, confirm: setDialog, onDone: () => reload() });
    return [{ key: 'open', label: 'Open profile', icon: 'ArrowRight', run: () => navigate(`/owners/${encodeURIComponent(o.id)}`) }, ...(portal ? [portal] : [])];
  };

  const all = useMemo(() => data?.data ?? [], [data]);
  const counts = useMemo(() => ({
    all: all.length,
    ...Object.fromEntries(MODELS.map(m => [m.key, all.filter(o => o.units.some(u => modelOf(u) === m.key)).length])) as Record<RevenueModel, number>,
    none: all.filter(o => o.units.length === 0).length,
  }), [all]);

  // Name order until someone sorts by a column.
  const rows = useMemo(() => all.filter(o =>
    (!q || matches(o, q)) &&
    (!building || o.units.some(u => u.buildingId === building)) &&
    (!model || (model === 'none' ? o.units.length === 0 : o.units.some(u => modelOf(u) === model))))
    .sort((a, b) => a.displayName.localeCompare(b.displayName)), [all, q, building, model]);

  const unitCount = all.reduce((s, o) => s + o.units.length, 0);
  // Portfolio rollup — pure client compute over loaded owners, reusing the same per-owner net the profile shows.
  const portfolioNet = all.reduce((s, o) => s + netOf(o), 0);
  const portfolioGuaranteed = all.reduce((s, o) => s + guaranteedOf(o), 0);
  const portfolioManagedNet = all.reduce((s, o) => s + managedNetOf(o), 0);
  const portfolioManagedGross = all.reduce((s, o) => s + managedGrossOf(o), 0);
  const tableRows = byColumnFilters(rows, url.get, buildingsOf);
  const shownNet = tableRows.reduce((s, o) => s + netOf(o), 0);
  const shownGross = tableRows.reduce((s, o) => s + grossOf(o), 0);
  const filtered = !!(q || building || model);
  const monthText = month === thisMonth ? 'this month' : monthLabel(month);

  /** The month's statement of every unit of the owners the table shows, one PDF per unit (its month and year to date),
   *  in one zip (owner, 22 Oct 2026). Drawn in the browser: the server has no PDF renderer. Four reports are fetched at a time. */
  const finance = !!user && areaOpen(user.role, 'finance', user.access);
  const [zipping, setZipping] = useState(false);
  async function zipStatements() {
    if (zipping) return;
    setZipping(true);
    try {
      // period always given: left out, the endpoint answers the latest month that has statements instead.
      const list = await api.get<{ data: { id: string; ownerId: string; ownerName: string }[] }>('/statements', { period: month, pageSize: 500 });
      const shown = new Set(tableRows.map(o => o.id));
      const picked = list.data.filter(s => shown.has(s.ownerId));
      if (!picked.length) {
        toast({ tone: 'warning', title: `No owner statements for ${monthLabel(month)} yet.`, body: 'Generate them on the Statements tab, then export again.' });
        return;
      }
      toast({ tone: 'info', title: `Making the unit statements of ${plural(picked.length, 'owner')}...`, body: 'The zip downloads when it is ready. Keep this page open.' });
      const [{ statementPdf }, { printedPhone }] = await Promise.all([import('../lib/statementPdf'), import('./OwnerIncomeReportPage')]);
      let logo: Promise<Uint8Array | null> | null = null;
      const logoOf = (src: string) => (logo ??= fetch(src).then(async r => (r.ok ? new Uint8Array(await r.arrayBuffer()) : null)).catch(() => null));
      const made: { name: string; bytes: Uint8Array }[] = [];
      const noReport: string[] = [], failed: string[] = [];
      for (let i = 0; i < picked.length; i += 4) {
        await Promise.all(picked.slice(i, i + 4).map(async s => {
          try {
            const { data: r } = await api.get<{ data: Report }>(`/statements/${encodeURIComponent(s.id)}/report`);
            if (!r.units.length) { noReport.push(titleCase(s.ownerName)); return; }
            const opts = { logo: await logoOf(r.settings.company.logo), phone: printedPhone };
            for (const u of r.units) made.push({ name: `${u.code} - ${titleCase(s.ownerName)}`, bytes: await statementPdf({ ...r, units: [u] }, opts) });
          } catch {
            failed.push(titleCase(s.ownerName));
          }
        }));
      }
      if (made.length) {
        const used = new Map<string, number>();
        const files = made.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })).map(({ name, bytes }): [string, Uint8Array] => {
          const stem = `${name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Unit'} - ${monthLabel(month)}`;
          const n = (used.get(stem) ?? 0) + 1;
          used.set(stem, n);
          return [`${stem}${n > 1 ? ` (${n})` : ''}.pdf`, bytes];
        });
        saveBlob(zipStore(files) as BlobPart, `unit-statements-${month}.zip`, 'application/zip');
      }
      const missing = tableRows.length - picked.length;
      toast({
        tone: failed.length || !made.length ? 'warning' : 'success',
        title: made.length ? `${plural(made.length, 'unit statement')} in the zip.` : 'No statement could be made into a PDF.',
        body: [
          missing > 0 && `${plural(missing, 'owner')} had no statement for ${monthLabel(month)}.`,
          noReport.length > 0 && `${plural(noReport.length, 'owner')} had a statement from before Property OS, with no report to draw: ${noReport.join(', ')}.`,
          failed.length > 0 && `Could not be made: ${failed.join(', ')}. Try again in a moment.`,
        ].filter(Boolean).join(' ') || undefined,
      });
    } catch (e) {
      toast({ tone: 'critical', title: 'Owner statements could not be gathered.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setZipping(false); }
  }

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
            {(o.email || o.phone) && <span className="text-meta text-muted-ink truncate" title={contactText(o)}>{contactText(o)}</span>}
          </span>
        </span>
      ) },
    { key: 'email', label: 'Email', value: o => o.email || null, hidden: true, filter: false, width: 200 },
    { key: 'phone', label: 'Phone', type: 'phone', value: o => o.phone, hidden: true, filter: false, width: 150 },
    { key: 'address', label: 'Mailing address', value: o => addressText(o) || null, hidden: true, filter: false, width: 260 },
    { key: 'units', label: 'Units', type: 'number', align: 'left', value: o => o.units.length, width: 140, filter: { kind: 'number', hint: 'Number of units' },
      render: o => <span className="text-copy text-muted-ink truncate block" title={o.units.map(u => u.unitLabel).join(', ')}>{unitsText(o)}</span> },
    { key: 'code', label: 'Contract', value: o => codeText(o), width: 110, title: 'The contract type: PS, PS GRR, PS YGRR, LT, RTR, MANAGE, WH. Mixed: units on different types.',
      filter: { kind: 'select', options: [...CODES.map(c => ({ value: c.code, label: `${codeName(c.code)} · ${c.label}` })), { value: 'Mixed', label: 'Mixed (units on different types)' }] },
      render: o => { const c = codeText(o); return !c ? <span className="text-muted-ink">—</span> : c === 'Mixed' ? <span className="text-meta text-muted-ink">Mixed</span> : <CodeBadge code={o.units.find(u => u.contractCode)?.contractCode} size="sm" />; } },
    { key: 'bank', label: 'Bank details', value: o => bankText(o), hidden: true, width: 120, filter: { kind: 'select', options: [{ value: 'On file', label: 'On file' }, { value: 'Missing', label: 'Missing' }] } },
    { key: 'building', label: 'Buildings', value: o => buildingsOf(o) || null, hidden: true, width: 200, filter: { kind: 'text', hint: 'Owners with a unit in a building whose name contains' } },
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
            <Link key={u.unitId} to={`/properties/units/${encodeURIComponent(u.unitId)}?tab=contract`} onClick={e => e.stopPropagation()}
              className="flex items-center justify-between gap-2 min-w-0 pl-5 no-underline text-inherit! hover:underline" title={`${u.unitLabel} · ${terms(u)}`}>
              <span className="text-meta text-ink truncate">{titleCase(u.unitLabel)}</span>
              <span className="shrink-0"><ModelChip model={modelOf(u)} label={terms(u)} /></span>
            </Link>
          ))}
        </span>
      ) : <span className="text-copy text-muted-ink truncate block" title={ownerTerms(o)}>{ownerTerms(o)}</span> },
    { key: 'gross', label: `Gross Income, ${monthCol}`, type: 'money', value: o => grossOf(o), width: 150, filter: false,
      render: o => <MoneyText sen={grossOf(o)} mode="exact" tone="muted" className="text-copy" /> },
    { key: 'net', label: `Owner payout, ${monthCol}`, type: 'money', value: o => netOf(o), width: 150, filter: false,
      render: o => <MoneyText sen={netOf(o)} mode="exact" tone="auto" className="text-copy font-medium" /> },
    { key: 'guaranteed', label: `Guaranteed rent, ${monthCol}`, type: 'money', value: o => guaranteedOf(o), hidden: true, filter: false, width: 150 },
    { key: 'defaultFee', label: 'Default fee %', type: 'number', value: o => o.defaultManagementFeePct, hidden: true, filter: false, width: 110 },
    { key: 'portal', label: 'Portal', type: 'status', width: 120,
      filter: { kind: 'select', options: ['Active', 'Invited', 'Not invited', 'Switched off'].map(v => ({ value: v, label: v })) },
      value: o => portalBadge(o, true).label,
      status: o => portalBadge(o, true) },
    ...(inviter ? [{ key: 'actions', label: '', width: 52, align: 'right' as const, noExport: true, sortable: false, filter: false, hideable: false,
      render: (o: Owner) => <RowActions name={titleCase(o.displayName)} items={actionsRef.current(o)} /> } satisfies Column<Owner>] : []),
  ], [open, monthCol, inviter, buildingNameOf]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader title="Owners" sub={data ? `${plural(all.length, 'owner')} · ${plural(unitCount, 'unit')} under management` : 'Loading owners…'}
        primary={<Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal(true)}>Add owner</Button>} />
      {tabs}

      {/* The month's payout as the dark statement tile; the split and the gross beside it; the month stepper on top. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-[11px] font-semibold tracking-[0.12em] uppercase text-muted-ink">Owner payouts · {monthText} (estimate)</span>
        <span className="flex items-center gap-2 flex-wrap">
          <MonthStepper label={monthLabel(month)} onStep={by => url.set({ month: shiftMonth(month, by) === thisMonth ? null : shiftMonth(month, by) })} />
          {finance && (
            <Button size="sm" variant="primary" icon={<Icon name="FileArchive" size="sm" />} loading={zipping} disabled={!tableRows.length}
              disabledReason="No owners listed under these filters." title={`The ${monthLabel(month)} statement of each unit of the owners listed, one PDF per unit.`}
              onClick={() => void zipStatements()}>Unit statements (.zip)</Button>
          )}
        </span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] gap-3 sm:gap-4">
        <div className="col-span-2 lg:col-span-1 relative rounded-card bg-black text-white p-5 flex flex-col gap-2 overflow-hidden">
          <span aria-hidden className="absolute left-5 top-0 h-[2px] w-8 bg-gold" />
          <span className="text-[11px] font-semibold tracking-[0.12em] uppercase text-gold">To pay owners</span>
          <span className="text-[34px] leading-none font-semibold tabular-nums text-gold">{data ? rmShort(portfolioNet) : '—'}</span>
          <span className="text-meta text-on-dark">{data ? `${plural(all.length, 'owner')} · ${plural(unitCount, 'unit')}` : 'Loading…'}</span>
        </div>
        {([
          ['From managed units', portfolioManagedNet, 'Income split, after costs'],
          ['Guaranteed rent', portfolioGuaranteed, 'GRR units, fixed'],
          ['Gross income', portfolioManagedGross, 'Managed units, before split'],
        ] as const).map(([label, v, hint]) => (
          <div key={label} className="rounded-card border border-solid border-line bg-card p-4 sm:p-5 flex flex-col gap-2 min-w-0">
            <span className="text-[11px] font-semibold tracking-[0.12em] uppercase text-muted-ink">{label}</span>
            <span className="text-[24px] leading-none font-semibold tabular-nums">{data ? rmShort(v) : '—'}</span>
            <span className="text-meta text-muted-ink truncate">{hint}</span>
          </div>
        ))}
      </div>
      <details className="text-meta text-muted-ink -mt-1">
        <summary className="cursor-pointer select-none w-fit">How these are worked out</summary>
        <p className="m-0 mt-2 max-w-[880px] text-pretty">Each unit is worked out the way its owner statement is, by its payout model: income split by night into the month, less the costs the owner pays, then the share, minimum or fixed rent, and Owner Adjustments. Guaranteed rent is counted on its own, not as a share of earnings. Until the month's statement is final, these are estimates.</p>
      </details>

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
          <SearchBox className="flex-1 min-w-[200px]" label="Search owners" placeholder="Search owner, phone, email, address or unit" value={url.get('q')} onChange={v => url.set({ q: v || null, page: null })} />
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
        footer={tableRows.length > 0 && (
          <div className="flex items-center gap-x-5 gap-y-1 flex-wrap py-3 px-[22px] max-md:px-4 bg-page [border-top:1px_solid_var(--color-line)] text-copy font-semibold">
            <span>{filtered || tableRows.length !== rows.length ? `${tableRows.length} of ${plural(all.length, 'owner')}` : plural(rows.length, 'owner')}</span>
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
            {inviter && <RowActions name={titleCase(o.displayName)} items={actionsRef.current(o)} />}
          </span>
        )}
      />

      {modal && <AddOwnerModal onClose={() => setModal(false)} onSubmit={addOwner} />}
      <ConfirmDialog spec={dialog} onClose={() => setDialog(null)} />
    </>
  );
}
