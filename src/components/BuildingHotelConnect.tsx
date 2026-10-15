import { useState } from 'react';
import { Button } from './Button';
import { Field } from './Field';
import { Select } from './Select';
import { api, notifyFailure } from '../lib/api';

type HotelOta = 'booking_com' | 'agoda';
const LABEL: Record<HotelOta, string> = { booking_com: 'Booking.com', agoda: 'Agoda' };
interface Room { id: string; title: string; rates: { id: string; title: string; maxPersons: number | null; pricing: string; readonly: boolean }[] }
export interface BuildingChannelUnit { id: string; unitNumber: string; title: string; setUp: boolean; ownListing: boolean; connections: { ota: string; hotelId: string; room: string | null }[] }

/** Booking.com / Agoda sell a building as one hotel whose rooms are the units. Enter the Hotel ID, say which unit each
 *  room is, connect: every paired unit is connected in one go (functions/api/properties/[id]/channels). Running it
 *  again for the same hotel adds rooms left out the first time. */
export default function BuildingHotelConnect({ buildingId, buildingName, ota, units, currentUnitId, onDone, onCancel }: {
  buildingId: string; buildingName: string; ota: HotelOta; units: BuildingChannelUnit[]; currentUnitId: string; onDone: (connected: number) => void; onCancel: () => void;
}) {
  const [hotelId, setHotelId] = useState(units.flatMap(u => u.connections).find(c => c.ota === ota)?.hotelId ?? '');
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [pricingType, setPricingType] = useState('Standard');
  const [pairs, setPairs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const label = LABEL[ota];
  const free = units.filter(u => u.setUp && !u.connections.some(c => c.ota === ota));
  const waiting = units.filter(u => !u.setUp);
  const chosen = Object.entries(pairs).filter(([, unitId]) => unitId);

  async function lookup() {
    setBusy(true); setRooms(null); setPairs({});
    try {
      const r = await api.post<{ pricingType: string; rooms: Room[] }>(`/properties/${buildingId}/channels/lookup`, { ota, hotelId: hotelId.trim() });
      setRooms(r.rooms); setPricingType(r.pricingType);
    } catch (e) { notifyFailure(e); } finally { setBusy(false); }
  }

  async function connect() {
    if (!rooms) return;
    setBusy(true);
    try {
      const picked = chosen.map(([key, unitId]) => {
        const [roomId, rateId] = key.split('/');
        const room = rooms.find(r => r.id === roomId)!, rate = room.rates.find(x => x.id === rateId)!;
        return { unitId, roomId, roomTitle: room.title, rateId, rateTitle: rate.title, occupancy: rate.maxPersons ?? undefined };
      });
      const r = await api.post<{ connected: number }>(`/properties/${buildingId}/channels`, { ota, hotelId: hotelId.trim(), pricingType, rooms: picked });
      onDone(r.connected);
    } catch (e) { notifyFailure(e); } finally { setBusy(false); }
  }

  const rows = (rooms ?? []).flatMap(room => room.rates.map(rate => ({ key: `${room.id}/${rate.id}`, room, rate })));
  return (
    <div className="flex flex-col gap-4">
      {/* vocab-ok: Booking.com and Agoda call what a unit is sold as a room on this linking screen */}
      <span className="text-[13px] text-muted-ink">{label} sells {buildingName} as one hotel, with each unit as one of its rooms. In the {label} extranet, choose Channex as the channel manager first, then enter the Hotel ID and say which unit each room is.</span>
      <div className="flex items-end gap-2.5">
        <div className="grow"><Field label={`${label} Hotel ID`} inputMode="numeric" value={hotelId} onChange={e => setHotelId(e.target.value.replace(/\D/g, ''))} placeholder="e.g. 10771122" /></div>
        <Button /* vocab-ok: Booking.com and Agoda call what a unit is sold as a room on this linking screen */ size="sm" variant="secondary" loading={busy && !rooms} disabled={hotelId.length < 3} disabledReason="Enter the Hotel ID" onClick={() => void lookup()}>Find rooms</Button>
      </div>
      {waiting.length > 0 && (
        <span className="text-[12px] text-muted-ink">
          Not in Channex yet, so not listed below: {waiting.map(u => u.unitNumber).join(', ')}. Set each up from its own Channels card first
          {waiting.some(u => u.ownListing) ? ' (a unit set up before building listings has a listing of its own and cannot share this hotel yet)' : ''}.
        </span>
      )}
      {rooms && (rows.length === 0
        // vocab-ok: Booking.com and Agoda call what a unit is sold as a room on this linking screen
        ? <span className="text-[13px]">{label} returned no rooms for this Hotel ID.</span>
        : (
          <div className="flex flex-col gap-2">
            {/* vocab-ok: Booking.com and Agoda call what a unit is sold as a room on this linking screen */}
            <span className="text-[12px] font-medium text-muted-ink">Which unit is each room? Leave a room on "Not this building's" to skip it.</span>
            {rows.map(({ key, room, rate }) => {
              const taken = new Set(Object.entries(pairs).filter(([k, v]) => k !== key && v).map(([, v]) => v));
              return (
                <div key={key} className="flex items-center gap-3 p-3 border border-solid border-line rounded-card">
                  <span className="flex flex-col gap-0.5 grow min-w-0">
                    <span className="text-copy font-semibold">{room.title}</span>
                    <span className="text-[12px] text-muted-ink">{rate.title}{rate.maxPersons ? ` · up to ${rate.maxPersons} ${rate.maxPersons === 1 ? 'guest' : 'guests'}` : ''}</span>
                  </span>
                  {/* vocab-ok: room.title is the Booking.com / Agoda room's own name, read out for screen readers */}
                  <Select className="w-[45%] shrink-0" label={`Unit for ${room.title}, ${rate.title}`} value={pairs[key] ?? ''} placeholder="Not this building's"
                    onChange={v => setPairs(p => ({ ...p, [key]: v }))}
                    options={free.map(u => ({ value: u.id, label: `${u.unitNumber}${u.id === currentUnitId ? ' (this unit)' : ''}`, disabled: taken.has(u.id) }))} />
                </div>
              );
            })}
          </div>
        ))}
      <div className="flex justify-end gap-2.5">
        <Button size="sm" variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button /* vocab-ok: Booking.com and Agoda call what a unit is sold as a room on this linking screen */ size="sm" variant="primary" disabled={!chosen.length} disabledReason="Find the rooms and pick a unit for at least one" loading={busy && !!rooms} onClick={() => void connect()}>
          {chosen.length ? `Connect ${chosen.length} ${chosen.length === 1 ? 'unit' : 'units'} to ${label}` : `Connect ${label}`}
        </Button>
      </div>
    </div>
  );
}
