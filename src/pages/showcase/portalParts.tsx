import { useEffect, useRef, useState } from 'react';
import { dateShort, todayMyt } from '../../lib/format';
import { type CalendarData, type Listing } from './model';
import { stayStatus, UNITS, type SampleStay, type SampleCase, type ChatMessage } from './sampleOwner';

/** "22 Oct, 09:12" from a sample timestamp. */
export const at = (stamp: string) => `${dateShort(stamp.slice(0, 10))}, ${stamp.slice(11, 16)}`;
export const toListing = (u: typeof UNITS[number]): Listing => ({
  id: u.id, name: u.name, unit: u.unit, city: 'Kuala Lumpur', photoId: null, rating: u.rating, reviews: u.reviews,
  bedrooms: u.unit.startsWith('Skyline') ? 1 : 2, bathrooms: u.unit.startsWith('Skyline') ? 1 : 2, maxGuests: u.unit.startsWith('Skyline') ? 2 : 6, airbnbId: null,
});
export const toCalendar = (stays: SampleStay[], today: string): CalendarData => ({
  from: today, days: 0, today, dates: [], rates: {},
  stays: stays.map(s => ({ id: s.id, code: s.code, unitId: s.unitId, guest: s.guest, checkIn: s.checkIn, checkOut: s.checkOut, guests: s.guests, status: stayStatus(s, today), total: s.total })),
});
export function useChat(initial: ChatMessage[]) {
  const [chat, setChat] = useState(initial);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const send = (text: string) => {
    const t = text.trim();
    if (!t) return;
    const now = `${todayMyt()}T${new Date().toTimeString().slice(0, 5)}`;
    setChat(c => [...c, { me: true, text: t, at: now }]);
    timer.current = window.setTimeout(() => setChat(c => [...c, { me: false, text: 'Got it, thanks. I will check and reply here shortly.', at: now }]), 1200);
  };
  return { chat, send };
}

export function CaseTrail({ c, small }: { c: SampleCase; small?: boolean }) {
  return (
    <>
      {c.trail.map((t, i) => {
        const last = i === c.trail.length - 1;
        return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: `${small ? 18 : 24}px minmax(0, 1fr)`, gap: small ? 10 : 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ width: small ? 10 : 12, height: small ? 10 : 12, borderRadius: '50%', marginTop: 4, flexShrink: 0, background: last ? (c.done ? 'var(--sc-success)' : 'var(--sc-star)') : 'var(--sc-teal)' }} />
              <span style={{ flex: 1, width: 2, background: 'var(--sc-line)', visibility: last ? 'hidden' : 'visible' }} />
            </div>
            <div style={{ paddingBottom: small ? 14 : 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><div style={{ fontSize: small ? 13 : 14, fontWeight: 800 }}>{t.title}</div><div className="num" style={{ fontSize: small ? 11 : 12, color: 'var(--sc-muted)', whiteSpace: 'nowrap' }}>{at(t.at)}</div></div>
              <div style={{ fontSize: small ? 12 : 13, color: 'var(--sc-ink-2)', marginTop: 3, lineHeight: 1.5 }}>{t.note}</div>
              <div style={{ fontSize: small ? 11 : 12, color: 'var(--sc-faint)', marginTop: 3 }}>{t.by}</div>
            </div>
          </div>
        );
      })}
    </>
  );
}

