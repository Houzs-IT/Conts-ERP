import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import AirbnbListingPicker from '../components/AirbnbListingPicker';
import { useToast } from '../components/Toast';

/** Where Airbnb's sign-in (through Channex) sends the browser back: ?success=true&channel_id=…&token=<unit id>.
 *  Picks up by listing the account's listings for that unit. */
export default function AirbnbReturnPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const ok = params.get('success') === 'true';
  const channelId = params.get('channel_id') ?? '';
  const unitId = params.get('token') ?? '';
  const backToUnit = () => navigate(unitId ? `/properties/units/${encodeURIComponent(unitId)}` : '/properties/units');

  return (
    <>
      <PageHeader title="Connect Airbnb" sub={ok ? 'Airbnb is authorised. Pick the listing for this unit.' : 'Airbnb was not connected.'} />
      <Card>
        <div className="p-6 max-w-[640px]">
          {ok && channelId && unitId
            ? <AirbnbListingPicker unitId={unitId} channelId={channelId}
                onDone={() => { toast({ tone: 'success', title: 'Airbnb connected.', body: 'Prices and available dates now go to Airbnb, and its existing reservations are being brought in.' }); backToUnit(); }}
                onCancel={backToUnit} />
            : (
              <div className="flex flex-col gap-3 text-[13.5px]">
                <span>The Airbnb sign-in was cancelled or did not complete, so nothing was connected. You can try again from the unit's Channels card.</span>
                <div><Button size="sm" variant="secondary" onClick={backToUnit}>Back to the unit</Button></div>
              </div>
            )}
        </div>
      </Card>
    </>
  );
}
