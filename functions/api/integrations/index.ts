import { mayRun } from '../../_lib/access';
import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { channexConfigured } from '../../_lib/channex';
import { hostplatformConfigured } from '../../_lib/hostplatform';

const MANAGE = ['management']; // everyone else follows the area's level (mayWork / maySee / mayRun)
/** Same key the scheduled pull writes (cronJobs.ts HP_SYNCED_KEY). */
const HP_SYNCED_KEY = 'hostplatform.synced_at';
const HP_STALE_MS = 30 * 60e3;
const OTA_PROVIDERS = ['airbnb', 'booking_com', 'agoda'];

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const rows = await all<any>(env, `
    SELECT i.id, i.provider, i.state, i.last_synced_at, i.last_error, i.credentials,
           (SELECT COUNT(*) FROM unit_channels c WHERE c.channel = i.provider AND c.is_active = 1) AS units_linked
    FROM integrations i ORDER BY i.provider`);


  // Airbnb, Booking.com and Agoda are connected per unit through Channex, so their cards are worked out from
  // the real connections (channex_channels) and the outbox, never from the stored sample status.
  const configured = channexConfigured(env);
  const linked = await all<{ ota: string; n: number }>(env, 'SELECT ota, count(*)::int AS n FROM channex_channels GROUP BY ota');
  const failed = await all<{ ota: string; n: number }>(env, `
    SELECT c.ota, count(*)::int AS n FROM channex_outbox o JOIN channex_channels c ON c.unit_id = o.unit_id WHERE o.status = 'failed' GROUP BY c.ota`);
  const lastSent = await one<{ at: string | null }>(env, 'SELECT max(called_at) AS at FROM channex_calls WHERE status BETWEEN 200 AND 299');
  const ota = (provider: string) => {
    const units = Number(linked.find(l => l.ota === provider)?.n ?? 0);
    const refused = Number(failed.find(f => f.ota === provider)?.n ?? 0);
    return {
      state: !configured || units === 0 ? 'not_connected' : refused ? 'degraded' : 'connected',
      lastSyncedAt: units ? lastSent?.at ?? null : null,
      lastError: units && refused ? `${refused} ${refused === 1 ? 'update was' : 'updates were'} refused by Channex. See Channex updates above.` : null,
      unitsLinked: units, syncInterval: 'As changes happen', credentialMasked: null, viaChannex: true,
    };
  };

  // Email and WhatsApp: whether the key is set on this environment, and what the message log says, never the
  // seeded "connected" rows (UI audit A21). The bank has no connection at all: payouts are made at the bank by hand.
  const e = env as unknown as Record<string, string | undefined>;
  const sends = await all<{ channel: string; last_sent: string | null; failed: number; last_error: string | null }>(env, `
    SELECT channel, max(sent_at) FILTER (WHERE state = 'sent') AS last_sent,
           count(*) FILTER (WHERE state = 'failed' AND queued_at >= ?)::int AS failed,
           (SELECT n.error FROM notification_log n WHERE n.channel = l.channel AND n.state = 'failed' ORDER BY n.queued_at DESC LIMIT 1) AS last_error
    FROM notification_log l WHERE channel IN ('email', 'whatsapp') GROUP BY channel`, new Date(Date.now() - 7 * 864e5).toISOString());
  const messaging = (channel: 'email' | 'whatsapp', configured: boolean) => {
    const x = sends.find(r => r.channel === channel);
    const failedN = Number(x?.failed ?? 0);
    return {
      state: !configured ? 'not_connected' : failedN ? 'degraded' : 'connected',
      lastSyncedAt: x?.last_sent ?? null,
      lastError: failedN ? `${failedN} ${failedN === 1 ? 'message' : 'messages'} failed in the last 7 days${x?.last_error ? `: ${x.last_error}` : '.'}` : null,
      unitsLinked: 0, syncInterval: 'As messages are sent', credentialMasked: null,
      detail: configured ? null : channel === 'email'
        ? 'The email key (MAIL_API_KEY, Resend) is not set on this environment, so statement, payout and invite emails are not delivered. Management adds it once in Cloudflare.'
        : 'The WhatsApp Business keys (WHATSAPP_TOKEN and WHATSAPP_PHONE_ID) are not set, so WhatsApp messages to direct guests wait to send. Management adds them once in Cloudflare.',
    };
  };

  // HostPlatform: whether its keys are set here, and when the 5-minute pull last finished a whole run. A pull that has
  // not finished for 30 minutes (six runs) is shown as slow, so a silent failure of the job does not read as healthy.
  const hpConfigured = hostplatformConfigured(env);
  const hpAt = (await one<{ value: string }>(env, 'SELECT value FROM settings WHERE key = ?', HP_SYNCED_KEY))?.value ?? null;
  const hpAgeMs = hpAt ? Date.now() - Date.parse(hpAt) : Infinity;
  const hostplatform = {
    id: 'hostplatform', provider: 'hostplatform',
    state: !hpConfigured ? 'not_connected' : hpAgeMs > HP_STALE_MS ? 'degraded' : 'connected',
    lastSyncedAt: hpAt,
    lastError: hpConfigured && hpAgeMs > HP_STALE_MS ? (hpAt ? 'The last full check was more than 30 minutes ago.' : 'No check has finished yet.') + ' See Import from HostPlatform to pull by hand.' : null,
    unitsLinked: 0, syncInterval: 'Every 5 minutes', credentialMasked: null,
    detail: hpConfigured ? null : 'The HostPlatform keys (HOSTPLATFORM_BASE_URL and HOSTPLATFORM_ACCESS_TOKEN) are not set on this environment, so reservations are not pulled. Management adds them once in Cloudflare.',
  };

  // Credentials are never serialised, at any role.
  const out = rows.filter(r => r.provider !== 'whatsapp' && r.provider !== 'maybank').map(r => OTA_PROVIDERS.includes(r.provider) ? { id: r.id, provider: r.provider, ...ota(r.provider) } : {
    id: r.id, provider: r.provider, state: 'manual',
    lastSyncedAt: null, lastError: null, unitsLinked: Number(r.units_linked), syncInterval: null, credentialMasked: null,
  });
  return json({
    generatedAt: new Date().toISOString(),
    data: [
      ...out,
      hostplatform,
      { id: 'email', provider: 'email', ...messaging('email', !!e.MAIL_API_KEY) },
      { id: 'whatsapp', provider: 'whatsapp', ...messaging('whatsapp', !!(e.WHATSAPP_TOKEN && e.WHATSAPP_PHONE_ID)) },
      { id: 'bank', provider: 'bank', state: 'manual', lastSyncedAt: null, lastError: null, unitsLinked: 0, syncInterval: null, credentialMasked: null,
        detail: 'Not connected to a bank. Owner payouts are transferred in the bank’s own system, then recorded on Owners > Payouts (Start payout run, then Mark paid).' },
    ],
  });
};

/** PATCH — record a reconnection. The OAuth round-trip happens elsewhere; this
 *  only moves the state once the provider has confirmed. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayRun(session, MANAGE)) {
    return fail('FORBIDDEN', 'You can see connection status but cannot change it. Ask an operations manager.', 403);
  }

  const { id, state } = await request.json<{ id: string; state: string }>();
  if (!['connected', 'expired', 'degraded', 'failed'].includes(state)) {
    return fail('VALIDATION', 'Unknown connection state.', 422);
  }

  const before = await one<any>(env, 'SELECT provider, state FROM integrations WHERE id = ?', id);
  if (!before) return fail('NOT_FOUND', 'That integration is not configured.', 404);

  await run(env, 'UPDATE integrations SET state = ?, last_synced_at = ?, last_error = ? WHERE id = ?',
    state, state === 'connected' ? nowIso() : null, state === 'connected' ? null : before.last_error, id);

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'integration.' + state,
    entityTable: 'integrations', entityId: id,
    before: { state: before.state }, after: { state },
  });
  return json({ ok: true });
};
