import { useNavigate } from 'react-router-dom';
import { EmptyState } from '../components/States';
import { usePortalText } from '../lib/portalI18n';

/** A Renovation employee's portal (migration 0316): nothing is built for them yet, so it says so and points to Settings. */
export default function FieldRenovationHome() {
  const t = usePortalText();
  const navigate = useNavigate();
  return (
    <EmptyState icon="Hammer" title={t.renovation.title} body={t.renovation.body}
      action={{ label: t.nav.settings, onClick: () => navigate('/account') }} forceAction />
  );
}
