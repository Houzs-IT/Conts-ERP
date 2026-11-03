import { type Env, json, fail, audit } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { demoAllowed, demoAsked } from '../../../_lib/demo';
import { createReservation, type ReservationInput } from '../../../_lib/demoRecords';

/** POST /api/demo/reservations { unitId, guestName, channel, checkIn, checkOut, guestsCount, grossBookingValue, state?, notes? }
 *  A sample reservation, saved in schema demo and shown in Demo mode only. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!(await demoAllowed(env, session))) return fail('FORBIDDEN', 'Demo mode is for management and sales staff.', 403);
  if (!demoAsked(request)) return fail('DEMO_OFF', 'Turn Demo mode on to add sample data.', 409);
  const body = (await request.json().catch(() => null) ?? {}) as ReservationInput;
  const made = await createReservation(env, body, session.fullName);
  if (made instanceof Response) return made;
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'demo.reservation.create', entityTable: 'demo.reservations', entityId: made.id, after: body });
  return json(made, 201);
};
