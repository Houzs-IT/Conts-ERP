import { type Env, json, fail, audit } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { demoAllowed, demoAsked } from '../../../_lib/demo';
import { updateReservation, removeDemo, type ReservationInput } from '../../../_lib/demoRecords';

async function gate(request: Request, env: Env) {
  const { session, response } = await requireSession(request, env);
  if (!session) return { session: null, response: response! };
  if (!(await demoAllowed(env, session))) return { session: null, response: fail('FORBIDDEN', 'Demo mode is for management and sales staff.', 403) };
  if (!demoAsked(request)) return { session: null, response: fail('DEMO_OFF', 'Turn Demo mode on to change sample data.', 409) };
  return { session, response: null };
}

/** PATCH /api/demo/reservations/:id — changes a reservation in Demo mode only. A sample reservation is changed; a real
 *  one gets a demo shadow that Demo mode shows in its place, and the real reservation stays as it was. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await gate(request, env);
  if (!session) return response!;
  const id = String(params.id);
  const body = (await request.json().catch(() => null) ?? {}) as ReservationInput;
  const done = await updateReservation(env, id, body, session.fullName);
  if (done instanceof Response) return done;
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: done.shadow ? 'demo.reservation.shadow' : 'demo.reservation.update', entityTable: 'demo.reservations', entityId: id, after: body });
  return json(done);
};

/** DELETE /api/demo/reservations/:id — removes a sample reservation, or a real one's Demo mode changes. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await gate(request, env);
  if (!session) return response!;
  const id = String(params.id);
  const done = await removeDemo(env, 'reservations', id);
  if (done instanceof Response) return done;
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'demo.reservation.remove', entityTable: 'demo.reservations', entityId: id });
  return json(done);
};
