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
import { rm } from '../lib/format';
import { cx } from '../lib/design-tokens';
import {
  type Owner, type Payload,
  FALLBACK, netOf, grossOf, terms,
  Roll, AddOwnerModal,
} from './owners/shared';

/**
 * Owners list. Each row opens the full owner profile at `#/owners/:id`
 * (OwnerProfilePage) — the real profile with per-unit P&L, expenses and the
 * owner-level default fee — rather than a small drawer. Add-owner lives here;
 * link unit, contract, invite, delete and the per-unit financials all live on
 * the profile. The rows, stats and fee model are shared with the profile so the
 * two surfaces never drift.
 */

const COLS = 'grid-cols-[minmax(170px,1.5fr)_minmax(190px,1.7fr)_minmax(120px,0.9fr)_minmax(120px,1fr)_minmax(120px,1fr)]';

/** Terms shown for an owner in the list. A single-unit owner reads exactly as
 *  that unit's terms; a multi-unit owner shows the shared terms when every unit
 *  matches, otherwise "Mixed" (rather than misleadingly showing only the first
 *  unit's). No units → em dash. */
function ownerTerms(o: Owner): string {
  if (o.units.length === 0) return '—';
  const all = o.units.map(terms);
  return all.every(t => t === all[0]) ? all[0] : 'Mixed';
}

export default function OwnersPage() {
  const { data, loading, error, reload } = useApi<Payload>('/owners', FALLBACK);
  const toast = useToast();
  const navigate = useNavigate();
  const [modal, setModal] = useState(false);

  const rows = useMemo(() => data?.data ?? [], [data]);
  const unitCount = rows.reduce((s, o) => s + o.units.length, 0);
  // Portfolio net-payout rollup — pure client compute over loaded owners (no
  // /owners/summary endpoint in api.md), reusing the same per-owner net the profile shows.
  const portfolioNet = rows.reduce((s, o) => s + netOf(o), 0);
  const portfolioGross = rows.reduce((s, o) => s + grossOf(o), 0);

  const openProfile = (id: string) => navigate(`/owners/${encodeURIComponent(id)}`);

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

  return (
    <>
      <PageHeader title="Owners" sub={`${rows.length} owners · ${unitCount} units under management`}
        right={<Button variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal(true)}>Add owner</Button>} />

      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      <Card>
        <div className="flex gap-[30px] flex-wrap py-4 px-[22px]">
          <Roll label="Net payout, this month" value={rm(portfolioNet)} strong />
          <Roll label="Gross, this month" value={rm(portfolioGross)} />
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <div className="min-w-[860px]">
            <div className={cx(COLS, 'grid gap-[14px] py-[9px] px-[22px] bg-muted [border-bottom:1px_solid_var(--color-line)] text-[12px] font-semibold text-muted-ink')}>
              <div>Owner</div><div>Units</div><div className="text-right">Terms</div><div className="text-right">Net this month</div><div>Portal</div>
            </div>
            {loading && rows.length === 0 ? <TableSkeleton rows={6} cols={5} /> : rows.map(o => (
              <div key={o.id} role="button" tabIndex={0} onClick={() => openProfile(o.id)} onKeyDown={e => { if (e.key === 'Enter') openProfile(o.id); }}
                className={cx(COLS, 'grid gap-[14px] items-center min-h-[54px] py-[9px] px-[22px] [border-bottom:1px_solid_var(--color-line-soft)] cursor-pointer')}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-[30px] h-[30px] flex-none rounded-[999px] bg-black text-gold grid place-items-center text-[11px] font-semibold">
                    {o.displayName.split(' ').map(n => n[0]).slice(0, 2).join('')}
                  </span>
                  <div className="flex flex-col gap-px min-w-0">
                    <span className="text-[13.5px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">{o.displayName}</span>
                    <span className="text-[11.5px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{o.email}</span>
                  </div>
                </div>
                <span className="text-[12.5px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">
                  {o.units.length === 0 ? 'No units yet' : o.units.length === 1 ? o.units[0].unitLabel : `${o.units.length} units`}
                </span>
                <span className="text-[12.5px] text-right text-muted-ink">{ownerTerms(o)}</span>
                <span className="text-[13px] text-right font-medium">{rm(netOf(o), { cents: false })}</span>
                <div className="flex items-center justify-between gap-2">
                  {o.portalInvited ? <Badge tone="success" label="Active" /> : <Badge tone="neutral" label="Not invited" />}
                  <Icon name="ChevronRight" size="sm" color="var(--color-muted-ink)" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {modal && <AddOwnerModal onClose={() => setModal(false)} onSubmit={addOwner} />}
    </>
  );
}
