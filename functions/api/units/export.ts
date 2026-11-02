import { type Env, all, json, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { mayEditCredentials } from '../../_lib/credentials';

const joined = (value: string, where: string, name: string) => `string_agg(${value}, ' / ' ORDER BY label) FILTER (WHERE ${where}) AS "${name}"`;

/** GET /api/units/export: what the Units export adds to each unit that the units list does not carry, by unit id.
 *  Codes need the same right as a reveal and account numbers the same as the utility bills screen; anyone else gets
 *  those columns empty, so they are left out of the query. The audit log records that codes left, never the codes.
 *  shortcut: one audit row per export, so an item's "last revealed" does not show it; a row per item if that is needed. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const showCodes = mayEditCredentials(session);
  const code = (where: string, name: string) => (showCodes ? joined(`NULLIF(secret, '')`, where, name) : `NULL AS "${name}"`);
  const [access, accounts] = await Promise.all([
    all<Record<string, string | null>>(env, `
      SELECT unit_id,
             ${code(`kind IN ('smartlock_pin', 'smart_lock')`, 'mainDoorPasscode')},
             ${code(`kind = 'lockbox_pin'`, 'mailboxPasscode2')},
             ${code(`kind = 'mailbox_pin'`, 'mailboxPasscode')},
             ${joined(`regexp_replace(label, '^Mailbox no[.]* *', '', 'i')`, `kind = 'mailbox_pin'`, 'mailboxNo')},
             ${joined('label', `kind = 'wifi'`, 'wifiUsername')},
             ${code(`kind = 'wifi'`, 'wifiPassword')}
      FROM access_credentials GROUP BY unit_id`),
    session.manage ? all<Record<string, string | null>>(env, `
      SELECT unit_id,
             string_agg(account_no, ' / ' ORDER BY account_no) FILTER (WHERE kind = 'electricity') AS "electricAccount",
             string_agg(account_no, ' / ' ORDER BY account_no) FILTER (WHERE kind = 'internet') AS "wifiAccount",
             string_agg(account_no, ' / ' ORDER BY account_no) FILTER (WHERE kind = 'sewerage') AS "indahWater"
      FROM unit_utility_accounts GROUP BY unit_id`) : [],
  ]);

  const data: Record<string, Record<string, string | null>> = {};
  for (const { unit_id: unitId, ...fields } of [...access, ...accounts]) data[String(unitId)] = { ...data[String(unitId)], ...fields };

  if (showCodes) {
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'access.export', entityTable: 'access_credentials', entityId: 'units-export', after: { units: access.length } });
  }
  return json({ data });
};
