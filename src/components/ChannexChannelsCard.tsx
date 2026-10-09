import { useState } from 'react';
import { X } from 'lucide-react';
import { Card } from './Card';
import { Button } from './Button';
import { Badge } from './Badge';
import { Drawer } from './Dialog';
import { Field } from './Field';
import AirbnbListingPicker from './AirbnbListingPicker';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { useToast } from './Toast';
import { date } from '../lib/format';
import { cx } from '../lib/design-tokens';

type Ota = 'airbnb' | 'booking_com' | 'agoda';
const OTA_LABEL: Record<Ota, string> = { airbnb: 'Airbnb', booking_com: 'Booking.com', agoda: 'Agoda' };
interface Connection { id: string; ota: Ota; externalId: string; room: string | null; rate: string | null; title: string | null; connectedAt: string }
interface Room { id: string; title: string; rates: { id: string; title: string; maxPersons: number | null; pricing: string; readonly: boolean }[] }

/** A unit's link to Channex: set it up as a Channex listing, then connect Airbnb, Booking.com and Agoda
 *  from here through Channex's Channel API. */
export default function ChannexChannelsCard({ unitId, linked, canManage, onChanged }: {
  unitId: string; linked: boolean; canManage: boolean; onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [connecting, setConnecting] = useState<null | 'booking_com' | 'agoda' | { airbnbChannelId: string }>(null);
  const conns = useApi<{ data: Connection[] }>(linked ? `/units/${unitId}/channels` : null);
  const connected = conns.data?.data ?? [];
  const has = (o: Ota) => connected.some(c => c.ota === o);

  async function setUp() {
    setBusy(true);
    try {
      const r = await api.post<{ availabilitySent: boolean }>(`/units/${unitId}/channex-setup`, {});
      setConfirming(false);
      toast(r.availabilitySent
        ? { tone: 'success', title: 'Set up in Channex.', body: 'The listing exists with its open dates and prices. Next, connect a channel.' }
        : { tone: 'warning', title: 'Set up in Channex, dates not sent yet.', body: 'The listing exists, but the open dates did not go through yet. They are retried automatically.' });
      onChanged();
    } catch (e) { notifyFailure(e); } finally { setBusy(false); }
  }

  async function connectAirbnb() {
    setBusy(true);
    try {
      const r = await api.post<{ url?: string; channelId?: string }>(`/units/${unitId}/channels/airbnb-link`, {});
      if (r.channelId) setConnecting({ airbnbChannelId: r.channelId });
      else if (r.url) window.location.href = r.url;
    } catch (e) { notifyFailure(e); } finally { setBusy(false); }
  }

  async function disconnect(c: Connection) {
    if (!window.confirm(`Disconnect ${OTA_LABEL[c.ota]} from this unit? Bookings already received stay in Conts.`)) return;
    try {
      await api.del(`/units/${unitId}/channels/${c.id}`);
      toast({ tone: 'success', title: `${OTA_LABEL[c.ota]} disconnected.`, body: 'Prices and availability no longer sync to it for this unit.' });
      conns.reload();
    } catch (e) { notifyFailure(e); }
  }

  const done = (ota: Ota) => {
    setConnecting(null);
    toast({ tone: 'success', title: `${OTA_LABEL[ota]} connected.`, body: 'Prices and open dates now sync to it, and its existing bookings are being brought in.' });
    conns.reload();
  };

  return (
    <Card>
      <div className="pt-[18px] px-[22px] pb-[14px] flex items-center justify-between gap-3">
        <span className="text-title font-semibold">Channels</span>
        <Badge tone={linked ? 'success' : 'neutral'} label={linked ? 'In Channex' : 'Not in Channex'} />
      </div>
      <div className="px-[22px] pb-[18px] flex flex-col gap-3 text-[13px] text-muted-ink">
        {linked ? (
          <>
            {connected.length === 0
              ? <span>In Channex, but not connected to any booking site yet.</span>
              : connected.map(c => (
                <div key={c.id} className="flex items-center justify-between gap-3 py-2 [border-top:1px_solid_var(--color-line-soft)]">
                  <span className="flex flex-col gap-0.5">
                    <span className="text-copy font-semibold text-ink">{OTA_LABEL[c.ota]}</span>
                    <span className="text-[12px]">{c.ota === 'airbnb' ? c.title : [c.title, c.room, c.rate].filter(Boolean).join(' · ')} · since {date(c.connectedAt)}</span>
                  </span>
                  {canManage && <button onClick={() => void disconnect(c)} className="bg-transparent border-none cursor-pointer text-[12px] text-muted-ink hover:text-ink">Disconnect</button>}
                </div>
              ))}
            {canManage && (
              <div className="flex gap-2 flex-wrap">
                {!has('airbnb') && <Button size="sm" variant="secondary" loading={busy} onClick={() => void connectAirbnb()}>Connect Airbnb</Button>}
                {!has('booking_com') && <Button size="sm" variant="secondary" onClick={() => setConnecting('booking_com')}>Connect Booking.com</Button>}
                {!has('agoda') && <Button size="sm" variant="secondary" onClick={() => setConnecting('agoda')}>Connect Agoda</Button>}
              </div>
            )}
          </>
        ) : confirming ? (
          <>
            <span className="text-ink">This creates the unit as a listing in Channex (billed as a vacation rental), sends its open dates and prices, and then lets you connect booking sites.</span>
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

      <Drawer open={!!connecting} onClose={() => setConnecting(null)} width={560}>
        <div className="flex items-center justify-between px-6 pt-[18px] pb-3">
          <h2 className="m-0 text-title font-semibold">Connect {connecting === 'booking_com' ? 'Booking.com' : connecting === 'agoda' ? 'Agoda' : 'Airbnb'}</h2>
          <button onClick={() => setConnecting(null)} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button>
        </div>
        <div className="px-6 pb-6 overflow-y-auto grow">
          {(connecting === 'booking_com' || connecting === 'agoda') && <HotelConnect unitId={unitId} ota={connecting} onDone={() => done(connecting)} onCancel={() => setConnecting(null)} />}
          {connecting && typeof connecting === 'object' && <AirbnbListingPicker unitId={unitId} channelId={connecting.airbnbChannelId} onDone={() => done('airbnb')} onCancel={() => setConnecting(null)} />}
        </div>
      </Drawer>
    </Card>
  );
}

/** Booking.com / Agoda: enter the Hotel ID, pick the room and rate this unit is sold as, connect. */
function HotelConnect({ unitId, ota, onDone, onCancel }: { unitId: string; ota: 'booking_com' | 'agoda'; onDone: () => void; onCancel: () => void }) {
  const [hotelId, setHotelId] = useState('');
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [pricingType, setPricingType] = useState('Standard');
  const [pick, setPick] = useState<{ room: Room; rate: Room['rates'][number] } | null>(null);
  const [busy, setBusy] = useState(false);
  const label = OTA_LABEL[ota];

  async function lookup() {
    setBusy(true); setRooms(null); setPick(null);
    try {
      const r = await api.post<{ pricingType: string; rooms: Room[] }>(`/units/${unitId}/channels/lookup`, { ota, hotelId: hotelId.trim() });
      setRooms(r.rooms); setPricingType(r.pricingType);
    } catch (e) { notifyFailure(e); } finally { setBusy(false); }
  }

  async function connect() {
    if (!pick) return;
    setBusy(true);
    try {
      await api.post(`/units/${unitId}/channels`, {
        ota, hotelId: hotelId.trim(), roomId: pick.room.id, roomTitle: pick.room.title, rateId: pick.rate.id, rateTitle: pick.rate.title,
        occupancy: pick.rate.maxPersons ?? undefined, pricingType: pick.rate.pricing || pricingType, readonly: pick.rate.readonly,
      });
      onDone();
    } catch (e) { notifyFailure(e); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-4">
      <span className="text-[13px] text-muted-ink">In the {label} extranet, choose Channex as your channel manager first. Then enter the property's {label} Hotel ID here.</span>
      <div className="flex items-end gap-2.5">
        <div className="grow"><Field label={`${label} Hotel ID`} inputMode="numeric" value={hotelId} onChange={e => setHotelId(e.target.value.replace(/\D/g, ''))} placeholder="e.g. 5868189" /></div>
        <Button size="sm" variant="secondary" loading={busy && !rooms} disabled={hotelId.length < 3} disabledReason="Enter the Hotel ID" onClick={() => void lookup()}>Find rooms</Button>
      </div>
      {rooms && (rooms.length === 0
        ? <span className="text-[13px]">{label} returned no rooms for this Hotel ID.</span>
        : (
          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-medium text-muted-ink">Pick the room and rate this unit is sold as</span>
            {rooms.flatMap(room => room.rates.map(rate => {
              const on = pick?.room.id === room.id && pick.rate.id === rate.id;
              return (
                <label key={`${room.id}-${rate.id}`} className={cx('flex items-start gap-3 p-3 border border-solid rounded-card cursor-pointer', on ? 'border-gold bg-gold-tint' : 'border-line')}>
                  <input type="radio" name="hotel-rate" checked={on} onChange={() => setPick({ room, rate })} className="mt-1" />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-copy font-semibold">{room.title}</span>
                    <span className="text-[12px] text-muted-ink">{rate.title}{rate.maxPersons ? ` · up to ${rate.maxPersons} guests` : ''}</span>
                  </span>
                </label>
              );
            }))}
          </div>
        ))}
      <div className="flex justify-end gap-2.5">
        <Button size="sm" variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!pick} disabledReason="Find the rooms and pick one" loading={busy && !!rooms} onClick={() => void connect()}>Connect {label}</Button>
      </div>
    </div>
  );
}
