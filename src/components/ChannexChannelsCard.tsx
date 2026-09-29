import { useState } from 'react';
import { X, ExternalLink } from 'lucide-react';
import { Card } from './Card';
import { Button } from './Button';
import { Badge } from './Badge';
import { Drawer } from './Dialog';
import { api, notifyFailure } from '../lib/api';
import { useToast } from './Toast';

/** A unit's link to Channex: set it up as a Channex listing, then open Channex's own channel screen
 *  (inside Conts) to connect Airbnb, Booking.com or Agoda with the OTA's sign-in. */
export default function ChannexChannelsCard({ unitId, linked, canManage, onChanged }: {
  unitId: string; linked: boolean; canManage: boolean; onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [screenUrl, setScreenUrl] = useState<string | null>(null);

  async function setUp() {
    setBusy(true);
    try {
      const r = await api.post<{ availabilitySent: boolean }>(`/units/${unitId}/channex-setup`, {});
      setConfirming(false);
      toast(r.availabilitySent
        ? { tone: 'success', title: 'Set up in Channex.', body: 'The listing exists with a year of open dates and the base price. Next, connect a channel.' }
        : { tone: 'warning', title: 'Set up in Channex, dates not sent yet.', body: 'The listing exists, but the open dates did not go through. They are sent again on the next booking or price change.' });
      onChanged();
    } catch (e) { notifyFailure(e); } finally { setBusy(false); }
  }

  async function openChannels() {
    setBusy(true);
    try {
      const r = await api.post<{ url: string }>(`/units/${unitId}/channex-connect`, {});
      setScreenUrl(r.url);
    } catch (e) { notifyFailure(e); } finally { setBusy(false); }
  }

  return (
    <Card>
      <div className="pt-[18px] px-[22px] pb-[14px] flex items-center justify-between gap-3">
        <span className="text-[18px] font-semibold">Channels</span>
        <Badge tone={linked ? 'success' : 'neutral'} label={linked ? 'In Channex' : 'Not in Channex'} />
      </div>
      <div className="px-[22px] pb-[18px] flex flex-col gap-3 text-[13px] text-muted-ink">
        {linked ? (
          <>
            <span>Bookings, prices and open dates sync with Channex. Connect or check Airbnb, Booking.com and Agoda for this unit in Channex's channel screen.</span>
            {canManage && <div><Button size="sm" variant="primary" loading={busy} onClick={() => void openChannels()}>Connect channels</Button></div>}
          </>
        ) : confirming ? (
          <>
            <span className="text-ink">This creates the unit as a listing in Channex (billed as a vacation rental), opens the next 12 months except nights already booked, and sets the base price. Channels are connected in the next step.</span>
            <div className="flex gap-2.5">
              <Button size="sm" variant="primary" loading={busy} onClick={() => void setUp()}>Set up now</Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
            </div>
          </>
        ) : (
          <>
            <span>Not linked to Channex, so Airbnb, Booking.com and Agoda do not sync for this unit.</span>
            {canManage && <div><Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>Set up in Channex</Button></div>}
          </>
        )}
      </div>

      <Drawer open={!!screenUrl} onClose={() => { setScreenUrl(null); onChanged(); }} width={980}>
        <div className="flex items-center justify-between px-6 pt-[18px] pb-3 gap-3">
          <h2 className="m-0 text-[18px] font-semibold">Connect channels</h2>
          <div className="flex items-center gap-2">
            {screenUrl && <a href={screenUrl} target="_blank" rel="noreferrer" className="text-[12.5px] inline-flex items-center gap-1 text-muted-ink">Open in a new tab <ExternalLink size={13} /></a>}
            <button onClick={() => { setScreenUrl(null); onChanged(); }} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button>
          </div>
        </div>
        {screenUrl && <iframe title="Channex channels" src={screenUrl} className="grow w-full border-0 min-h-[70vh]" />}
      </Drawer>
    </Card>
  );
}
