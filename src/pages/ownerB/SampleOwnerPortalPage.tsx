import { useNavigate, useParams } from 'react-router-dom';
import OwnerPortalPage from '../OwnerPortalPage';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { EmptyState } from '../../components/States';
import { DEMO_BG } from '../../components/DemoMode';
import { useApi } from '../../lib/useApi';
import { useSession } from '../../lib/session';

/** Owner portal (sample) for one sample owner: the real owner portal screens fed from Demo mode
 *  (/api/demo/portal), under a band that says it is sample data. Replaced the Owner Showcase (owner, 2 Nov 2026). */
export default function SampleOwnerPortalPage() {
  const { id = '' } = useParams();
  const ownerId = decodeURIComponent(id);
  const navigate = useNavigate();
  const { user } = useSession();
  const allowed = !!user?.demo?.allowed;
  const { data, error } = useApi<{ data: { id: string; name: string }[] }>(allowed ? '/demo/owners' : null);
  const owner = data?.data.find(o => o.id === ownerId);
  const back = () => navigate('/owner-b?view=sample');

  if (!allowed) return <EmptyState icon="Lock" title="For management and sales staff" body="The sample owner portal uses Demo mode." action={{ label: 'Back to Owner B', onClick: () => navigate('/owner-b') }} />;
  if (!owner) {
    return data || error
      ? <EmptyState icon="UserX" title="Sample owner not found" body={error ?? 'It may have been removed or cleared with Clear demo.'} action={{ label: 'Back to the sample owners', onClick: back }} />
      : <div className="p-6 text-copy text-muted-ink">Opening the sample portal…</div>;
  }
  return (
    <div className="flex flex-col gap-5">
      <div role="status" data-sample-mark className="md:sticky md:top-0 md:z-10 flex items-center gap-3 flex-wrap rounded-card px-4 py-3 text-white" style={{ background: DEMO_BG }}>
        <Icon name="FlaskConical" size="sm" />
        <span className="flex flex-col gap-px min-w-0 flex-1">
          <span className="text-copy font-semibold [overflow-wrap:anywhere]">Sample data · {owner.name}'s owner portal</span>
          <span className="text-meta">The owner portal as an owner sees it, filled with sample data from Demo mode. Read-only.</span>
        </span>
        <Button size="sm" variant="secondary" icon={<Icon name="X" size="sm" />} onClick={back}>Exit</Button>
      </div>
      <OwnerPortalPage source={{ kind: 'sample', ownerId: owner.id, ownerName: owner.name }} />
    </div>
  );
}
