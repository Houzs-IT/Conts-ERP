import { type Env, all, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

const MANAGE = ['management'];

/** Organisation-wide defaults. Stored as key/value so adding one does not need
 *  a migration, but every key is documented in copy.md. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const rows = await all<{ key: string; value: string }>(env, 'SELECT key, value FROM settings');
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));

  return json({
    generatedAt: new Date().toISOString(),
    organisation: {
      legalName: map['org.legal_name'] ?? 'The Conts Sdn Bhd',
      companyNumber: map['org.company_number'] ?? '202301027399 (1521322-V)',
      address: map['org.address'] ?? 'C-41-06, Jaya One, Jalan Universiti, 46200 Petaling Jaya',
      supportPhone: map['org.support_phone'] ?? '+60 17-465 8868',
    },
    locale: {
      default: map['locale.default'] ?? 'en-MY',
      timezone: map['locale.timezone'] ?? 'Asia/Kuala_Lumpur',
      currency: map['locale.currency'] ?? 'MYR',
    },
    finance: {
      defaultManagementFeePct: Number(map['finance.default_fee_pct'] ?? 25),
      statementPeriod: map['finance.statement_period'] ?? 'Calendar month, finalised on the 1st',
    },
    operations: {
      checkIn: map['ops.check_in'] ?? '15:00',
      checkOut: map['ops.check_out'] ?? '11:00',
      turnoverSlaHours: Number(map['ops.turnover_sla_hours'] ?? 4),
      photoRequiredToMarkReady: (map['ops.photo_required'] ?? 'true') === 'true',
    },
  });
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MANAGE.includes(session.role)) {
    return fail('FORBIDDEN', 'Only management can change organisation settings.', 403);
  }

  const patch = await request.json<Record<string, string>>();
  for (const [key, value] of Object.entries(patch)) {
    await run(env,
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      key, String(value), nowIso());
  }

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'settings.update',
    entityTable: 'settings', entityId: 'organisation', after: patch,
  });
  return json({ ok: true });
};
