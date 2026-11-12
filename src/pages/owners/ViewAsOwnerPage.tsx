import { useNavigate, useParams } from 'react-router-dom';
import OwnerPortalPage from '../OwnerPortalPage';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { EmptyState } from '../../components/States';
import { useApi } from '../../lib/useApi';
import { useSession } from '../../lib/session';
import { titleCase } from '../../lib/format';
import type { Payload } from './shared';
import { mayViewAsOwner } from './portalAccess';

/** View as owner (`/owners/:id/portal`): this owner's real owner portal, read-only, under a band that names them. It
 *  moved from Owner B to the owner profile (owner, 12 Nov 2026) and is for Management and Finance only. The portal's
 *  own reads carry ?ownerId= (functions/_lib/ownerScope.ts) and record the view on the owner's History. */
export default function ViewAsOwnerPage() {
  const { id = '' } = useParams();
  const ownerId = decodeURIComponent(id);
  const navigate = useNavigate();
  const { user } = useSession();
  const allowed = mayViewAsOwner(user);
  const { data, error } = useApi<Payload>(allowed ? `/owners?id=${encodeURIComponent(ownerId)}` : null);
  const owner = data?.data?.[0];
  const profile = `/owners/${encodeURIComponent(ownerId)}`;
  const exit = () => navigate(profile);

  if (!allowed) {
    return <EmptyState icon="Lock" title="Not available" body="Viewing an owner's portal is for Management and Finance." action={{ label: 'Back to the owner', onClick: exit }} />;
  }
  if (!owner) {
    return data || error
      ? <EmptyState icon="UserX" title="Owner not found" body={error ?? 'This owner is no longer on file.'} action={{ label: 'Back to owners', onClick: () => navigate('/owners') }} />
      : <div className="p-6 text-copy text-muted-ink">Opening the owner portal…</div>;
  }
  const name = titleCase(owner.displayName);

  return (
    <div className="flex flex-col gap-5">
      {/* Dark in both themes, so it keeps a border on the near-black dark page. */}
      <div role="status" className="dash-hero md:sticky md:top-0 md:z-10 flex items-center gap-3 flex-wrap rounded-card bg-black text-white px-4 py-3">
        <Icon name="Eye" size="sm" color="var(--color-gold)" />
        <span className="flex flex-col gap-px min-w-0 flex-1">
          <span className="text-copy font-semibold [overflow-wrap:anywhere]">Viewing as {name}</span>
          <span className="text-meta text-[var(--color-text-on-dark-muted)]">Read-only. This is their owner portal exactly as they see it. This view is recorded in the owner's History.</span>
        </span>
        <Button size="sm" variant="secondary" icon={<Icon name="X" size="sm" />} onClick={exit}>Exit</Button>
      </div>
      <OwnerPortalPage source={{ kind: 'viewAs', ownerId: owner.id, ownerName: name }} />
    </div>
  );
}
