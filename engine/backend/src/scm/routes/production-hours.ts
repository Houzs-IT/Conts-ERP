/* Worker actual hours on a production order (TODO item 16): Start time / Stop time per worker, entries added or corrected
   by hand, actual against the budgeted Production time. Mounted on the production order router (production-orders.ts):

     GET    /production-orders/:id/hours               entries, actual vs budget, who is on the clock
     POST   /production-orders/:id/hours/start         { personKey? }  start a timer (yourself, or a worker on the order)
     POST   /production-orders/:id/hours/stop          { personKey? }  stop that person's running timer
     POST   /production-orders/:id/hours               { personKey, startedAt, stoppedAt, notes? }  an entry by hand
     PATCH  /production-orders/:id/hours/:entryId      { startedAt?, stoppedAt?, notes? }
     DELETE /production-orders/:id/hours/:entryId

   The rules are lib/production-hours.ts. A timer runs only on an order in production (started, not on hold, not
   finished); entries by hand may also be added to a finished order. Complete stops every running timer. */

import { requireActiveCompanyId, scopeToCompanyId, NOT_THIS_COMPANY } from '../lib/companyScope';
import { scmAreaAllows } from '../middleware/area-guard';
import { recordEntityAudit } from '../lib/entity-audit';
import { checkEntryTimes, entryMinutes, hoursOf, overlaps, stopTimeFor, summarizeHours, type TimeEntry } from '../lib/production-hours';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client and Hono context, untyped in this family */
type Ctx = any;
type Db = any;

const COLS = 'id, production_order_id, person_key, name, started_at, stopped_at, notes, how, created_at, created_by_name, updated_at, updated_by_name';

type Order = { id: string; po_number: string; status: string; on_hold: boolean; actual_start_at: string | null; production_time_hours: number | string | null; completion_step: string | null };

/** A supervisor: Full access to Production Orders (the level above Edit in the engine's access matrix). A supervisor
    puts anyone on or off the clock and adds, corrects or removes entries; everyone else with Edit times only themselves.
    Like every area check, a user whose access matrix is not set up yet passes (scmAreaAllows). */
export const maySupervise = (c: Ctx): boolean => scmAreaAllows(c.get('houzsUser'), 'scm.procurement.production', 'full');
const NOT_SUPERVISOR = { error: 'forbidden', message: 'Only a production supervisor (Full access to Production Orders) can do this for someone else or change entries.' };
/** The database refused an overlapping entry (exclusion constraint, migration 0291) or a second running timer. */
const isClash = (error: { code?: string } | null): boolean => error?.code === '23P01';

const actorName = (c: Ctx): string => {
  const u = c.get('houzsUser') as { name?: string; full_name?: string; email?: string } | undefined;
  return u?.name ?? u?.full_name ?? u?.email ?? 'Unknown';
};
/** The caller as a worker: the same key Start writes on production_order_workers. */
export const selfKey = (c: Ctx): string => `user:${String(c.get('houzsUser')?.id ?? actorName(c))}`;
const isSelf = (c: Ctx, personKey: unknown): boolean => !(typeof personKey === 'string' && personKey.trim()) || personKey.trim() === selfKey(c);

async function loadOrder(c: Ctx, sb: Db, companyId: number): Promise<Order | null> {
  const { data } = await scopeToCompanyId(sb.from('production_orders')
    .select('id, po_number, status, on_hold, actual_start_at, production_time_hours, completion_step').eq('id', c.req.param('id')), companyId).maybeSingle();
  return (data ?? null) as Order | null;
}

async function loadEntries(sb: Db, orderId: string): Promise<{ ok: true; entries: TimeEntry[] } | { ok: false; reason: string }> {
  const { data, error } = await sb.from('production_time_entries').select(COLS).eq('production_order_id', orderId).order('started_at');
  if (error) return { ok: false, reason: error.message };
  return { ok: true, entries: (data ?? []) as TimeEntry[] };
}

/** Who the entry is for: yourself, or a worker listed on the order (Assign or Start). */
async function personFor(c: Ctx, sb: Db, orderId: string, personKey: unknown): Promise<{ ok: true; key: string; name: string } | { ok: false; message: string }> {
  const me = selfKey(c);
  const key = typeof personKey === 'string' && personKey.trim() ? personKey.trim() : me;
  if (key === me) return { ok: true, key, name: actorName(c) };
  const { data } = await sb.from('production_order_workers').select('person_key, name').eq('production_order_id', orderId).eq('person_key', key).maybeSingle();
  if (!data) return { ok: false, message: 'Pick a worker on this order (Assign them first).' };
  return { ok: true, key, name: String((data as { name: string }).name) };
}

const timerRefusal = (o: Order): string | null => {
  if (o.status === 'RECEIVED') return 'This production order is complete.';
  /* Complete runs in three steps and the order stays in production until the last: no new time once it has begun. */
  if (o.completion_step) return 'This production order is being completed.';
  if (o.status !== 'SUBMITTED') return `Time runs only on an order in production (this one is ${o.status.toLowerCase()}).`;
  if (!o.actual_start_at) return 'Press Start on the order first.';
  if (o.on_hold) return 'This production order is on hold. Take it off hold first.';
  return null;
};
const entryRefusal = (o: Order): string | null => {
  if (!o.actual_start_at) return 'Press Start on the order first.';
  if (o.status !== 'SUBMITTED' && o.status !== 'RECEIVED') return `Time is kept only on an order in production or complete (this one is ${o.status.toLowerCase()}).`;
  return null;
};

const budgetOf = (o: Order): number | null => (o.production_time_hours == null ? null : Number(o.production_time_hours));

async function audit(c: Ctx, sb: Db, companyId: number, o: Order, note: string): Promise<void> {
  await recordEntityAudit(sb, {
    entityType: 'PRODUCTION_ORDER', entityId: o.id, entityDocNo: o.po_number, action: 'UPDATE', actor: c.get('houzsUser'), companyId, statusSnapshot: o.status,
    note, fieldChanges: [],
  });
}

const hhmm = (iso: string): string => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' });

export const hoursGetHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const o = await loadOrder(c, sb, co.companyId);
  if (!o) return c.json(NOT_THIS_COMPANY, 404);
  const r = await loadEntries(sb, o.id);
  if (!r.ok) return c.json({ error: 'load_failed', reason: r.reason }, 500);
  const now = new Date();
  return c.json({
    budgetHours: budgetOf(o),
    summary: summarizeHours(r.entries, budgetOf(o), now),
    entries: r.entries.map((e) => ({ ...e, minutes: entryMinutes(e, now) })),
    me: selfKey(c),
    canTime: timerRefusal(o) == null,
    canEnter: entryRefusal(o) == null,
    canSupervise: maySupervise(c),
  });
};

export const timerStartHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const o = await loadOrder(c, sb, co.companyId);
  if (!o) return c.json(NOT_THIS_COMPANY, 404);
  const refusal = timerRefusal(o);
  if (refusal) return c.json({ error: 'validation', message: refusal }, 409);
  const b = (await c.req.json().catch(() => ({}))) as { personKey?: unknown };
  if (!isSelf(c, b.personKey) && !maySupervise(c)) return c.json(NOT_SUPERVISOR, 403);
  const who = await personFor(c, sb, o.id, b.personKey);
  if (!who.ok) return c.json({ error: 'validation', message: who.message }, 422);
  const { data: open, error: openErr } = await sb.from('production_time_entries').select('id, started_at')
    .eq('production_order_id', o.id).eq('person_key', who.key).is('stopped_at', null).maybeSingle();
  if (openErr) return c.json({ error: 'load_failed', reason: openErr.message }, 500);
  if (open) return c.json({ ok: true, alreadyRunning: true, id: (open as { id: string }).id, startedAt: (open as { started_at: string }).started_at });
  const now = new Date().toISOString();
  const { data, error } = await sb.from('production_time_entries').insert({
    production_order_id: o.id, company_id: co.companyId, person_key: who.key, name: who.name, started_at: now, how: 'TIMER',
    created_by: c.get('user')?.id ?? null, created_by_name: actorName(c),
  }).select('id').single();
  /* The one-running-timer index answers a double tap that slipped past the read above. */
  if (error) {
    if (error.code === '23505') return c.json({ error: 'already_running', message: `${who.name} is already on the clock.` }, 409);
    if (isClash(error)) return c.json({ error: 'overlap', message: `${who.name} already has time on this order that overlaps now.` }, 409);
    return c.json({ error: 'save_failed', reason: error.message }, 500);
  }
  await audit(c, sb, co.companyId, o, `Time started: ${who.name} at ${hhmm(now)}`);
  return c.json({ ok: true, id: (data as { id: string }).id, startedAt: now }, 201);
};

export const timerStopHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const o = await loadOrder(c, sb, co.companyId);
  if (!o) return c.json(NOT_THIS_COMPANY, 404);
  const b = (await c.req.json().catch(() => ({}))) as { personKey?: unknown };
  if (!isSelf(c, b.personKey) && !maySupervise(c)) return c.json(NOT_SUPERVISOR, 403);
  /* Stop goes by the running timer, not the worker list: someone taken off the order can still be stopped. */
  const key = typeof b.personKey === 'string' && b.personKey.trim() ? b.personKey.trim() : selfKey(c);
  const { data: open, error: openErr } = await sb.from('production_time_entries').select('id, started_at, name')
    .eq('production_order_id', o.id).eq('person_key', key).is('stopped_at', null).maybeSingle();
  if (openErr) return c.json({ error: 'load_failed', reason: openErr.message }, 500);
  if (!open) return c.json({ error: 'not_running', message: 'That person is not on the clock on this order.' }, 409);
  const row = open as { id: string; started_at: string; name: string };
  const who = { key, name: row.name };
  const stop = stopTimeFor(row.started_at, new Date());
  const { error } = await sb.from('production_time_entries')
    .update({ stopped_at: stop.stoppedAt, updated_at: new Date().toISOString(), updated_by_name: actorName(c) }).eq('id', row.id).is('stopped_at', null);
  if (error) return c.json({ error: 'save_failed', reason: error.message }, 500);
  const minutes = entryMinutes({ started_at: row.started_at, stopped_at: stop.stoppedAt }, new Date());
  await audit(c, sb, co.companyId, o, `Time stopped: ${who.name}, ${hoursOf(minutes)} h${stop.capped ? ' (stopped at the 16-hour limit)' : ''}`);
  return c.json({ ok: true, id: row.id, stoppedAt: stop.stoppedAt, minutes, capped: stop.capped });
};

export const entryAddHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const o = await loadOrder(c, sb, co.companyId);
  if (!o) return c.json(NOT_THIS_COMPANY, 404);
  if (!maySupervise(c)) return c.json(NOT_SUPERVISOR, 403);
  const refusal = entryRefusal(o);
  if (refusal) return c.json({ error: 'validation', message: refusal }, 409);
  const b = (await c.req.json().catch(() => ({}))) as { personKey?: unknown; startedAt?: unknown; stoppedAt?: unknown; notes?: unknown };
  const who = await personFor(c, sb, o.id, b.personKey);
  if (!who.ok) return c.json({ error: 'validation', message: who.message }, 422);
  const now = new Date();
  const t = checkEntryTimes(b.startedAt, b.stoppedAt, now);
  if (!t.ok) return c.json({ error: 'validation', message: t.message }, 422);
  const r = await loadEntries(sb, o.id);
  if (!r.ok) return c.json({ error: 'load_failed', reason: r.reason }, 500);
  const clash = overlaps(r.entries, who.key, t.startedAt, t.stoppedAt, null, now);
  if (clash) return c.json({ error: 'overlap', message: `${who.name} already has time from ${hhmm(clash.started_at)} on this order that overlaps.` }, 409);
  const notes = typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim().slice(0, 500) : null;
  const { data, error } = await sb.from('production_time_entries').insert({
    production_order_id: o.id, company_id: co.companyId, person_key: who.key, name: who.name, started_at: t.startedAt, stopped_at: t.stoppedAt,
    notes, how: 'MANUAL', created_by: c.get('user')?.id ?? null, created_by_name: actorName(c),
  }).select('id').single();
  if (isClash(error)) return c.json({ error: 'overlap', message: `${who.name} already has time on this order that overlaps.` }, 409);
  if (error) return c.json({ error: 'save_failed', reason: error.message }, 500);
  const minutes = entryMinutes({ started_at: t.startedAt, stopped_at: t.stoppedAt }, now);
  await audit(c, sb, co.companyId, o, `Time added by hand: ${who.name}, ${hoursOf(minutes)} h`);
  return c.json({ ok: true, id: (data as { id: string }).id, minutes }, 201);
};

async function loadEntry(c: Ctx, sb: Db, orderId: string): Promise<TimeEntry | null> {
  const { data } = await sb.from('production_time_entries').select(COLS).eq('id', c.req.param('entryId')).eq('production_order_id', orderId).maybeSingle();
  return (data ?? null) as TimeEntry | null;
}

export const entryEditHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const o = await loadOrder(c, sb, co.companyId);
  if (!o) return c.json(NOT_THIS_COMPANY, 404);
  if (!maySupervise(c)) return c.json(NOT_SUPERVISOR, 403);
  const refusal = entryRefusal(o);
  if (refusal) return c.json({ error: 'validation', message: refusal }, 409);
  const e = await loadEntry(c, sb, o.id);
  if (!e) return c.json({ error: 'not_found', message: 'That time entry is not on this order.' }, 404);
  const wasRunning = !e.stopped_at;
  const b = (await c.req.json().catch(() => ({}))) as { startedAt?: unknown; stoppedAt?: unknown; notes?: unknown };
  const now = new Date();
  const updates: Record<string, unknown> = { updated_at: now.toISOString(), updated_by_name: actorName(c) };
  if (b.startedAt !== undefined || b.stoppedAt !== undefined) {
    /* A running timer's start can be corrected; its stop stays open until Stop. */
    if (!e.stopped_at && b.stoppedAt === undefined) {
      const t = checkEntryTimes(b.startedAt, now.toISOString(), now);
      if (!t.ok) return c.json({ error: 'validation', message: t.message.replace('stop time', 'time now') }, 422);
      updates.started_at = t.startedAt;
    } else {
      const t = checkEntryTimes(b.startedAt ?? e.started_at, b.stoppedAt ?? e.stopped_at, now);
      if (!t.ok) return c.json({ error: 'validation', message: t.message }, 422);
      updates.started_at = t.startedAt;
      updates.stopped_at = t.stoppedAt;
    }
    const r = await loadEntries(sb, o.id);
    if (!r.ok) return c.json({ error: 'load_failed', reason: r.reason }, 500);
    const clash = overlaps(r.entries, e.person_key, String(updates.started_at), (updates.stopped_at as string | undefined) ?? e.stopped_at, e.id, now);
    if (clash) return c.json({ error: 'overlap', message: `${e.name} already has time from ${hhmm(clash.started_at)} on this order that overlaps.` }, 409);
  }
  if (b.notes !== undefined) updates.notes = typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim().slice(0, 500) : null;
  /* Written only if the entry is still as read: a running timer stopped meanwhile is not given a start past the cap. */
  const q = sb.from('production_time_entries').update(updates).eq('id', e.id);
  const { data: written, error } = await (wasRunning ? q.is('stopped_at', null) : q).select('id').maybeSingle();
  if (isClash(error)) return c.json({ error: 'overlap', message: `${e.name} already has time on this order that overlaps.` }, 409);
  if (error) return c.json({ error: 'save_failed', reason: error.message }, 500);
  if (!written) return c.json({ error: 'changed', message: 'This entry changed meanwhile (stopped or corrected). Look again and retry.' }, 409);
  const before = hoursOf(entryMinutes(e, now));
  const after = hoursOf(entryMinutes({ started_at: String(updates.started_at ?? e.started_at), stopped_at: (updates.stopped_at as string | undefined) ?? e.stopped_at }, now));
  await audit(c, sb, co.companyId, o, `Time corrected: ${e.name}, ${before} h to ${after} h`);
  return c.json({ ok: true });
};

export const entryDeleteHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const o = await loadOrder(c, sb, co.companyId);
  if (!o) return c.json(NOT_THIS_COMPANY, 404);
  if (!maySupervise(c)) return c.json(NOT_SUPERVISOR, 403);
  const refusal = entryRefusal(o);
  if (refusal) return c.json({ error: 'validation', message: refusal }, 409);
  const e = await loadEntry(c, sb, o.id);
  if (!e) return c.json({ error: 'not_found', message: 'That time entry is not on this order.' }, 404);
  const { error } = await sb.from('production_time_entries').delete().eq('id', e.id);
  if (error) return c.json({ error: 'save_failed', reason: error.message }, 500);
  await audit(c, sb, co.companyId, o, `Time removed: ${e.name}, ${hoursOf(entryMinutes(e, new Date()))} h from ${hhmm(e.started_at)}`);
  return c.json({ ok: true });
};

/** Complete stops every timer still running on the order; returns how many it stopped. A failure is logged, never a stop. */
export async function stopRunningTimers(sb: Db, orderId: string, byName: string): Promise<number> {
  const { data, error } = await sb.from('production_time_entries').select('id, started_at').eq('production_order_id', orderId).is('stopped_at', null);
  if (error) { console.error('[production-hours] running timers read failed', error.message); return 0; }
  const now = new Date();
  let n = 0;
  for (const r of (data ?? []) as Array<{ id: string; started_at: string }>) {
    const { error: upErr } = await sb.from('production_time_entries')
      .update({ stopped_at: stopTimeFor(r.started_at, now).stoppedAt, updated_at: now.toISOString(), updated_by_name: byName }).eq('id', r.id).is('stopped_at', null);
    if (upErr) console.error('[production-hours] timer stop failed', upErr.message); else n += 1;
  }
  return n;
}

/** Actual minutes per order, for the list. Running timers count to now. A failed read leaves the column blank. */
export async function actualMinutesByOrder(sb: Db, orderIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (orderIds.length === 0) return out;
  const { data, error } = await sb.from('production_time_entries').select('production_order_id, started_at, stopped_at').in('production_order_id', orderIds);
  if (error) { console.error('[production-hours] list read failed', error.message); return out; }
  const now = new Date();
  for (const r of (data ?? []) as Array<{ production_order_id: string; started_at: string; stopped_at: string | null }>) {
    out.set(r.production_order_id, (out.get(r.production_order_id) ?? 0) + entryMinutes(r, now));
  }
  return out;
}
