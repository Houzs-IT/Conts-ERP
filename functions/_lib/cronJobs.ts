import { type Env, all, one, run, audit, nowIso } from './db';
import { ensureTurnovers, replanTurnover, CLEAN_KINDS_SQL } from './cleaning';
import { overdueCleans } from './cleanOverdue';
import { cleanDeadline } from '../../src/lib/cleanOverdue';
import { hostplatformConfigured, hostplatformProperties, hostplatformReservationPage, type HpReservation } from './hostplatform';
import { mapApiReservations } from './hostplatformImport';
import { type Db, importReservations } from './hostplatformImportDb';
import { peopleWithAccess } from './access';
import { deliver, notifyUsers, retryAt, MAX_SEND_ATTEMPTS, hasSendLease, sendLeaseUntil } from './notify';
import { flushWhenQuiet } from './channexQueue';
import { channexConfigured } from './channex';
import { cleaningNotice, repairNotice } from './notices';
import { releaseRepairBlocks } from './repairBlocks';
import { hasAttendance } from './attendance';
import { FORGOTTEN_AFTER_HOURS } from './attendanceCalc';
import { dueDepartures, markGuestLeft } from './guestLeft';
import { runGuestReviews } from './guestReviews';

/**
 * The scheduled jobs, shared by the cron worker (worker/scheduled.ts) and the local dry run
 * (scripts/cron-dry-run.mjs). Every job is idempotent and reports what it did, or with dryRun what it would do,
 * without writing anything. A job that fails is reported and the others still run.
 */
export interface JobReport { job: string; summary: string; items?: string[]; error?: string }
export interface RunOptions { dryRun?: boolean; now?: Date }

// The digest counts inspections as well, unlike CLEAN_KINDS_SQL in cleaning.ts.
const DIGEST_JOB_KINDS = `('turnover','deep_clean','light_clean','inspection')`;
const mytParts = (d: Date) => { const t = new Date(d.getTime() + 8 * 3600e3); return { day: t.toISOString().slice(0, 10), hour: t.getUTCHours() }; };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Every minute: send the Channex outbox (retries and anything the request-time flush missed). */
export async function channexOutbox(env: Env, o: RunOptions = {}): Promise<JobReport> {
  if (!channexConfigured(env)) return { job: 'channex-outbox', summary: 'Channex is not configured here (CHANNEX_API_KEY not set): nothing to send.' };
  const due = await all<{ kind: string; n: number; retries: number }>(env, `
    SELECT kind, count(*)::int AS n, count(*) FILTER (WHERE attempts > 0)::int AS retries FROM channex_outbox
    WHERE status IN ('queued','sending') AND next_attempt_at <= ? GROUP BY kind`, (o.now ?? new Date()).toISOString());
  const items = due.map(d => `${d.kind}: ${plural(d.n, 'row')} due (${d.retries} being retried)`);
  if (o.dryRun) return { job: 'channex-outbox', summary: due.length ? `Would send ${plural(due.reduce((n, d) => n + d.n, 0), 'due row')}.` : 'Nothing due.', items };
  await flushWhenQuiet(env);
  return { job: 'channex-outbox', summary: due.length ? `Sent or rescheduled ${plural(due.reduce((n, d) => n + d.n, 0), 'due row')}.` : 'Nothing due.', items };
}

/** Every 5 minutes: retry the Mail Center emails whose first send failed (CONTS-0004). The supply chain engine runs
 *  no schedule of its own (engine/backend/wrangler.production.toml), so this knocks on its retry route with
 *  CONTS_CRON_SECRET (engine/backend/src/conts/mail-cron.ts). Off until both the address and the secret are set. */
export async function engineMailOutbox(env: Env, o: RunOptions = {}): Promise<JobReport> {
  const key = (env.CONTS_CRON_SECRET ?? '').trim();
  const api = (env.SCM_ENGINE_API ?? '').trim().replace(/\/+$/, '');
  if (!key || !api) return { job: 'engine-mail-outbox', summary: 'Not connected here (SCM_ENGINE_API or CONTS_CRON_SECRET not set): nothing retried.' };
  if (o.dryRun) return { job: 'engine-mail-outbox', summary: `Would ask ${api} to retry its failed emails.` };
  try {
    const res = await fetch(`${api}/api/conts-cron/mail-outbox`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(25_000),
    });
    const body = await res.json().catch(() => null) as { processed?: number; sent?: number; failed?: number } | null;
    if (!res.ok || !body) {
      console.error('Engine email retry refused', res.status);
      return { job: 'engine-mail-outbox', summary: `Engine email retry refused (${res.status}).` };
    }
    return { job: 'engine-mail-outbox', summary: body.processed ? `Retried ${plural(body.processed ?? 0, 'email')}: ${body.sent ?? 0} sent, ${body.failed ?? 0} given up.` : 'Nothing to retry.' };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('Engine email retry not run', error);
    return { job: 'engine-mail-outbox', summary: 'Engine email retry not run.', error };
  }
}

/** Every 5 minutes (from the every-minute trigger): ask the website to send the Houzs IT Hub the same health
 *  report its System health page shows (POST /api/system/health/hub-report). The website measures it, since
 *  it holds the mail key and Channex secret the checks look for; this worker only knocks, with Conts's IT Hub
 *  key. A failure is only logged: it must never fail the Channex job beside it, and the hub already shows a
 *  report that stops arriving. */
export async function hubHealthReport(env: Env, o: RunOptions = {}): Promise<JobReport> {
  const now = o.now ?? new Date();
  if (!o.dryRun && now.getUTCMinutes() % 5 !== 0) return { job: 'hub-health-report', summary: 'Not this minute (every 5 minutes).' };
  const key = (env.IT_HUB_API_KEY ?? '').trim();
  const origin = (env.APP_ORIGIN ?? '').trim().replace(/\/+$/, '');
  if (!key || !origin) return { job: 'hub-health-report', summary: 'Not connected here (IT_HUB_API_KEY or APP_ORIGIN not set): nothing sent.' };
  if (o.dryRun) return { job: 'hub-health-report', summary: `Would ask ${origin} to send its health report to the IT Hub.` };
  try {
    const res = await fetch(`${origin}/api/system/health/hub-report`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(25_000),
    });
    const body = await res.json().catch(() => null) as { sent?: boolean; ok?: boolean; checks?: string[] } | null;
    if (!res.ok || !body?.sent) {
      console.error('Health report not sent', res.status);
      return { job: 'hub-health-report', summary: `Health report not sent (${res.status}).` };
    }
    return { job: 'hub-health-report', summary: 'Health report sent to the IT Hub.', items: [`${body.ok ? 'All OK' : 'Needs attention'}: ${(body.checks ?? []).join(', ')}`] };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('Health report not sent', error);
    return { job: 'hub-health-report', summary: 'Health report not sent.', error };
  }
}

/** Every 15 minutes: email / WhatsApp copies held for quiet hours go out after 08:00, and failed ones are retried
 *  with a growing wait (5 min, 20 min, 80 min ...) up to MAX_SEND_ATTEMPTS. */
export async function drainOutbox(env: Env, o: RunOptions = {}): Promise<JobReport> {
  const now = o.now ?? new Date();
  const { hour } = mytParts(now);
  const quiet = hour >= 22 || hour < 8;
  type Row = { id: string; template: string; recipient: string; channel: string; entity_table: string | null; entity_id: string | null; subject: string | null; body: string | null; state: string; attempts: number };
  let retryable = true;
  const cols = 'id, template, recipient, channel, entity_table, entity_id, subject, body, state';
  // With migration 0103 each due row is claimed (sending_until) in the same statement that picks it, so a second run
  // at the same moment, or the request still sending a message it just wrote, gets other rows or none.
  const lease = await hasSendLease(env);
  const free = lease ? 'AND (sending_until IS NULL OR sending_until <= ?)' : '';
  const nowArg = lease ? [now.toISOString()] : [];
  const pick = (where: string, order: string, limit: number, args: unknown[], attempts: string) => lease && !o.dryRun
    ? all<Row>(env, `UPDATE notification_log SET sending_until = ? WHERE id IN (
        SELECT id FROM notification_log WHERE ${where} ${free} ORDER BY ${order} LIMIT ${limit} FOR UPDATE SKIP LOCKED)
        RETURNING ${cols}, ${attempts} AS attempts`, sendLeaseUntil(now.getTime()), ...args, ...nowArg)
    : all<Row>(env, `SELECT ${cols}, ${attempts} AS attempts FROM notification_log WHERE ${where} ${free} ORDER BY ${order} LIMIT ${limit}`, ...args, ...nowArg);
  const queued = quiet ? [] : await pick("state = 'queued'", 'queued_at', 100, [], '0');
  const failed = await pick("state = 'failed' AND attempts < ? AND next_attempt_at IS NOT NULL AND next_attempt_at <= ?", 'next_attempt_at', 50, [MAX_SEND_ATTEMPTS, now.toISOString()], 'attempts')
    .catch(() => { retryable = false; return [] as Row[]; }); // before migration 0095 there is nothing to retry by
  const rows = [...queued, ...failed];
  const items = rows.map(r => `${r.state === 'queued' ? 'send' : `retry #${r.attempts + 1}`}: ${r.template} by ${r.channel}`);
  const lead = quiet ? 'Quiet hours (22:00-08:00): queued messages wait. ' : '';
  if (!retryable) items.push('Retries need migration 0095 (notification_log.attempts); not applied here.');
  if (o.dryRun) return { job: 'notification-outbox', summary: `${lead}Would send ${plural(queued.length, 'queued message')} and retry ${plural(failed.length, 'failed one')}.`, items };

  let sent = 0, failedAgain = 0;
  for (const q of rows) {
    try {
      const providerId = await deliver(env, {
        template: q.template, recipient: q.recipient, channel: q.channel as any, subject: q.subject ?? undefined, body: q.body ?? '',
        entityTable: q.entity_table ?? undefined, entityId: q.entity_id ?? undefined,
      });
      await run(env, `UPDATE notification_log SET state = 'sent', sent_at = ?, provider_message_id = ?, error = NULL${lease ? ', sending_until = NULL' : ''} WHERE id = ?`, nowIso(), providerId, q.id);
      sent++;
    } catch (e) {
      failedAgain++;
      const reason = e instanceof Error ? e.message : 'Unknown delivery error';
      const attempts = Number(q.attempts) + 1;
      await run(env, `UPDATE notification_log SET state = 'failed', error = ?${lease ? ', sending_until = NULL' : ''} WHERE id = ?`, reason, q.id);
      await run(env, 'UPDATE notification_log SET attempts = ?, next_attempt_at = ? WHERE id = ?', attempts, attempts >= MAX_SEND_ATTEMPTS ? null : retryAt(attempts, now.getTime()), q.id).catch(() => {});
    }
  }
  return { job: 'notification-outbox', summary: `${lead}Sent ${sent}; ${failedAgain} failed and will be retried while under ${MAX_SEND_ATTEMPTS} tries.`, items };
}

/** Every 15 minutes: a finished repair job's calendar block is given back (also done the moment the job is closed). */
export async function repairBlockSweep(env: Env, o: RunOptions = {}): Promise<JobReport> {
  const released = await releaseRepairBlocks(env, undefined, { id: null, label: 'Scheduled job' }, !!o.dryRun);
  return {
    job: 'repair-blocks', summary: released.length ? `${o.dryRun ? 'Would release' : 'Released'} ${plural(released.length, 'calendar block')} held for finished repair jobs.` : 'No finished repair job still holds the calendar.',
    items: released.map(r => `${r.action === 'cancelled' ? 'remove' : 'end today'}: block ${r.reservationId} (${r.from} to ${r.to}) for job ${r.issueId}`),
  };
}

const HP_SYNCED_KEY = 'hostplatform.synced_at';
/** A first run, with no earlier one on record, looks back this far; each run overlaps the last by a few minutes. */
const HP_FIRST_LOOKBACK_MS = 2 * 86400e3;
/* Wide on purpose: a booking can reach HostPlatform's list after the time it is stamped with, and a narrower overlap lost
   it for good (67DQQOTZA, owner report 2 Nov 2026). Writing a booking twice changes nothing. */
const HP_OVERLAP_MS = 60 * 60e3;
const HP_MAX_PAGES = 40;
/** The hourly sweep reads every stay from this many days back to this many ahead, whatever its change time. */
const HP_SWEEP_BACK_DAYS = 3;
const HP_SWEEP_AHEAD_DAYS = 180;

/** Every 5 minutes: pull what HostPlatform changed since the last good run, for every building. This is how HostPlatform
 *  reaches us: its webhook has one slot and StreamHost holds it. It is the Pull button's work (importReservations, source
 *  'api': an existing booking keeps its money, channel, notes, guest and staff check-in/out; nothing is deleted), limited by
 *  updated_after. The time is only moved on once every building was read and written, so a failed run is repeated whole.
 *  Reads HostPlatform only; with dryRun nothing is written, here or there. */
export async function hostplatformPull(env: Env, o: RunOptions = {}): Promise<JobReport> {
  const job = 'hostplatform-pull';
  if (!hostplatformConfigured(env)) return { job, summary: 'HostPlatform is not configured here (HOSTPLATFORM_BASE_URL or HOSTPLATFORM_ACCESS_TOKEN not set): nothing pulled.' };
  const startedAt = o.now ?? new Date();
  const last = Date.parse((await one<{ value: string }>(env, 'SELECT value FROM settings WHERE key = ?', HP_SYNCED_KEY))?.value ?? '');
  const since = new Date((Number.isNaN(last) ? startedAt.getTime() - HP_FIRST_LOOKBACK_MS : last) - HP_OVERLAP_MS).toISOString();
  const out = await hostplatformWrite(env, job, startedAt, { updatedAfter: since }, o);
  if (out.dryRun) return { job, summary: `Would write ${plural(out.pulled, 'reservation')} HostPlatform changed since ${since}.`, items: out.items };
  await run(env, `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    HP_SYNCED_KEY, startedAt.toISOString(), nowIso());
  return {
    job, summary: out.pulled ? `Wrote ${plural(out.pulled, 'reservation')} HostPlatform changed since ${since}: ${out.created} new, ${out.updated} changed.` : `HostPlatform changed nothing since ${since}.`,
    items: out.items,
  };
}

/** Hourly: every stay HostPlatform holds from a few days back to six months ahead, whatever its change time, so a booking
 *  the 5-minute pull missed is still brought in within the hour. Same write as the pull; reads HostPlatform only. */
export async function hostplatformSweep(env: Env, o: RunOptions = {}): Promise<JobReport> {
  const job = 'hostplatform-sweep';
  if (!hostplatformConfigured(env)) return { job, summary: 'HostPlatform is not configured here: nothing swept.' };
  const startedAt = o.now ?? new Date();
  const day = (n: number) => new Date(startedAt.getTime() + n * 864e5).toISOString().slice(0, 10);
  const from = day(-HP_SWEEP_BACK_DAYS), to = day(HP_SWEEP_AHEAD_DAYS);
  const out = await hostplatformWrite(env, job, startedAt, { from, to }, o);
  if (out.dryRun) return { job, summary: `Would check ${plural(out.pulled, 'reservation')} staying ${from} to ${to}.`, items: out.items };
  return { job, summary: `Checked ${plural(out.pulled, 'reservation')} staying ${from} to ${to}: ${out.created} new, ${out.updated} changed.`, items: out.items };
}

/** Read every building's reservations (changed since `updatedAfter`, or staying from .. to) and write them as the Pull
 *  button does. Throws before writing anything if a building cannot be read whole. */
async function hostplatformWrite(env: Env, job: string, startedAt: Date, w: { updatedAfter?: string; from?: string; to?: string }, o: RunOptions) {
  const buildings = await hostplatformProperties(env);
  if (!buildings.ok || !buildings.body) throw new Error(`HostPlatform did not return its buildings (status ${buildings.status}).`);
  const pulled: HpReservation[] = [];
  let malformed = 0;
  for (const { id: propertyId } of buildings.body) {
    let cursor: string | null = null, pages = 0;
    do {
      const page = await hostplatformReservationPage(env, w.updatedAfter
        ? { propertyId, from: w.updatedAfter.slice(0, 10), to: w.updatedAfter.slice(0, 10), updatedAfter: w.updatedAfter, cursor }
        : { propertyId, from: w.from!, to: w.to!, cursor });
      if (!page.ok || !page.body) throw new Error(`HostPlatform refused the reservation list for ${propertyId} (status ${page.status}).`);
      pulled.push(...page.body.reservations);
      malformed += page.body.malformed;
      cursor = page.body.nextCursor;
    } while (cursor && ++pages < HP_MAX_PAGES);
    if (cursor) throw new Error(`${propertyId} has more than ${HP_MAX_PAGES * 50} reservations to read; nothing was saved. Use the Pull button.`);
  }
  const items = malformed ? [`${malformed} reservation(s) were missing their code, dates or unit and were left out.`] : [];
  if (o.dryRun) return { dryRun: true as const, pulled: pulled.length, created: 0, updated: 0, items };

  const db: Db = { all: (sql, ...args) => all(env, sql, ...args) as never, run: (sql, ...args) => run(env, sql, ...args) };
  const result = pulled.length ? await importReservations(db, mapApiReservations(pulled, mytParts(startedAt).day), nowIso(), { source: 'api' }) : null;
  const { effects } = result ?? {};
  if (effects) {
    for (const id of effects.cancelled) await replanTurnover(env, id, false);
    for (const id of effects.checkoutMoved) await replanTurnover(env, id, true);
    await ensureTurnovers(env, { reservationIds: effects.live });
  }
  const problems = result ? [...result.errors, ...result.skippedRows].map(e => e.reason) : [];
  // Only a run that changed something, or could not place a booking, leaves a line in History: these run all day. A
  // booking left out used to leave no trace at all (owner report, 2 Nov 2026).
  if (result && (result.created || result.updated || effects?.cancelled.length || result.errors.length)) {
    await audit(env, {
      actorId: null, actorLabel: 'Scheduled job', action: job === 'hostplatform-pull' ? 'import.hostplatform.scheduled' : 'import.hostplatform.sweep',
      entityTable: 'import', entityId: 'hostplatform',
      after: { ...w, pulled: pulled.length, created: result.created, updated: result.updated, cancelled: effects?.cancelled.length ?? 0, problems: problems.length, firstProblems: problems.slice(0, 5) },
    }).catch(() => {});
  }
  return { dryRun: false as const, pulled: pulled.length, created: result?.created ?? 0, updated: result?.updated ?? 0, items: [...items, ...problems.slice(0, 20)] };
}

/** Hourly: work past its time. A cleaning job becomes Overdue by the one rule (src/lib/cleanOverdue.ts: still not done at
 *  the next guest's check-in, or after midnight at the end of its day with no check-in), and its cleaner and the
 *  operations managers are told once; other tasks (an inspection) when past their due time. A repair job left open too
 *  long (urgent: a day, otherwise a week) is flagged once; finalised owner statements unsent for three days are flagged
 *  to finance. Only work that fell due in the last 7 days is announced, so old imported data does not flood anyone. */
export async function overdueSweep(env: Env, o: RunOptions = {}): Promise<JobReport> {
  const now = (o.now ?? new Date()).toISOString();
  const weekAgo = Date.parse(now) - 7 * 864e5;
  const OPEN = ['open', 'assigned', 'in_progress', 'reopened'];
  const cleans = (await overdueCleans(env, Date.parse(now))).filter(t => OPEN.includes(t.state));
  const others = await all<{ id: string; due_at: string; kind: string; state: string }>(env, `
    SELECT id, due_at, kind, state FROM tasks
    WHERE state IN ('open','assigned','in_progress','reopened') AND kind NOT IN ${CLEAN_KINDS_SQL}
      AND due_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' AND due_at::timestamptz < ?::timestamptz`, now);
  const tasks = [...cleans.map(t => ({ id: t.id, kind: t.kind, state: t.state })), ...others];
  const recentCleans = [
    ...cleans.filter(t => cleanDeadline(t.day, t.checkIn) >= weekAgo),
    ...others.filter(t => t.kind === 'inspection' && Date.parse(t.due_at) >= weekAgo),
  ];
  const repairs = await all<{ id: string; urgency: string; reported_at: string }>(env, `
    SELECT id, urgency, reported_at FROM maintenance_issues
    WHERE state IN ('open','assigned','in_progress','reopened') AND reported_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      AND reported_at::timestamptz < (?::timestamptz - CASE WHEN urgency = 'urgent' THEN interval '1 day' ELSE interval '7 days' END)
      AND reported_at::timestamptz > (?::timestamptz - interval '60 days')`, now, now);
  const stale = await all<{ id: string; owner: string; period_start: string }>(env, `
    SELECT s.id, o.display_name AS owner, s.period_start FROM owner_statements s JOIN owners o ON o.id = s.owner_id
    WHERE s.state = 'finalised' AND s.finalised_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' AND s.finalised_at::timestamptz < (?::timestamptz - interval '3 days')`, now);

  const items = [
    `${plural(tasks.length, 'task')} past due and not finished: marked Overdue; ${plural(recentCleans.length, 'cleaning job')} from the last 7 days announced`,
    `${plural(repairs.length, 'maintenance job')} open too long: announced`,
    `${plural(stale.length, 'final owner statement')} not sent after 3 days: announced to finance`,
  ];
  if (o.dryRun) return { job: 'overdue-sweep', summary: `Would mark ${plural(tasks.length, 'task')} Overdue and send notices for ${recentCleans.length + repairs.length + (stale.length ? 1 : 0)} items.`, items };

  if (tasks.length) {
    await run(env, `UPDATE tasks SET state = 'overdue', updated_at = ? WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, nowIso(), JSON.stringify(tasks.map(t => t.id)));
    await run(env, `
      INSERT INTO audit_log (actor_id, actor_label, action, entity_table, entity_id, before_state, after_state, source, occurred_at)
      SELECT NULL, 'Scheduled job', 'task.overdue', 'tasks', x.id, json_build_object('state', x.state)::text, '{"state":"overdue"}', 'system', ?
      FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, state text)`, nowIso(), JSON.stringify(tasks.map(t => ({ id: t.id, state: t.state }))));
  }
  for (const t of recentCleans) await cleaningNotice(env, t.id, 'overdue', null);
  for (const m of repairs) await repairNotice(env, m.id, 'overdue', null);
  if (stale.length) {
    await notifyUsers(env, 'finance', {
      kind: 'statement.unsent', title: `${plural(stale.length, 'owner statement')} final but not sent`,
      body: `Marked final more than 3 days ago: ${stale.slice(0, 5).map(s => s.owner).join(', ')}${stale.length > 5 ? ` and ${stale.length - 5} more` : ''}.`,
      link: '/owners?view=statements', entityTable: 'owner_statements', entityId: stale[0].id, dedupeKey: `unsent-${mytParts(new Date(now)).day}`,
    });
  }
  return { job: 'overdue-sweep', summary: `Marked ${plural(tasks.length, 'task')} Overdue; announced ${recentCleans.length} cleaning jobs, ${repairs.length} maintenance jobs, ${stale.length} unsent owner statements.`, items };
}

/** Every 5 minutes: "Guest has left" by itself at the checkout time (owner, 2 Nov 2026, reversing the 26 Oct manual-only
 *  rule): 11:00 (the standard checkout) or the late checkout's time when one is requested, e.g. 13:00. The same action
 *  and audit as a staff tap, by System; the moment recorded is the checkout time itself, in +08:00 form, which is how
 *  the board says "Auto at 13:00". Only today's checkouts not marked yet, never one staff undid (lib/guestLeft
 *  dueDepartures); a repeat run finds nothing left to do. At most 40 per run. */
export async function autoGuestLeft(env: Env, o: RunOptions = {}): Promise<JobReport> {
  const now = o.now ?? new Date();
  const due = await dueDepartures(env, now.getTime());
  const day = mytParts(now).day;
  const items = due.map(d => `${d.id}: checkout ${d.out_at}${d.late ? ' (late checkout)' : ''}${d.task_id ? '' : ', no cleaning job yet: one is created'}`);
  if (o.dryRun) return { job: 'auto-guest-left', summary: `Would mark ${plural(due.length, 'guest')} as left at their checkout time.`, items };
  let marked = 0;
  for (const d of due) {
    const task = d.task_id ? await one<any>(env, `SELECT t.id, t.unit_id, t.state, t.kind, t.reservation_id, t.assignee_id, t.guest_left_at, ? AS day FROM tasks t WHERE t.id = ?`, d.check_out, d.task_id) : null;
    const done = await markGuestLeft(env, {
      task, reservation: { id: d.id, unit_id: d.unit_id, state: d.state, check_out: d.check_out, check_out_time: d.check_out_time },
      actor: { id: null, label: 'System', source: 'system' }, leftAt: `${day}T${d.out_at}:00+08:00`, auto: true,
    });
    if (done) marked++;
  }
  return { job: 'auto-guest-left', summary: `Marked ${plural(marked, 'guest')} as left at their checkout time.`, items };
}

/** Hourly: a punch left open longer than FORGOTTEN_AFTER_HOURS is marked a forgotten clock-out, so the desk and the
 *  phone stop counting it up and payroll pays it as a normal shift. No clock-out time is made up: the office keys the real
 *  one on Attendance. The phone's next clock-in or clock-out does the same; this catches the people who do neither. */
export async function forgottenClockOuts(env: Env, o: RunOptions = {}): Promise<JobReport> {
  if (!(await hasAttendance(env))) return { job: 'forgotten-clock-outs', summary: 'Attendance is not set up on this database (migration 0166).' };
  const cutoff = new Date((o.now ?? new Date()).getTime() - FORGOTTEN_AFTER_HOURS * 3600e3).toISOString();
  const open = await all<{ id: string; employee_id: string; work_date: string; clock_in_at: string }>(env, `
    SELECT id, employee_id, work_date, clock_in_at FROM attendance WHERE clock_out_at IS NULL AND forgot_out = 0 AND clock_in_at < ?`, cutoff);
  const items = open.map(r => `${r.work_date}: employee ${r.employee_id}, in at ${r.clock_in_at}`);
  if (o.dryRun || !open.length) {
    return { job: 'forgotten-clock-outs', summary: open.length ? `Would mark ${plural(open.length, 'punch', 'punches')} as a forgotten clock-out.` : `No punch open longer than ${FORGOTTEN_AFTER_HOURS} hours.`, items };
  }
  const ids = JSON.stringify(open.map(r => r.id));
  await run(env, `UPDATE attendance SET forgot_out = 1, updated_at = ? WHERE clock_out_at IS NULL AND forgot_out = 0 AND id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, nowIso(), ids);
  await run(env, `
    INSERT INTO audit_log (actor_id, actor_label, action, entity_table, entity_id, before_state, after_state, source, occurred_at)
    SELECT NULL, 'Scheduled job', 'attendance.forgot_out', 'attendance', x, '{"forgotOut":false}', '{"forgotOut":true}', 'system', ?
    FROM jsonb_array_elements_text(?::text::jsonb) AS x`, nowIso(), ids);
  return { job: 'forgotten-clock-outs', summary: `Marked ${plural(open.length, 'punch', 'punches')} open longer than ${FORGOTTEN_AFTER_HOURS} hours as a forgotten clock-out.`, items };
}

/** Daily at 08:00 MYT: one "today" notice for operations: arrivals, departures, cleans (and how many have nobody),
 *  repairs open and repair visits today. */
export async function dailyDigest(env: Env, o: RunOptions = {}): Promise<JobReport> {
  const { day } = mytParts(o.now ?? new Date());
  // Unlike LIVE_STAY_SQL in cleaning.ts, owner stays are left out too.
  const DIGEST_GUEST_STAYS = `state NOT IN ('cancelled','no_show','inquiry') AND channel NOT IN ('maintenance_block','owner_stay')`;
  const c = await one<{ arrivals: number; departures: number; cleans: number; unassigned: number; repairs: number; urgent: number; visits: number; blocked: number }>(env, `
    SELECT
      (SELECT count(*)::int FROM reservations WHERE check_in = ? AND ${DIGEST_GUEST_STAYS}) AS arrivals,
      (SELECT count(*)::int FROM reservations WHERE check_out = ? AND ${DIGEST_GUEST_STAYS}) AS departures,
      (SELECT count(*)::int FROM tasks WHERE kind IN ${DIGEST_JOB_KINDS} AND state <> 'resolved' AND substr(coalesce(scheduled_for, due_at, ''), 1, 10) = ?) AS cleans,
      (SELECT count(*)::int FROM tasks WHERE kind IN ${DIGEST_JOB_KINDS} AND state <> 'resolved' AND substr(coalesce(scheduled_for, due_at, ''), 1, 10) = ? AND assignee_id IS NULL AND cleaner_id IS NULL) AS unassigned,
      (SELECT count(*)::int FROM maintenance_issues WHERE state <> 'resolved') AS repairs,
      (SELECT count(*)::int FROM maintenance_issues WHERE state <> 'resolved' AND urgency = 'urgent') AS urgent,
      (SELECT count(*)::int FROM maintenance_windows w JOIN maintenance_issues m ON m.id = w.issue_id WHERE m.state <> 'resolved' AND substr(w.starts_at, 1, 10) = ?) AS visits,
      (SELECT count(*)::int FROM reservations WHERE channel = 'maintenance_block' AND state NOT IN ('cancelled','no_show') AND check_in <= ? AND check_out > ?) AS blocked`,
    day, day, day, day, day, day, day);
  const x = c ?? { arrivals: 0, departures: 0, cleans: 0, unassigned: 0, repairs: 0, urgent: 0, visits: 0, blocked: 0 };
  const body = [
    // vocab-ok: x.arrivals, x.departures and x.cleans are SQL column names, not text
    `${plural(x.arrivals, 'check-in')}, ${plural(x.departures, 'checkout')}.`,
    // vocab-ok: x.arrivals, x.departures and x.cleans are SQL column names, not text
    x.cleans ? `${plural(x.cleans, 'cleaning job')}${x.unassigned ? `, ${x.unassigned} with nobody assigned` : ', all assigned'}.` : 'No cleaning jobs.',
    `${plural(x.repairs, 'maintenance job')} open${x.urgent ? ` (${x.urgent} urgent)` : ''}${x.visits ? `, ${plural(x.visits, 'visit')} today` : ''}.`,
    x.blocked ? `${plural(x.blocked, 'unit')} blocked for repairs.` : null,
  ].filter(Boolean).join(' ');
  const recipients = (await peopleWithAccess(env, 'operations', 'edit')).length;
  const items = [`To ${plural(recipients, 'person', 'people')} (management and operations): ${body}`];
  if (o.dryRun) return { job: 'daily-digest', summary: `Would send the ${day} digest.`, items };
  const r = await notifyUsers(env, { userIds: (await peopleWithAccess(env, 'operations', 'edit')).map(p => p.id) }, {
    kind: 'digest.today', title: `Today, ${Number(day.slice(8, 10))} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(day.slice(5, 7)) - 1]}`,
    body, link: '/operations/today', entityTable: 'digest', entityId: day, dedupeKey: `digest-${day}`,
  });
  return { job: 'daily-digest', summary: `Sent the ${day} digest to ${plural(r.created, 'person', 'people')}.`, items };
}

export const CRON = {
  everyMinute: '* * * * *',
  fiveMinutes: '*/5 * * * *',
  quarterHour: '*/15 * * * *',
  hourly: '0 * * * *',
  /** 00:00 UTC is 08:00 in Malaysia. */
  daily: '0 0 * * *',
} as const;

/** What each trigger runs, in order. */
export const SCHEDULE: Record<string, ((env: Env, o?: RunOptions) => Promise<JobReport>)[]> = {
  [CRON.everyMinute]: [channexOutbox, hubHealthReport],
  [CRON.fiveMinutes]: [hostplatformPull, autoGuestLeft, engineMailOutbox],
  [CRON.quarterHour]: [drainOutbox, repairBlockSweep, guestReviewSweep],
  [CRON.hourly]: [overdueSweep, forgottenClockOuts, hostplatformSweep],
  [CRON.daily]: [dailyDigest],
};

/** Every 15 minutes: Airbnb guest reviews (functions/_lib/guestReviews.ts). The auto rules write reviews for stays
 *  that checked out, then every review that is due goes to Airbnb: approved and auto ones, a Bad guest's on day 13,
 *  and failed ones tried again. With dryRun nothing is written or sent. */
export async function guestReviewSweep(env: Env, o: RunOptions = {}): Promise<JobReport> {
  const r = await runGuestReviews(env, { now: o.now, dryRun: o.dryRun });
  const did = o.dryRun ? 'Would write' : 'Wrote';
  return {
    job: 'guest-reviews',
    summary: `${did} ${plural(r.written + r.approval, 'guest review')} (${r.approval} for approval); sent ${r.sent}, ${r.waiting} waiting for Airbnb, ${r.failed} failed.`,
    items: r.items,
  };
}

export async function runJobs(env: Env, jobs: ((env: Env, o?: RunOptions) => Promise<JobReport>)[], o: RunOptions = {}): Promise<JobReport[]> {
  const out: JobReport[] = [];
  for (const job of jobs) {
    try { out.push(await job(env, o)); }
    catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      out.push({ job: job.name, summary: 'Failed.', error });
      if (!o.dryRun) {
        await run(env, `INSERT INTO audit_log (actor_id, actor_label, action, entity_table, entity_id, after_state, source, occurred_at) VALUES (NULL, 'Scheduled job', 'cron.failed', 'cron', ?, ?, 'system', ?)`,
          job.name, JSON.stringify({ error }), nowIso()).catch(() => {});
      }
    }
  }
  return out;
}
