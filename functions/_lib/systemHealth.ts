import { type Env, all, one, nowIso } from './db';
import { channexConfigured, channexListWebhooks } from './channex';

/** Audit actions worth a second look: accounts and passwords, settings, money leaving, and anything deleted
 *  or cleared. A SQL condition on audit_log.action, shared by the health counts and the audit feed. */
export const SENSITIVE_SQL = `(action LIKE 'user.%' OR action LIKE 'account.%' OR action LIKE 'settings.%' OR action LIKE 'payout.%'
  OR action LIKE '%.delete' OR action LIKE 'data.%' OR action LIKE '%fail%')`;

export const RANGES: Record<string, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };

export type Status = 'ok' | 'warning' | 'critical' | 'off';
/** One stat card: `value` is the large figure, `summary` the line under it. */
export interface Check { key: string; label: string; value: string; status: Status; summary: string; detail?: string; link?: { label: string; path: string } }

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What a recorded failure means in plain words. Keep in sync with the `*_failed` audit actions. */
const PROBLEM: Record<string, string> = {
  'channex.push_failed': 'An update to the channels was refused',
  'channex.enqueue_failed': 'An update for the channels could not be set to send',
  'channex.initial_push_failed': "A unit's first send to Channex did not go through",
  'channex.booking_feed_failed': 'Reservations could not be read from Channex',
  'channex.message_push_failed': 'A guest message could not be sent',
  'channex.review_reply_push_failed': 'A review reply could not be sent',
  'unit.import_undo_failed': 'A failed Airbnb import could not be undone',
};

/** Channex's public status page. Conts reaches Booking.com, Airbnb and Agoda through Channex, so the states it
 *  publishes for each channel are the ones that matter here (it recorded the Booking.com outage of 22 Oct 2026
 *  the same morning). Names as Channex spells them; `API` is Channex itself. */
const CHANNEL_STATUS_URL = 'https://status.channex.io/index.json';
const WATCHED: [name: string, label: string][] = [['API', 'Channex'], ['Booking.com', 'Booking.com'], ['Airbnb', 'Airbnb'], ['Agoda', 'Agoda']];

/** One card for what the channels themselves report. Their page being unreadable is not our outage, so it
 *  reads "off" rather than red, and only a channel the page names as down or having problems raises it. */
export async function channelStatus(): Promise<Check> {
  const card = (c: Omit<Check, 'key' | 'label'>): Check => ({ key: 'channels', label: 'Channel status', ...c });
  let states: Map<string, string>;
  try {
    const res = await fetch(CHANNEL_STATUS_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const page = await res.json() as { included?: { type?: string; attributes?: { public_name?: string; status?: string } }[] };
    states = new Map((page.included ?? []).filter(x => x.type === 'status_page_resource' && x.attributes?.public_name)
      .map(x => [x.attributes!.public_name!, String(x.attributes!.status ?? '')]));
  } catch {
    return card({ value: '—', status: 'off', summary: "Channex's status page could not be read", detail: 'Checked again in a few minutes. This does not mean a channel is down.' });
  }
  const watched = WATCHED.filter(([name]) => states.has(name)).map(([name, label]) => ({ label, state: states.get(name)! }));
  if (!watched.length) return card({ value: '—', status: 'off', summary: "Channex's status page no longer lists the channels" });
  const names = (state: string) => watched.filter(w => w.state === state).map(w => w.label).join(', ');
  const why = 'Reported by Channex (status.channex.io). Prices, open dates and reservations for that channel may be late or missing until it clears; there is nothing to fix on our side.';
  if (names('downtime')) return card({ value: 'Down', status: 'critical', summary: `${names('downtime')} down`, detail: why });
  if (names('degraded')) return card({ value: 'Problems', status: 'warning', summary: `${names('degraded')} having problems`, detail: why });
  if (names('maintenance')) return card({ value: 'Maintenance', status: 'ok', summary: `Planned maintenance on ${names('maintenance')}` });
  return card({ value: 'All up', status: 'ok', summary: `${watched.map(w => w.label).join(', ')} working` });
}

/** The live state of every moving part, measured now and never read from a stored status. `db`, `r2` and
 *  `counts` are the portable core (the same shape as the Hookka /admin/health live payload); `checks` are
 *  this system's own integrations, one stat card each. Every check runs on its own: one that cannot be
 *  measured says so and does not hide the rest. `origin` is this site's own address (the Channex callback
 *  is registered against it). Shared by GET /api/system/health and the report the cron worker sends the
 *  Houzs IT Hub. */
export async function measureHealth(env: Env, origin: string) {
  const guarded = async (key: string, label: string, run: () => Promise<Omit<Check, 'key' | 'label'>>): Promise<Check> => {
    try { return { key, label, ...(await run()) }; }
    catch (e) { return { key, label, value: '—', status: 'critical', summary: 'Could not be checked.', detail: e instanceof Error ? e.message.slice(0, 200) : undefined }; }
  };

  const db = await (async () => {
    const t = Date.now();
    try { await one(env, 'SELECT 1 AS x'); return { ok: true, latency_ms: Date.now() - t }; }
    catch (e) { return { ok: false, latency_ms: Date.now() - t, error: e instanceof Error ? e.message.slice(0, 200) : 'Unknown error' }; }
  })();

  const r2 = await (async () => {
    if (!env.MEDIA) return { bound: false, ok: false, latency_ms: 0 };
    const t = Date.now();
    try { await env.MEDIA.head('__health__'); return { bound: true, ok: true, latency_ms: Date.now() - t }; }
    catch { return { bound: true, ok: false, latency_ms: Date.now() - t }; }
  })();

  const counts = await (async () => {
    const u = await one<{ active: number; invited: number; disabled: number; locked: number }>(env, `
      SELECT count(*) FILTER (WHERE is_active = 1 AND last_login_at IS NOT NULL)::int AS active,
             count(*) FILTER (WHERE is_active = 1 AND last_login_at IS NULL)::int AS invited,
             count(*) FILTER (WHERE is_active <> 1)::int AS disabled,
             count(*) FILTER (WHERE locked_until IS NOT NULL AND locked_until > ?)::int AS locked
      FROM users`, nowIso()).catch(() => null);
    const a = await one<{ d1: number; d7: number; s1: number; last: string | null }>(env, `
      SELECT count(*) FILTER (WHERE occurred_at >= ?)::int AS d1, count(*)::int AS d7,
             count(*) FILTER (WHERE occurred_at >= ? AND ${SENSITIVE_SQL})::int AS s1,
             (SELECT max(occurred_at) FROM audit_log) AS last
      FROM audit_log WHERE occurred_at >= ?`, ago(DAY), ago(DAY), ago(7 * DAY)).catch(() => null);
    return {
      users_active: u?.active ?? 0, users_invited: u?.invited ?? 0, users_disabled: u?.disabled ?? 0, users_locked: u?.locked ?? 0,
      audit_24h: a?.d1 ?? 0, audit_7d: a?.d7 ?? 0, sensitive_24h: a?.s1 ?? 0, last_event_at: a?.last ?? null,
    };
  })();

  const email = guarded('email', 'Email', async () => {
    const configured = !!(env as { MAIL_API_KEY?: string }).MAIL_API_KEY;
    const s = await one<{ sent: number; failed: number; waiting: number; oldest: string | null }>(env, `
      SELECT count(*) FILTER (WHERE state = 'sent' AND sent_at >= ?)::int AS sent,
             count(*) FILTER (WHERE state = 'failed' AND queued_at >= ?)::int AS failed,
             count(*) FILTER (WHERE state = 'queued')::int AS waiting,
             min(queued_at) FILTER (WHERE state = 'queued') AS oldest
      FROM notification_log WHERE channel = 'email'`, ago(7 * DAY), ago(7 * DAY));
    const week = `${s?.sent ?? 0} sent in 7 days`;
    // The bell counts these failures and links here, so they are named even when the key is missing.
    if (!configured) return { value: 'Missing', status: 'off', summary: `Mail key not set${(s?.failed ?? 0) > 0 ? ` · ${s!.failed} failed in 7 days` : ''}`, detail: 'Owner statements, invitations and password resets cannot be emailed until a mail key is added.' };
    if ((s?.failed ?? 0) > 0) return { value: 'Set', status: 'warning', summary: `${s!.failed} failed · ${week}` };
    if (s?.oldest && s.oldest < ago(DAY)) return { value: 'Set', status: 'warning', summary: `${s.waiting} waiting over a day`, detail: 'Emails held overnight are sent by the background jobs.' };
    return { value: 'Set', status: 'ok', summary: (s?.waiting ?? 0) > 0 ? `${week} · ${s!.waiting} waiting` : week };
  });

  // One live question to Channex answers both whether it is reachable and whether it is set to notify us.
  const hooks = channexConfigured(env) ? await (async () => { const t = Date.now(); const r = await channexListWebhooks(env).catch(() => null); return { r, ms: Date.now() - t }; })() : null;
  const integrations = { label: 'Open Integrations', path: '/system/integrations' };

  const channex = guarded('channex', 'Channex', async () => {
    if (!hooks) return { value: '—', status: 'off', summary: 'Not connected', detail: 'Prices are not sent to Airbnb, Booking.com and Agoda, and their reservations do not arrive here.' };
    if (!hooks.r?.ok) return { value: 'Down', status: 'critical', summary: hooks.r ? `Refused (${hooks.r.status})` : 'Unreachable', detail: 'Prices, open dates and reservations are not moving until this clears.', link: integrations };
    const units = await one<{ linked: number; total: number }>(env, 'SELECT count(*) FILTER (WHERE channex_property_id IS NOT NULL)::int AS linked, count(*)::int AS total FROM units');
    return { value: `${hooks.ms} ms`, status: 'ok', summary: `${units?.linked ?? 0} of ${plural(units?.total ?? 0, 'unit')} linked`, link: integrations };
  });

  const bookings = guarded('bookings', 'Live updates', async () => {
    if (!hooks) return { value: '—', status: 'off', summary: 'Needs Channex' };
    if (!env.CHANNEX_WEBHOOK_SECRET) return { value: 'Off', status: 'critical', summary: 'Notification secret missing', detail: 'New reservations from the channels will not arrive on their own.', link: integrations };
    if (!hooks.r?.ok) return { value: '—', status: 'warning', summary: 'Channex could not be asked' };
    // vocab-ok: URL path of the live updates address, not shown as words
    const callbackUrl = `${origin}/api/integrations/channex-webhook`;
    const on = (hooks.r.body?.data ?? []).some((w: any) => w.attributes?.callback_url === callbackUrl && w.attributes?.is_active !== false);
    const last = await one<{ at: string | null }>(env, "SELECT max(created_at) AS at FROM reservations WHERE channel IN ('airbnb','booking_com','agoda')");
    return on
      ? { value: 'On', status: 'ok', summary: last?.at ? `Last reservation in ${last.at.slice(0, 10)}` : 'No reservation received yet' }
      : { value: 'Off', status: 'critical', summary: 'Not registered with Channex', detail: 'New reservations from the channels will not arrive on their own. Turn on live updates from Integrations.', link: integrations };
  });

  const queue = guarded('queue', 'Waiting to send', async () => {
    if (!channexConfigured(env)) return { value: '—', status: 'off', summary: 'Needs Channex' };
    const q = await one<{ queued: number; failed: number; oldest: string | null }>(env, `
      SELECT count(*) FILTER (WHERE status IN ('queued','sending'))::int AS queued,
             count(*) FILTER (WHERE status = 'failed')::int AS failed,
             min(created_at) FILTER (WHERE status IN ('queued','sending')) AS oldest
      FROM channex_outbox`);
    const c = await one<{ ok: number; refused: number }>(env, `
      SELECT count(*) FILTER (WHERE status BETWEEN 200 AND 299)::int AS ok,
             count(*) FILTER (WHERE status NOT BETWEEN 200 AND 299)::int AS refused
      FROM channex_calls WHERE called_at >= ?`, ago(DAY));
    const day = `${c?.ok ?? 0} accepted in 24h${c?.refused ? ` · ${c.refused} retried` : ''}`;
    if ((q?.failed ?? 0) > 0) return { value: String(q!.failed), status: 'critical', summary: 'Not sent after refusals', detail: 'Those prices or dates are not on the channels. Use Send everything again on Integrations.', link: integrations };
    if (q?.oldest && q.oldest < ago(10 * MIN)) return { value: String(q.queued), status: 'warning', summary: 'Waiting over 10 minutes', detail: 'They go out on the next save, or by themselves once the background jobs are running.', link: integrations };
    return { value: String(q?.queued ?? 0), status: 'ok', summary: `waiting · ${day}`, link: integrations };
  });

  // The background worker leaves no record of running, so it is judged by the work it should have done.
  const jobs = guarded('jobs', 'Background jobs', async () => {
    const tasks = await one<{ n: number }>(env, "SELECT count(*)::int AS n FROM tasks WHERE state IN ('open','assigned','in_progress') AND due_at IS NOT NULL AND due_at < ?", ago(HOUR));
    const mail = await one<{ n: number }>(env, "SELECT count(*)::int AS n FROM notification_log WHERE state = 'queued' AND channel <> 'in_app' AND queued_at < ?", ago(DAY));
    const left = [
      (tasks?.n ?? 0) > 0 ? `${plural(tasks!.n, 'job')} past due and not marked overdue` : '',
      (mail?.n ?? 0) > 0 ? `${plural(mail!.n, 'message')} held for more than a day` : '',
    ].filter(Boolean);
    return left.length
      ? { value: 'Stalled', status: 'warning', summary: left[0], detail: `${left.join('; ')}. These are done by a scheduled worker that has to be switched on separately.` }
      : { value: 'Running', status: 'ok', summary: 'Nothing waiting on them' };
  });

  const recent = await all<{ occurred_at: string; action: string; entity_table: string; entity_id: string; after_state: string | null }>(env, `
    SELECT occurred_at, action, entity_table, entity_id, after_state FROM audit_log
    WHERE action LIKE '%fail%' AND occurred_at >= ? ORDER BY occurred_at DESC LIMIT 20`, ago(7 * DAY)).catch(() => []);
  const unitName = new Map((await all<{ id: string; label: string }>(env, `
    SELECT u.id, p.name || ' ' || u.unit_number AS label FROM units u JOIN properties p ON p.id = u.property_id`).catch(() => [])).map(u => [u.id, u.label]));
  const problems = recent.map(r => {
    let error = '';
    try { error = String(JSON.parse(r.after_state ?? '{}')?.error ?? ''); } catch { /* not JSON */ }
    // Channex reports a refusal as JSON; keep its own sentence rather than the wrapper.
    try { const e = JSON.parse(error)?.errors; const first = Object.values(e?.details ?? {})[0]; error = String((Array.isArray(first) ? first[0] : first) ?? e?.title ?? error); } catch { /* plain text */ }
    return { at: r.occurred_at, what: PROBLEM[r.action] ?? r.action.replace(/[._]/g, ' '), where: r.entity_table === 'units' ? unitName.get(r.entity_id) ?? null : null, error: error.slice(0, 160) || null };
  });
  const lastDay = problems.filter(p => p.at >= ago(DAY)).length;
  const errors: Check = { key: 'problems', label: 'Problems 24h', value: String(lastDay), status: lastDay > 0 ? 'warning' : 'ok', summary: `${problems.length} in 7 days` };

  const checks = [...await Promise.all([email, channex, bookings, queue, jobs, channelStatus()]), errors];
  const ok = db.ok && !(r2.bound && !r2.ok) && !checks.some(c => c.status === 'critical');
  return { ok, time: nowIso(), db, r2, counts, checks, problems };
}
