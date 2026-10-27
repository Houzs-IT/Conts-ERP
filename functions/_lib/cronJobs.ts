import { type Env, all, one, run, audit, nowIso } from './db';
import { ensureTurnovers, replanTurnover } from './cleaning';
import { hostplatformConfigured, hostplatformProperties, hostplatformReservationPage, type HpReservation } from './hostplatform';
import { mapApiReservations } from './hostplatformImport';
import { type Db, importReservations } from './hostplatformImportDb';
import { peopleWithAccess } from './access';
import { deliver, notifyUsers, retryAt, MAX_SEND_ATTEMPTS, hasSendLease, sendLeaseUntil } from './notify';
import { flushWhenQuiet } from './channexQueue';
import { channexConfigured } from './channex';
import { cleaningNotice, repairNotice } from './notices';
import { releaseRepairBlocks } from './repairBlocks';

/**
 * The scheduled jobs, shared by the cron worker (worker/scheduled.ts) and the local dry run
 * (scripts/cron-dry-run.mjs). Every job is idempotent and reports what it did, or with dryRun what it would do,
 * without writing anything. A job that fails is reported and the others still run.
 */
export interface JobReport { job: string; summary: string; items?: string[]; error?: string }
export interface RunOptions { dryRun?: boolean; now?: Date }

const CLEAN_KINDS = `('turnover','deep_clean','light_clean','inspection')`;
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
const HP_OVERLAP_MS = 5 * 60e3;
const HP_MAX_PAGES = 40;

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
  const buildings = await hostplatformProperties(env);
  if (!buildings.ok || !buildings.body) throw new Error(`HostPlatform did not return its buildings (status ${buildings.status}).`);

  const pulled: HpReservation[] = [];
  let malformed = 0;
  for (const { id: propertyId } of buildings.body) {
    let cursor: string | null = null, pages = 0;
    do {
      const page = await hostplatformReservationPage(env, { propertyId, from: since.slice(0, 10), to: since.slice(0, 10), updatedAfter: since, cursor });
      if (!page.ok || !page.body) throw new Error(`HostPlatform refused the reservation list for ${propertyId} (status ${page.status}).`);
      pulled.push(...page.body.reservations);
      malformed += page.body.malformed;
      cursor = page.body.nextCursor;
    } while (cursor && ++pages < HP_MAX_PAGES);
    if (cursor) throw new Error(`${propertyId} has more than ${HP_MAX_PAGES * 50} changes since ${since}; nothing was saved. Use the Pull button.`);
  }
  const items = malformed ? [`${malformed} reservation(s) were missing their code, dates or unit and were left out.`] : [];
  if (o.dryRun) return { job, summary: `Would write ${plural(pulled.length, 'reservation')} HostPlatform changed since ${since}.`, items };

  const db: Db = { all: (sql, ...args) => all(env, sql, ...args) as never, run: (sql, ...args) => run(env, sql, ...args) };
  const result = pulled.length ? await importReservations(db, mapApiReservations(pulled, mytParts(startedAt).day), nowIso(), { source: 'api' }) : null;
  const { effects } = result ?? {};
  if (effects) {
    for (const id of effects.cancelled) await replanTurnover(env, id, false);
    for (const id of effects.checkoutMoved) await replanTurnover(env, id, true);
    await ensureTurnovers(env, { reservationIds: effects.live });
  }
  await run(env, `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    HP_SYNCED_KEY, startedAt.toISOString(), nowIso());
  const problems = result ? [...result.errors, ...result.skippedRows].map(e => e.reason) : [];
  // Only a run that changed something leaves a line in History: this runs every 5 minutes.
  if (result && (result.created || result.updated || effects?.cancelled.length)) {
    await audit(env, {
      actorId: null, actorLabel: 'Scheduled job', action: 'import.hostplatform.scheduled', entityTable: 'import', entityId: 'hostplatform',
      after: { since, pulled: pulled.length, created: result.created, updated: result.updated, cancelled: effects?.cancelled.length ?? 0, problems: problems.length },
    }).catch(() => {});
  }
  return {
    job, summary: pulled.length ? `Wrote ${plural(pulled.length, 'reservation')} HostPlatform changed since ${since}: ${result?.created ?? 0} new, ${result?.updated ?? 0} changed.` : `HostPlatform changed nothing since ${since}.`,
    items: [...items, ...problems.slice(0, 20)],
  };
}

/** Hourly: work past its time. A clean past its due time becomes Overdue and its cleaner and the operations managers
 *  are told once; a repair job left open too long (urgent: a day, otherwise a week) is flagged once; finalised owner
 *  statements unsent for three days are flagged to finance. Only work due in the last 7 days is announced, so the first
 *  run on old imported data does not flood anyone. */
export async function overdueSweep(env: Env, o: RunOptions = {}): Promise<JobReport> {
  const now = (o.now ?? new Date()).toISOString();
  const weekAgo = new Date(Date.parse(now) - 7 * 864e5).toISOString();
  const tasks = await all<{ id: string; due_at: string; kind: string; state: string }>(env, `
    SELECT id, due_at, kind, state FROM tasks
    WHERE state IN ('open','assigned','in_progress','reopened') AND due_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' AND due_at::timestamptz < ?::timestamptz`, now);
  const recentCleans = tasks.filter(t => Date.parse(t.due_at) >= Date.parse(weekAgo) && /^(turnover|deep_clean|light_clean|inspection)$/.test(t.kind));
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

/** Daily at 08:00 MYT: one "today" notice for operations: arrivals, departures, cleans (and how many have nobody),
 *  repairs open and repair visits today. */
export async function dailyDigest(env: Env, o: RunOptions = {}): Promise<JobReport> {
  const { day } = mytParts(o.now ?? new Date());
  const LIVE = `state NOT IN ('cancelled','no_show','inquiry') AND channel NOT IN ('maintenance_block','owner_stay')`;
  const c = await one<{ arrivals: number; departures: number; cleans: number; unassigned: number; repairs: number; urgent: number; visits: number; blocked: number }>(env, `
    SELECT
      (SELECT count(*)::int FROM reservations WHERE check_in = ? AND ${LIVE}) AS arrivals,
      (SELECT count(*)::int FROM reservations WHERE check_out = ? AND ${LIVE}) AS departures,
      (SELECT count(*)::int FROM tasks WHERE kind IN ${CLEAN_KINDS} AND state <> 'resolved' AND substr(coalesce(scheduled_for, due_at, ''), 1, 10) = ?) AS cleans,
      (SELECT count(*)::int FROM tasks WHERE kind IN ${CLEAN_KINDS} AND state <> 'resolved' AND substr(coalesce(scheduled_for, due_at, ''), 1, 10) = ? AND assignee_id IS NULL AND cleaner_id IS NULL) AS unassigned,
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
  [CRON.fiveMinutes]: [hostplatformPull],
  [CRON.quarterHour]: [drainOutbox, repairBlockSweep],
  [CRON.hourly]: [overdueSweep],
  [CRON.daily]: [dailyDigest],
};

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
