import { useMemo, useRef, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { opensInPlace } from '../../lib/linkClick';
import { go } from '../../lib/go';
import PageHeader from '../../components/PageHeader';
import { Button, ButtonLink } from '../../components/Button';
import Icon from '../../components/Icon';
import { Card } from '../../components/Card';
import { KeyFacts } from '../../components/KeyFacts';
import { DataTable, type Column } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { RowActions, type RowAction } from '../../components/RowActions';
import { ConfirmDialog, type ConfirmSpec } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { useApi } from '../../lib/useApi';
import { useSession } from '../../lib/session';
import { areaOpen } from '../../lib/navigation';
import { count, plural, titleCase } from '../../lib/format';
import { useUrlState, SearchBox } from '../finance/listKit';
import { type Owner, type Payload, FALLBACK } from './shared';
import { mayInviteOwners, mayViewAsOwner, portalAction, portalBadge, portalOf } from './portalAccess';

type Access = '' | 'active' | 'invited' | 'none';

const unitsText = (o: Owner) => o.units.length === 0 ? 'No units' : o.units.length === 1 ? o.units[0].unitLabel : plural(o.units.length, 'unit');
const stateOf = (o: Owner): Access => { const s = portalOf(o).state; return s === 'active' ? 'active' : s === 'invited' ? 'invited' : 'none'; };

/**
 * Owners > Owner portal and showcase (`/owners/portal`; owner, 12 Nov 2026). Owner B folded into Owners: the company
 * showcase is the sales demo (sample owners were removed), and this tab says where every owner's portal login stands.
 * View as owner moved to the owner profile and this list, for Management and Finance only. The tab keeps Owner B's
 * permission area (Performance), which sales staff open; the owner list needs Owners as well.
 */
export default function PortalShowcasePage() {
  const { user } = useSession();
  const owners = !!user && areaOpen(user.role, 'owners', user.access);
  return (
    <>
      <PageHeader title="Owner portal and showcase"
        sub="The owner-facing website and phone app: the same real figures as Units and Owners, drawn for an owner. The company showcase is the sales demo." />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(360px,100%),1fr))] [align-items:start]">
        <ShowcaseCard />
        {owners && <PortalAccessCard />}
      </div>
      {owners && <PortalList />}
    </>
  );
}

const SHOWCASE = '/performance/showcase';
const SHOWCASE_PHONE = '/performance/showcase/owner?device=mobile';
/** A plain click stays in the app; Ctrl or Cmd + click and middle click open a new tab, as a link does. */
const inApp = (to: string) => (e: MouseEvent<HTMLAnchorElement>) => { if (!opensInPlace(e)) return; e.preventDefault(); go(to); };

function ShowcaseCard() {
  return (
    <Card>
      <div className="p-5 flex flex-col gap-3">
        <span className="text-[15px] font-semibold tracking-[-0.01em]">Company showcase</span>
        <span className="text-copy text-ink-2 text-pretty">
          Every unit The Conts manages, with real reservations, occupancy and owner payouts, as a calm website to open in
          front of a prospective owner. Inside it, the owner portal shows one fixed sample owner, marked Sample data, on
          the web or as the phone app. No real owner is ever shown.
        </span>
        <div className="flex flex-wrap gap-2">
          <ButtonLink size="sm" variant="primary" href={SHOWCASE} onClick={inApp(SHOWCASE)} icon={<Icon name="Presentation" size="sm" />}>Open the showcase</ButtonLink>
          <ButtonLink size="sm" href={SHOWCASE_PHONE} onClick={inApp(SHOWCASE_PHONE)} icon={<Icon name="Smartphone" size="sm" />}>Open the phone app</ButtonLink>
        </div>
      </div>
    </Card>
  );
}

function PortalAccessCard() {
  const { data } = useApi<Payload>('/owners', FALLBACK);
  const all = data?.data ?? [];
  const n = (s: Access) => all.filter(o => stateOf(o) === s).length;
  const shown = (v: number) => (data ? count(v) : '—');
  return (
    <Card>
      <div className="p-5 flex flex-col gap-3">
        <span className="text-[15px] font-semibold tracking-[-0.01em]">Portal access</span>
        <KeyFacts cols={2} items={[['Signed in', shown(n('active'))], ['Invited', shown(n('invited'))], ['Not invited', shown(n('none'))], ['Owners', shown(all.length)]]} />
        <span className="text-meta text-muted-ink">An owner signs in with the invitation we email, and sees only their own units and their final owner statements.</span>
      </div>
    </Card>
  );
}

function PortalList() {
  const url = useUrlState();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useSession();
  const inviter = mayInviteOwners(user);
  const viewAs = mayViewAsOwner(user);
  const [dialog, setDialog] = useState<ConfirmSpec | null>(null);
  const { data, loading, error, reload } = useApi<Payload>('/owners', FALLBACK);
  const q = url.get('q').trim().toLowerCase();
  const state = (['active', 'invited', 'none'].includes(url.get('access')) ? url.get('access') : '') as Access;
  const all = useMemo(() => [...(data?.data ?? [])].sort((a, b) => a.displayName.localeCompare(b.displayName)), [data]);
  const rows = useMemo(() => all.filter(o => (!state || stateOf(o) === state)
    && (!q || [o.displayName, o.email, ...o.units.map(u => u.unitLabel)].join(' ').toLowerCase().includes(q))), [all, q, state]);
  const n = (s: Access) => all.filter(o => stateOf(o) === s).length;
  const open = (o: Owner) => navigate(`/owners/${encodeURIComponent(o.id)}`);
  const openPortal = (o: Owner) => navigate(`/owners/${encodeURIComponent(o.id)}/portal`);
  // Read through a ref: the memoised columns would otherwise hold a stale toast/dialog closure.
  const actionsRef = useRef<(o: Owner) => RowAction[]>(() => []);
  actionsRef.current = o => {
    const portal = inviter ? portalAction(o, { toast, confirm: setDialog, onDone: () => reload() }) : null;
    return [
      ...(portal ? [portal] : []),
      ...(viewAs && o.units.length > 0 ? [{ key: 'viewAs', label: 'View as owner', icon: 'Eye', run: () => openPortal(o) }] : []),
      { key: 'open', label: 'Open profile', icon: 'ArrowRight', run: () => open(o) },
    ];
  };
  const filtered = !!(q || state);
  const clear = () => url.set({ q: null, access: null });

  const columns = useMemo<Column<Owner>[]>(() => [
    { key: 'owner', label: 'Owner', width: 240, hideable: false, value: o => o.displayName,
      render: o => <span className="text-copy font-medium truncate block" title={o.displayName}>{titleCase(o.displayName)}</span>, sub: o => o.email || null },
    { key: 'units', label: 'Units', width: 220, value: o => o.units.length, render: o => <span className="truncate block" title={o.units.map(u => u.unitLabel).join(', ')}>{unitsText(o)}</span> },
    { key: 'portal', label: 'Portal', type: 'status', width: 170, value: o => portalBadge(o, true).label, status: o => portalBadge(o, true),
      sub: o => portalBadge(o).hint ?? null },
    ...(viewAs ? [{ key: 'viewAs', label: '', width: 150, align: 'right' as const, noExport: true, sortable: false, filter: false,
      render: (o: Owner) => o.units.length > 0 ? (
        <Button size="sm" variant="tertiary" icon={<Icon name="Eye" size="sm" />} onClick={e => { e.stopPropagation(); openPortal(o); }}>View as owner</Button>
      ) : null } satisfies Column<Owner>] : []),
    { key: 'actions', label: '', width: 52, align: 'right' as const, noExport: true, sortable: false, filter: false, hideable: false,
      render: (o: Owner) => <RowActions name={titleCase(o.displayName)} items={actionsRef.current(o)} /> },
  ], [viewAs]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <DataTable<Owner>
        id="owner-portal" columns={columns} rows={data ? rows : null} rowKey={o => o.id} loading={loading} error={error} onRetry={reload}
        onRowClick={open} pageSize={0} viewParams={['q', 'access']} filtered={filtered} onClearFilters={clear}
        noun={['owner', 'owners']} exportName="owner-portal-access"
        empty={{ title: 'No owners yet.', body: 'Owners are added on the Owners tab.' }}
        header={
          <div className="py-3 px-[22px] max-md:px-4 [border-bottom:1px_solid_var(--color-line)]">
            <FilterBar<Access> label="Owners by portal access" value={state} onChange={k => url.set({ access: k || null })}
              views={[
                { key: '', label: 'All owners', count: data ? all.length : undefined },
                { key: 'active', label: 'Signed in', count: data ? n('active') : undefined },
                { key: 'invited', label: 'Invited, not signed in', short: 'Invited', count: data ? n('invited') : undefined },
                { key: 'none', label: 'Not invited', count: data ? n('none') : undefined },
              ]} />
          </div>
        }
        toolbar={<>
          <SearchBox className="flex-1 min-w-[200px]" label="Search owners" placeholder="Search owner, email or unit" value={url.get('q')} onChange={v => url.set({ q: v || null })} />
          {filtered && <Button size="sm" variant="tertiary" onClick={clear}>Clear all</Button>}
        </>}
        renderCard={o => (
          <span className="flex items-center gap-3 min-w-0">
            <span className="flex flex-col gap-[2px] min-w-0 flex-1">
              <span className="text-copy font-medium truncate">{titleCase(o.displayName)}</span>
              <span className="text-meta text-muted-ink truncate">{unitsText(o)} · {portalBadge(o, true).label}</span>
            </span>
            <RowActions name={titleCase(o.displayName)} items={actionsRef.current(o)} />
          </span>
        )}
      />
      <p className="m-0 text-meta text-muted-ink max-w-[880px] text-pretty">
        The portal shows an owner the same units, reservations and money as this back office, read-only: only their own
        units, guests by first name, and owner statements once they are final.
      </p>
      <ConfirmDialog spec={dialog} onClose={() => setDialog(null)} />
    </>
  );
}
