import { Navigate } from 'react-router-dom';

/** Sample owners for sales demos were removed (owner, 12 Nov 2026): the company showcase is the demo, with its one
 *  fixed sample owner (src/pages/showcase/sampleOwner.ts). An old link to a sample owner's portal opens the showcase's
 *  Owner view instead, never a real owner. */
export default function SampleOwnerPortalPage() {
  return <Navigate to="/performance/showcase/owner" replace />;
}
