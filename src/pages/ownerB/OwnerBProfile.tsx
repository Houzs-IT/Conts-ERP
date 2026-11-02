import { Link, useNavigate, useParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';
import { MoneyText } from '../../components/MoneyText';
import { EmptyState } from '../../components/States';
import { RowsSkeleton } from '../../components/Loading';
import { RecordHistory } from '../../components/RecordHistory';
import { PhoneText } from '../../components/PhoneText';
import { useApi } from '../../lib/useApi';
import { useSession } from '../../lib/session';
import { areaOpen } from '../../lib/navigation';
import { titleCase, monthLabel, todayMyt, plural } from '../../lib/format';
import { type Payload, netOf, terms } from '../owners/shared';
import { portalBadge } from '../owners/portalAccess';

/** Owner B's owner profile: who the owner is, their units and this month's payout estimate, View as owner, and the
 *  owner's History (each View as owner is recorded there). Editing stays on Owners (A) while B is a Beta. */
export default function OwnerBProfile() {
  const { id = '' } = useParams();
  const ownerId = decodeURIComponent(id);
  const navigate = useNavigate();
  const { user } = useSession();
  const money = !!user && areaOpen(user.role, 'finance', user.access);
  const { data, loading, error } = useApi<Payload>(`/owners?id=${encodeURIComponent(ownerId)}`);
  const o = data?.data?.[0];
  const back = { label: 'Owner B', onClick: () => navigate('/owner-b') };

  if (!o) {
    return (
      <>
        <PageHeader title="Owner" back={back} />
        {loading || !data ? (error ? <EmptyState icon="UserX" title="Owner not found" body={error} /> : <RowsSkeleton rows={4} cols={3} />)
          : <EmptyState icon="UserX" title="Owner not found" body="This owner is no longer on file." action={{ label: 'Back to Owner B', onClick: () => navigate('/owner-b') }} />}
      </>
    );
  }
  const badge = portalBadge(o);
  const month = todayMyt().slice(0, 7);

  return (
    <>
      <PageHeader title={titleCase(o.displayName)} back={back}
        badge={<StatusBadge tone={badge.tone} label={badge.label} />}
        sub={o.units.length ? plural(o.units.length, 'unit') : 'No units yet'}
        primary={money && o.units.length > 0 ? (
          <Button size="sm" variant="primary" icon={<Icon name="Eye" size="sm" />} onClick={() => navigate(`/owner-b/${encodeURIComponent(o.id)}/portal`)}>View as owner</Button>
        ) : undefined}
        actions={<Link to={`/owners/${encodeURIComponent(o.id)}`} className="text-copy text-gold-ink">Edit on Owners</Link>} />

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr))]">
        <section className="bg-card border border-solid border-line rounded-card p-5 flex flex-col gap-2 min-w-0">
          <span className="text-[16px] font-semibold tracking-[-0.01em]">Contact</span>
          <span className="text-copy [overflow-wrap:anywhere]">{o.email || 'No email'}</span>
          {o.phone ? <PhoneText value={o.phone} /> : <span className="text-copy text-muted-ink">No phone</span>}
          {badge.hint && <span className="text-meta text-muted-ink">{badge.hint}</span>}
        </section>
        {money && (
          <section className="relative bg-black text-white rounded-card p-5 flex flex-col gap-2 overflow-hidden min-w-0">
            <span aria-hidden className="absolute left-5 top-0 h-[2px] w-8 bg-gold" />
            <span className="text-[11px] font-semibold tracking-[0.12em] uppercase text-gold">Net Payout to Owner · {monthLabel(month)} (estimate)</span>
            <MoneyText sen={netOf(o)} mode="exact" className="text-[30px] leading-none font-semibold text-gold" />
            <span className="text-meta text-on-dark">Final once the month's owner statement is marked final.</span>
          </section>
        )}
      </div>

      <section className="bg-card border border-solid border-line rounded-card overflow-hidden">
        <div className="px-5 py-[18px] text-[16px] font-semibold tracking-[-0.01em] [border-bottom:1px_solid_var(--color-line-soft)]">Units</div>
        {o.units.length === 0 && <EmptyState bare icon="Building2" title="No units yet" body="Link a unit on Owners to start the owner's statements." />}
        {o.units.map(u => (
          <div key={u.unitId} className="px-5 py-3 [border-bottom:1px_solid_var(--color-line-soft)] last:border-b-0 flex items-center gap-3">
            <span className="flex flex-col gap-px min-w-0 flex-1">
              <Link to={`/properties/units/${encodeURIComponent(u.unitId)}`} className="text-copy font-medium text-ink truncate">{u.unitLabel}</Link>
              <span className="text-meta text-muted-ink truncate">{terms(u)}</span>
            </span>
            {money && <MoneyText sen={u.net} mode="exact" tone="auto" className="text-copy shrink-0" />}
          </div>
        ))}
      </section>

      <RecordHistory entity="owners" id={o.id} refreshKey={data} />
    </>
  );
}
