import { type Env, all, run, json, audit, nowIso } from '../../_lib/db';
import { timingSafeEqualStr } from '../../_lib/auth';
import { ensureTurnovers, replanTurnover } from '../../_lib/cleaning';
import { isHpReservation, isRecord } from '../../_lib/hostplatform';
import { mapApiReservations, todayInKL } from '../../_lib/hostplatformImport';
import { type Db, importReservations } from '../../_lib/hostplatformImportDb';

/** POST /api/integrations/hostplatform-webhook: HostPlatform calls this when a reservation is created, updated, has
 *  its contact changed, is cancelled or is deleted (its Webhook settings: version 2, all five events, header
 *  authentication X-Webhook-Secret). There is no session: the caller is HostPlatform's server, so it is checked by the
 *  shared secret instead (HOSTPLATFORM_WEBHOOK_SECRET). The reservation is written exactly as the pull writes it
 *  (importReservations, source 'api'): a reservation already here only follows dates, unit, guest count and
 *  cancellation; its money, notes, guest and check-in/out stay. A deleted reservation is not deleted here: it is noted
 *  in History and shows in the pull's "no longer has" list for staff.
 *  HostPlatform waits 5 seconds and retries a call that does not get 200 or 201 (up to 5 tries, 30 minutes apart), so a
 *  call that can never succeed (wrong payload version, unknown unit) still gets 200, and only a failure on our side
 *  (the database) answers 500 to be tried again. Writing is idempotent, so a repeat changes nothing. */

const dbFor = (env: Env): Db => ({
  all: (sql, ...args) => all(env, sql, ...args) as never,
  run: (sql, ...args) => run(env, sql, ...args),
});
const EVENTS = ['newReservation', 'updateReservation', 'contactOnly', 'cancelReservation', 'deleteReservation'];

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const secret = env.HOSTPLATFORM_WEBHOOK_SECRET;
  if (!secret || !timingSafeEqualStr(request.headers.get('x-webhook-secret') ?? '', secret)) {
    return json({ ok: false, reason: 'unauthorized' }, 401);
  }
  const body: unknown = await request.json().catch(() => null);
  const event = isRecord(body) && typeof body.event === 'string' ? body.event : '';
  const reservation = isRecord(body) ? body.reservation : null;
  const version = request.headers.get('x-api-version');
  if (version !== '2' || !EVENTS.includes(event) || !isHpReservation(reservation)) {
    await audit(env, { actorId: null, actorLabel: 'HostPlatform', action: 'hostplatform.webhook.ignored', entityTable: 'import', entityId: 'webhook',
      after: { version, event, reason: 'Not a version 2 reservation event: set the version to V2 in the live update settings on HostPlatform.' } });
    return json({ ok: true, ignored: true });
  }
  const id = `hp-res-${reservation.code}`;
  if (event === 'deleteReservation') {
    await audit(env, { actorId: null, actorLabel: 'HostPlatform', action: 'hostplatform.webhook.deleted', entityTable: 'reservations', entityId: id,
      after: { code: reservation.code, checkIn: reservation.check_in_date, checkOut: reservation.check_out_date, note: 'Deleted on HostPlatform. Not deleted here: check it and cancel it by hand.' } });
    return json({ ok: true, deleted: false });
  }

  const result = await importReservations(dbFor(env), mapApiReservations([reservation], todayInKL()), nowIso(), { source: 'api' });
  const { effects } = result;
  if (effects) {
    for (const r of effects.cancelled) await replanTurnover(env, r, false);
    for (const r of effects.checkoutMoved) await replanTurnover(env, r, true);
    await ensureTurnovers(env, { reservationIds: effects.live });
  }
  const problems = [...result.errors, ...result.skippedRows].map(e => e.reason);
  await audit(env, { actorId: null, actorLabel: 'HostPlatform', action: `hostplatform.webhook.${event}`, entityTable: 'reservations', entityId: id,
    after: { code: reservation.code, created: result.created, updated: result.updated, cancelled: !!effects?.cancelled.length, problems } });
  return json({ ok: true, created: result.created, updated: result.updated, problems });
};
