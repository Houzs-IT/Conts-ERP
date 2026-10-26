import { addDays, daysBetween } from './model';

/** The owner portal the Owner Showcase demonstrates to a prospective owner (CONTS-0006 part 2): one fixed sample
 *  owner, Tan Wei Ming, with three units. Every figure here is an example, made up and generated around today so the
 *  demo never looks out of date; no real owner's money, units or guests are ever read (Samuel, 26 Oct 2026).
 *  Money is in sen, like the rest of the app. */

const rng = (seed: number) => { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; };

export const OWNER = {
  name: 'Tan Wei Ming', first: 'Wei Ming', initials: 'TW', since: 'March 2024',
  profile: {
    name: 'Tan Wei Ming', email: 'weiming.tan@example.com', phone: '+60 12-338 4410', password: '••••••••••',
    bank: 'Maybank ···· 4821', address: '12 Jalan Ampang, 50450 Kuala Lumpur',
  } as Record<string, string>,
};
export const MANAGER = { name: 'Aina Rahman', initials: 'AR' };
/** Guaranteed return per month across the three units, in sen. */
export const GUARANTEE = 840000;

export interface SampleUnit { id: string; name: string; unit: string; base: number; rating: number; reviews: number; specs: string; roomId: string }
export const UNITS: SampleUnit[] = [
  { id: 'u0', name: 'Obsidian Sky Staycation #10mKLCC', unit: 'Trion B52-05', base: 21000, rating: 4.92, reviews: 204, specs: '6 guests · 2 bedrooms · 2 beds · 2 baths', roomId: '' },
  { id: 'u1', name: 'Heartthrob Skyline KLCC View', unit: 'Trion C20-08', base: 19000, rating: 4.87, reviews: 197, specs: '6 guests · 2 bedrooms · 2 beds · 2 baths', roomId: '' },
  { id: 'u2', name: 'Couple Nest KL #1 min to LRT Pudu', unit: 'Skyline B32-01', base: 15000, rating: 4.81, reviews: 193, specs: '2 guests · 1 bedroom · 1 bed · 1 bath', roomId: '' },
];

const GUESTS = ['Rohan K.', 'Kayla T.', 'Tom S.', 'Yuki S.', 'Hanan R.', 'Derrick O.', 'Nurul I.', 'Sooraj N.', 'Vivian L.', 'Wassim W.', 'Paul N.', 'Chee L.', 'Hamna K.', 'Lim A.', 'Jessica T.', 'Arthur S.', 'Mei Ling W.', 'Farid I.', 'Sakura L.', 'Daniel K.', 'Aisha R.'];
const COUNTRY = ['Malaysia', 'Singapore', 'Australia', 'Japan', 'India', 'UK', 'Indonesia'];

export interface SampleStay { id: string; unitId: string; guest: string; guests: number; checkIn: string; checkOut: string; total: number; code: string; tint: number; country: string }
export type StayStatus = 'completed' | 'in_stay' | 'confirmed';
export const stayStatus = (s: SampleStay, today: string): StayStatus => (s.checkOut <= today ? 'completed' : s.checkIn <= today ? 'in_stay' : 'confirmed');
export const STATUS_WORD: Record<StayStatus, string> = { completed: 'Completed', in_stay: 'In stay', confirmed: 'Confirmed' };

export interface SampleCase {
  id: string; unitId: string; title: string; cat: string; done: boolean; ttf: string; operator: string;
  trail: { title: string; at: string; note: string; by: string }[]; photos: string[];
}
export interface SampleStatement { month: string; nights: number; gross: number; costs: number; net: number; topup: number; payout: number; acc: number; processing: boolean }
export interface SampleReview { guest: string; from: string; to: string; unitId: string; text: string }
export interface ChatMessage { me: boolean; text: string; at: string }

/** YYYY-MM of the month `n` months from today's. */
export const monthShift = (today: string, n: number) => {
  const [y, m] = today.slice(0, 7).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** A local timestamp (YYYY-MM-DDTHH:MM) a number of days from today. */
const stamp = (today: string, offset: number, hm: string) => `${addDays(today, offset)}T${hm}`;

export function sampleOwner(today: string) {
  // Stays from the start of last month to the end of next month, so both calendar months are full.
  const start = `${monthShift(today, -1)}-01`, end = `${monthShift(today, 2)}-01`;
  const stays: SampleStay[] = [];
  UNITS.forEach((u, i) => {
    const r = rng(i * 131 + 7);
    let d = addDays(start, -Math.floor(r() * 3));
    while (d < end) {
      const n = 1 + Math.floor(r() * 5);
      stays.push({
        id: `${u.id}-${d}`, unitId: u.id, guest: GUESTS[Math.floor(r() * GUESTS.length)], guests: 1 + Math.floor(r() * 5),
        checkIn: d, checkOut: addDays(d, n), total: n * (u.base + Math.floor(r() * 5) * 1000),
        code: 'HM' + Math.floor(r() * 9e8).toString(36).toUpperCase().slice(0, 8), tint: Math.floor(r() * 6), country: COUNTRY[Math.floor(r() * 7)],
      });
      d = addDays(d, n + (r() < 0.3 ? 1 : 0));
    }
  });

  const reviewTexts: [string, number, string][] = [
    ['Nikita', 0, 'We loved our stay. The apartment was spotless, the view was stunning and check-in was effortless.'],
    ['Salim', 1, 'Easy access to the train, very clean, and everything we needed was already there.'],
    ['Mei Ling', 0, 'Exactly like the photos. The pool deck at sunset was the highlight of our trip.'],
    ['Farid', 2, 'Smooth self check-in, fresh linens and a quiet unit. Would book again without hesitation.'],
    ['Sakura', 1, 'Our family had plenty of space. The team even arranged an early check-in for us.'],
    ['Daniel', 2, 'Calm, minimal and very clean. Great value so close to the LRT.'],
    ['Aisha', 0, 'Amazing view of the towers at night. Instructions were clear and the unit was ready on time.'],
  ];
  const reviews: SampleReview[] = reviewTexts.map(([g, ui, text], k) => {
    const to = addDays(today, -2 - k * 3);
    return { guest: g, from: addDays(to, -(3 + (k % 2))), to, unitId: UNITS[ui].id, text };
  });

  const cases: SampleCase[] = [
    { id: 'SC-2302', unitId: 'u2', title: 'Replace broken kettle', cat: 'Amenities', done: false, ttf: '-', operator: 'Ops desk', photos: ['Before'], trail: [
      { title: 'Issue reported', at: stamp(today, -1, '08:15'), note: 'Guest reported kettle not switching on.', by: 'Guest · Airbnb inbox' },
      { title: 'Case opened', at: stamp(today, -1, '08:20'), note: 'Replacement kettle requested from store.', by: 'Nadia · Customer service' },
      { title: 'Operator dispatched', at: stamp(today, -1, '09:30'), note: 'Runner on the way with new kettle.', by: 'Ops desk' }] },
    { id: 'SC-2291', unitId: 'u0', title: 'Aircon not cooling in bedroom', cat: 'Maintenance', done: true, ttf: '3h 40m', operator: 'Hafiz (Technician)', photos: ['Before', 'Filter', 'After'], trail: [
      { title: 'Issue reported', at: stamp(today, -4, '09:12'), note: 'Guest messaged via Airbnb: bedroom aircon blowing warm air.', by: 'Guest · Airbnb inbox' },
      { title: 'Case opened', at: stamp(today, -4, '09:18'), note: 'Case created, guest offered a fan in the meantime.', by: 'Nadia · Customer service' },
      { title: 'Operator dispatched', at: stamp(today, -4, '10:05'), note: 'Technician assigned with gas top-up kit.', by: 'Ops desk' },
      { title: 'Operator on site', at: stamp(today, -4, '11:40'), note: 'Found low refrigerant and a clogged filter.', by: 'Hafiz · Technician' },
      { title: 'Fixed', at: stamp(today, -4, '12:52'), note: 'Gas topped up, filter cleaned, 18°C confirmed at vent.', by: 'Hafiz · Technician' },
      { title: 'Closed', at: stamp(today, -4, '14:10'), note: 'Guest confirmed room is cool. Case closed.', by: 'Nadia · Customer service' }] },
    { id: 'SC-2284', unitId: 'u1', title: 'Linen change between stays', cat: 'Housekeeping', done: true, ttf: '1h 55m', operator: 'Siti (Housekeeping)', photos: ['Bedroom', 'Bathroom', 'Linen tag'], trail: [
      { title: 'Scheduled turnover', at: stamp(today, -6, '11:00'), note: 'Checkout completed, turnover triggered automatically.', by: 'ERP · Reservations' },
      { title: 'Case opened', at: stamp(today, -6, '11:02'), note: 'Linen change and deep clean assigned.', by: 'Ops desk' },
      { title: 'Operator on site', at: stamp(today, -6, '11:35'), note: 'Housekeeping arrived with 2 fresh linen sets.', by: 'Siti · Housekeeping' },
      { title: 'Fixed', at: stamp(today, -6, '12:57'), note: 'Bed linen, towels and bath mats replaced; unit inspected.', by: 'Siti · Housekeeping' },
      { title: 'Closed', at: stamp(today, -6, '13:05'), note: 'Photo checklist approved. Ready for 15:00 check-in.', by: 'Ops supervisor' }] },
    { id: 'SC-2270', unitId: 'u2', title: 'Shower drain blocked', cat: 'Plumbing', done: true, ttf: '5h 10m', operator: 'Ravi (Plumber)', photos: ['Before', 'After'], trail: [
      { title: 'Issue reported', at: stamp(today, -9, '20:41'), note: 'Guest reported slow drain in shower.', by: 'Guest · Airbnb inbox' },
      { title: 'Case opened', at: stamp(today, -9, '20:47'), note: 'Case created, plumber booked for next morning per guest preference.', by: 'Aina · Customer service' },
      { title: 'Operator on site', at: stamp(today, -8, '09:30'), note: 'Hair trap and drain cleared.', by: 'Ravi · Plumber' },
      { title: 'Fixed', at: stamp(today, -8, '10:15'), note: 'Drain flowing normally; new hair catcher fitted.', by: 'Ravi · Plumber' },
      { title: 'Closed', at: stamp(today, -8, '11:00'), note: 'Guest confirmed. Case closed.', by: 'Aina · Customer service' }] },
    { id: 'SC-2262', unitId: 'u0', title: 'Smart lock battery low', cat: 'Maintenance', done: true, ttf: '45m', operator: 'Hafiz (Technician)', photos: ['Lock'], trail: [
      { title: 'Alert raised', at: stamp(today, -11, '08:02'), note: 'Lock reported battery at 15%.', by: 'Smart lock · auto alert' },
      { title: 'Case opened', at: stamp(today, -11, '08:03'), note: 'Battery swap scheduled before next arrival.', by: 'ERP · Auto case' },
      { title: 'Fixed', at: stamp(today, -11, '08:47'), note: 'Batteries replaced, lock tested with new guest code.', by: 'Hafiz · Technician' },
      { title: 'Closed', at: stamp(today, -11, '08:50'), note: 'Auto-closed after lock reported 100%.', by: 'ERP · Auto case' }] },
    { id: 'SC-2251', unitId: 'u1', title: 'Deep cleaning (monthly)', cat: 'Housekeeping', done: true, ttf: '3h 05m', operator: 'Siti (Housekeeping)', photos: ['Kitchen', 'Sofa', 'Bathroom'], trail: [
      { title: 'Case opened', at: stamp(today, -16, '10:00'), note: 'Monthly deep clean scheduled.', by: 'Ops desk' },
      { title: 'Operator on site', at: stamp(today, -16, '10:20'), note: 'Kitchen, grout and sofa shampoo.', by: 'Siti · Housekeeping' },
      { title: 'Fixed', at: stamp(today, -16, '13:25'), note: 'Deep clean completed.', by: 'Siti · Housekeeping' },
      { title: 'Closed', at: stamp(today, -16, '13:40'), note: 'Inspection passed.', by: 'Ops supervisor' }] },
  ];

  // Twelve monthly statements ending with this month (still processing).
  const statements: SampleStatement[] = [];
  let acc = 0;
  for (let k = 0; k < 12; k++) {
    const month = monthShift(today, k - 11);
    const r = rng(k * 17 + 3);
    const nights = 60 + Math.floor(r() * 28);
    const gross = Math.round(nights * (17800 + r() * 2000));
    const costs = Math.round(gross * 0.2 + 90000 + r() * 30000);
    const net = gross - costs, topup = Math.max(0, GUARANTEE - net), payout = net + topup;
    acc += payout;
    statements.push({ month, nights, gross, costs, net, topup, payout, acc, processing: k === 11 });
  }
  statements.reverse();

  const chat: ChatMessage[] = [
    { me: false, text: `Hi ${OWNER.first}, your statement for this month is being prepared. Payout is scheduled for the 7th.`, at: stamp(today, -2, '10:02') },
    { me: true, text: 'Thanks Aina. Was the aircon in B52-05 fixed?', at: stamp(today, -2, '10:15') },
    { me: false, text: 'Yes, it was fixed. You can see the full trail and photos under Service cases, case SC-2291.', at: stamp(today, -2, '10:18') },
  ];

  return { stays, reviews, cases, statements, chat };
}
export type Sample = ReturnType<typeof sampleOwner>;

/** Share of a unit's nights booked in [from, to). */
export function occupancy(stays: SampleStay[], unitIds: string[], from: string, to: string): number {
  const days = Math.max(1, daysBetween(from, to));
  let booked = 0;
  for (const id of unitIds) {
    for (let d = from; d < to; d = addDays(d, 1)) if (stays.some(s => s.unitId === id && s.checkIn <= d && d < s.checkOut)) booked++;
  }
  return Math.round((booked / (days * unitIds.length)) * 100);
}
