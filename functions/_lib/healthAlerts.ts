import { type Env, all, run, nowIso } from './db';
import { notifyUsers } from './notify';
import type { Check } from './systemHealth';

/**
 * Emails management when a System health card turns red, and again when it is back to normal (CONTS-0005: Host
 * Platform warned of the 22 Oct Booking.com outage at once; Conts said nothing until someone opened the page).
 * Runs on the 5-minute health report (functions/api/system/health/hub-report.ts), so it needs no worker of its own.
 *
 * A card of our own must be red on two reports in a row, ten minutes, before anyone is told: one slow answer from
 * Channex is not an outage worth an email. A channel the channels' own status page names as down or having
 * problems is told on the first report, since a person published it. Each card's last state is kept in settings
 * under health.alert.<key> (the Settings screen reads only its own keys), so an incident is announced once and
 * its end once, whichever browser or worker measured it.
 */
const PREFIX = 'health.alert.';
const REPORTS_BEFORE_ALERT = 2;

export interface Seen { bad: boolean; reports: number; since: string; alerted: boolean }

/** Red, or for the channels' own status, having problems. */
export const isAlarm = (c: Check) => c.status === 'critical' || (c.key === 'channels' && c.status === 'warning');

/** What one more report does to a card's state, and what to send. Pure, so the rule can be checked on its own. */
export function step(prev: Seen | null, c: Check, now: string): { next: Seen; send: 'alert' | 'recovered' | null } {
  if (isAlarm(c)) {
    const reports = prev?.bad ? prev.reports + 1 : 1;
    const since = prev?.bad ? prev.since : now;
    const alerted = prev?.bad ? prev.alerted : false;
    const due = !alerted && reports >= (c.key === 'channels' ? 1 : REPORTS_BEFORE_ALERT);
    return { next: { bad: true, reports, since, alerted: alerted || due }, send: due ? 'alert' : null };
  }
  const next = { bad: false, reports: 0, since: prev?.bad ? now : prev?.since ?? now, alerted: false };
  return { next, send: prev?.bad && prev.alerted ? 'recovered' : null };
}

const myt = (iso: string) => {
  const t = new Date(Date.parse(iso) + 8 * 3600e3).toISOString();
  return `${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 16)}`;
};

/** Compares this report's cards with the last ones and tells management what changed. Never throws: the health
 *  report it rides on must still go out. Returns what was sent, for the report's own answer. */
export async function alertOnChanges(env: Env, checks: Check[], origin: string): Promise<string[]> {
  try {
    const rows = await all<{ key: string; value: string }>(env, `SELECT key, value FROM settings WHERE key LIKE '${PREFIX}%'`);
    const seen = new Map(rows.map(r => {
      // A row that cannot be read starts that card afresh rather than stopping the others.
      try { return [r.key.slice(PREFIX.length), JSON.parse(r.value) as Seen] as const; } catch { return [r.key.slice(PREFIX.length), null] as const; }
    }));
    const now = nowIso();
    const page = `${origin}/system/health`;
    const changed: { key: string; value: string; updated_at: string }[] = [];
    const sent: string[] = [];
    for (const c of checks) {
      const prev = seen.get(c.key) ?? null;
      const { next, send } = step(prev, c, now);
      if (JSON.stringify(next) !== JSON.stringify(prev)) changed.push({ key: `${PREFIX}${c.key}`, value: JSON.stringify(next), updated_at: now });
      if (!send) continue;
      const channel = c.key === 'channels';
      const title = send === 'alert'
        ? (channel ? `Channel problem: ${c.summary}` : `System health: ${c.label} needs attention`)
        : (channel ? 'Channels are working again' : `System health: ${c.label} is working again`);
      const body = send === 'alert'
        ? [`${c.summary}.`, c.detail, `Since ${myt(next.since)} (Malaysia time). See ${page}`].filter(Boolean).join('\n\n')
        : `Back to normal at ${myt(now)} (Malaysia time), after it started at ${myt(prev!.since)}. See ${page}`;
      // notifyUsers is quiet by design (it records its own failure); a send here is rare, one per incident edge.
      await notifyUsers(env, { roles: ['management'] }, {
        kind: send === 'alert' ? 'health.alert' : 'health.recovered', title, body, link: '/system/health',
        entityTable: 'system_health', entityId: c.key, dedupeKey: `health:${c.key}:${send === 'alert' ? next.since : `${prev!.since}:ok`}`, email: true,
      });
      sent.push(`${send}: ${c.label}`);
    }
    if (changed.length) {
      await run(env, `
        INSERT INTO settings (key, value, updated_at)
        SELECT x.key, x.value, x.updated_at FROM jsonb_to_recordset(?::text::jsonb) AS x(key text, value text, updated_at text)
        ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, JSON.stringify(changed));
    }
    return sent;
  } catch (e) {
    console.error('Health alerts not checked', e instanceof Error ? e.message : e);
    return [];
  }
}
