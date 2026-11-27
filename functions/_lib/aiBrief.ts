/**
 * The AI Connector page's "Morning brief & urgent alerts by email" section (functions/api/ai-connector/brief*,
 * src/pages/AiBriefSettings.tsx). Each person opts in for themselves; nothing here reads or changes anyone else's row.
 */
import { type Env, fail, one } from './db';
import { connectorGate } from './aiConnector';
import { hasMcpAccess } from './mcpStore';
import { proactiveReady } from './mcpProactiveStore';
import type { Session } from './auth';

export interface BriefPerson { session: Session; userId: string; name: string; email: string; allowed: boolean }

/** Signed in, migrations 0378 and 0397 in, and the person's own account (session.userId). `needAllowed`: refused unless
 *  the AI Connector is on for them (approved, or management). */
export async function briefGate(request: Request, env: Env, needAllowed: boolean): Promise<{ person: BriefPerson; response?: undefined } | { person?: undefined; response: Response }> {
  const gate = await connectorGate(request, env, false);
  if (gate.response) return { response: gate.response };
  const { session } = gate;
  if (!(await proactiveReady(env))) return { response: fail('NOT_CONFIGURED', 'The morning brief is not set up on this system yet: its database update (migration 0397) has not been applied.', 503) };
  const u = await one<{ email: string; full_name: string }>(env, 'SELECT email, full_name FROM users WHERE id = ?', session.userId);
  const allowed = await hasMcpAccess(env, { id: session.userId, role: session.role });
  if (needAllowed && !allowed) return { response: fail('FORBIDDEN', 'The AI Connector is not turned on for your account. Request access first.', 403) };
  return { person: { session, userId: session.userId, name: (u?.full_name ?? session.fullName ?? '').trim(), email: (u?.email ?? '').trim(), allowed } };
}

/** "Check every 15 minutes ..." in words, for the settings section. */
export const SCHEDULE_WORDS = 'Checked every 15 minutes by the ERP\'s scheduled jobs. The brief goes out on the first check at or after your time (skipped if more than 4 hours late); alerts are checked 7:00 to 20:00 Malaysia time.';
