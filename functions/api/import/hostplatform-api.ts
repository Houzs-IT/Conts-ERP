import { type Env, all, one, run, json, fail, audit, nowIso, transaction } from '../../_lib/db';
import { can } from '../../_lib/access';
import { requireSession, type Session } from '../../_lib/auth';
import { ensureTurnovers, replanTurnover } from '../../_lib/cleaning';
import { hostplatformConfigured, hostplatformProperties, hostplatformReservationPage, type HpReservation } from '../../_lib/hostplatform';
import { mapApiReservations, todayInKL } from '../../_lib/hostplatformImport';
import { type Db, importReservations } from '../../_lib/hostplatformImportDb';

/**
 * Pull reservations from the HostPlatform API · /system/integrations/hostplatform.
 * GET  -> whether the API is set up here, and the HostPlatform properties to pull (the screen pulls them one by one).
 * POST { propertyId, from, updatedAfter? } -> every reservation of that property whose stay overlaps from .. 18 months
 *   ahead (or, with updatedAfter, every one HostPlatform changed since then), cancellations included, written like the CSV import (importReservations, source 'api': an existing booking keeps
 *   its money, channel, notes, guest and staff check-in/out). Read-only on HostPlatform. Nothing is deleted.
 * POST { ..., preview: true } -> the same, rolled back: what the pull would add, change, cancel and leave out. Saves nothing
 *   but its line in History.
 * One pull, and one preview, per property per minute: a second click while one runs, or right after, is refused.
 */

const allowed = (s: Session) => can(s, 'integrations', 'full');
const ACTION = 'import.hostplatform.api_reservations';
const COOLDOWN_MS = 60_000;
/** 40 pages of 50: far more than one building has had since August; a property past it is reported, not cut silently. */
const MAX_PAGES = 40;
const dbFor = (env: Env): Db => ({
  all: (sql, ...args) => all(env, sql, ...args) as never,
  run: (sql, ...args) => run(env, sql, ...args),
});

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!allowed(session)) return fail('FORBIDDEN', 'Only people with Full access to Integrations can pull from HostPlatform.', 403);
  if (!hostplatformConfigured(env)) return json({ configured: false, properties: [] });
  const res = await hostplatformProperties(env);
  if (!res.ok || !res.body) return fail('HOSTPLATFORM_FAILED', `HostPlatform did not return its buildings (status ${res.status}).`, 502);
  return json({ configured: true, properties: res.body });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!allowed(session)) return fail('FORBIDDEN', 'Only people with Full access to Integrations can pull from HostPlatform.', 403);
  if (!hostplatformConfigured(env)) return fail('NOT_CONFIGURED', 'HostPlatform is not set up here (HOSTPLATFORM_BASE_URL or HOSTPLATFORM_ACCESS_TOKEN missing).', 501);

  const b = await request.json<{ propertyId?: unknown; from?: unknown; updatedAfter?: unknown; preview?: unknown }>().catch(() => null);
  const propertyId = typeof b?.propertyId === 'string' && /^[a-z0-9]{2,20}$/i.test(b.propertyId) ? b.propertyId : null;
  const from = typeof b?.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.from) ? b.from : null;
  // Optional: only reservations HostPlatform changed since this instant (a catch-up after missed webhooks).
  const updatedAfter = typeof b?.updatedAfter === 'string' && !Number.isNaN(Date.parse(b.updatedAfter)) ? new Date(b.updatedAfter).toISOString() : null;
  // Preview: the same import inside a transaction that is rolled back, so the counts are exactly what a pull would do.
  const preview = b?.preview === true;
  if (!propertyId || !from) return fail('VALIDATION', 'Pick a HostPlatform building and a start date.', 422);

  // Previews and pulls have their own minute, so a pull right after its preview is not refused.
  const action = preview ? `${ACTION}.preview` : ACTION;
  const since = new Date(Date.now() - COOLDOWN_MS).toISOString();
  if (await one(env, 'SELECT 1 AS x FROM audit_log WHERE action IN (?, ?) AND entity_id = ? AND occurred_at > ?', action, `${action}.started`, propertyId, since)) {
    return fail('TOO_SOON', `This building was ${preview ? 'previewed' : 'pulled'} less than a minute ago. Wait a minute and try again.`, 429);
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: `${action}.started`, entityTable: 'import', entityId: propertyId, after: { from } });

  const today = todayInKL();
  const to = new Date(Date.parse(`${today}T00:00:00Z`) + 548 * 86400e3).toISOString().slice(0, 10);
  const pulled: HpReservation[] = [];
  let malformed = 0, cursor: string | null = null, pages = 0;
  try {
    do {
      const page = await hostplatformReservationPage(env, { propertyId, from, to, updatedAfter, cursor });
      if (!page.ok || !page.body) throw new Error(`HostPlatform refused the reservation list (status ${page.status}).`);
      pulled.push(...page.body.reservations);
      malformed += page.body.malformed;
      cursor = page.body.nextCursor;
    } while (cursor && ++pages < MAX_PAGES);
    if (cursor) throw new Error(`${propertyId} has more than ${MAX_PAGES * 50} reservations from ${from}; nothing was saved. Pull from a later date.`);

    const plan = mapApiReservations(pulled, today);
    let result: ImportOutcome;
    if (preview) {
      try {
        await transaction(env, async tx => { throw new RolledBack(await importReservations(dbFor(tx), plan, nowIso(), { source: 'api' })); });
        throw new Error('The preview was not rolled back.');
      } catch (e) {
        if (!(e instanceof RolledBack)) throw e;
        result = e.result;
      }
    } else {
      result = await importReservations(dbFor(env), plan, nowIso(), { source: 'api' });
    }
    const { effects } = result;
    // Cleaning follows the stays, as for a booking made here: a turnover for each live stay, none for a cancelled one,
    // and a new time when the checkout moved. All three only touch jobs nobody has started.
    if (effects && !preview) {
      for (const id of effects.cancelled) await replanTurnover(env, id, false);
      for (const id of effects.checkoutMoved) await replanTurnover(env, id, true);
      await ensureTurnovers(env, { reservationIds: effects.live });
    }
    result.skipped = result.errors.length + result.skippedRows.length;
    if (malformed) result.notes.push(`${malformed} reservation(s) from HostPlatform were missing their code, dates or unit and were left out.`);
    const blocks = pulled.filter(r => !r.guest_details).length;
    const codes = (ids: string[] = []) => ids.map(id => id.replace(/^hp-res-/, ''));
    await audit(env, {
      actorId: session.userId, actorLabel: session.fullName, action, entityTable: 'import', entityId: propertyId,
      after: { from, to, pulled: pulled.length, malformed, blocks, tables: result.tables, errors: result.errors.length, skipped: result.skippedRows.length, cancelled: effects?.cancelled.length ?? 0, checkoutMoved: effects?.checkoutMoved.length ?? 0 },
    });
    return json({ ...result, effects: undefined, preview, pulled: pulled.length, blocks, cancelled: codes(effects?.cancelled), checkoutMoved: codes(effects?.checkoutMoved) });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: `${action}.failed`, entityTable: 'import', entityId: propertyId, after: { from, pulled: pulled.length, error: message.slice(0, 300) } }).catch(() => {});
    return fail('PULL_FAILED', `${preview ? 'Preview' : 'Nothing more was saved'} for ${propertyId}: ${message.slice(0, 300)}`, 502);
  }
};

type ImportOutcome = Awaited<ReturnType<typeof importReservations>>;
/** Thrown out of the preview's transaction so it rolls back, carrying what the import would have done. */
class RolledBack extends Error {
  constructor(readonly result: ImportOutcome) { super('preview rolled back'); }
}
