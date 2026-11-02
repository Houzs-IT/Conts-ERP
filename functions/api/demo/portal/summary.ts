import { type Env, json, fail } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { demoAllowed } from '../../../_lib/demo';
import { todayMyt } from '../../../_lib/ops';
import { sampleOwnerFor, statementMonths, sampleStatement, sampleRating, occupancy } from '../../../_lib/demoPortal';

/** GET /api/demo/portal/summary?ownerId=demo-...&period=YYYY-MM — the sample owner portal's summary, in the same shape as
 *  /api/owner/summary, from the sample owner's sample reservations (functions/_lib/demoPortal.ts). sample: true. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!(await demoAllowed(env, session))) return fail('FORBIDDEN', 'The sample owner portal is for management and sales staff.', 403);
  const url = new URL(request.url);
  const found = await sampleOwnerFor(env, url);
  if (found instanceof Response) return found;
  const { owner, units } = found;
  const months = await statementMonths(env, units.map(u => u.id));
  const asked = url.searchParams.get('period');
  const thisMonth = todayMyt().slice(0, 7);
  // The latest month with a statement, a final one when there is one (as a real owner sees their latest final month).
  const period = asked && /^\d{4}-\d{2}$/.test(asked) ? asked : months.find(m => m < thisMonth) ?? months[0] ?? thisMonth;
  const st = await sampleStatement(env, owner, units, period);
  const { rating, reviews } = await sampleRating(env, units.map(u => u.id));
  const [y, m] = period.split('-').map(Number);
  // A closed month is paid on the 7th of the next; until that day it reads as scheduled.
  const paidOn = new Date(Date.UTC(y, m, 7)).toISOString().slice(0, 10);
  const paid = st.isFinal && paidOn <= todayMyt();
  return json({
    sample: true, generatedAt: new Date().toISOString(), period, isFinal: st.isFinal, statementId: months.includes(period) ? st.id : '',
    unitsLabel: st.unitsLabel, units,
    payout: { amount: st.netPayout, state: paid ? 'paid' : 'pending', paidAt: paid ? paidOn : null, scheduledFor: st.isFinal && !paid ? paidOn : null, bankName: null, bankLast4: null, accounts: [] },
    grossToNet: [
      { label: 'Gross Income', amount: st.grossBookingValue, type: 'gross' },
      { label: `${st.share}% To Operator`, amount: -st.managementFee, type: 'fee' },
      { label: 'Net Payout to Owner', amount: st.netPayout, type: 'net' },
    ],
    stats: { occupancy: occupancy(st.nights, units.length, period), adr: st.nights ? Math.round(st.grossBookingValue / st.nights) : 0, bookings: st.stays, rating, reviews },
  });
};
