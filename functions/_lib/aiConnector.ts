/**
 * The AI Connector page's API (functions/api/ai-connector, src/pages/AiConnectorPage.tsx) and its "Allow?" screen
 * (src/pages/AiConnectPage.tsx). Every desk account may open it: staff see their own connections and Request access;
 * management (isMcpAdmin) approves people, sees every lookup, disconnects anyone and runs the leak check.
 * Owners, cleaners, technicians and Renovation staff never reach it: the session middleware keeps them to their apps.
 */
import { type Env, fail } from './db';
import { requireSession, type Session } from './auth';
import { mcpReady, isMcpAdmin } from './mcpStore';
import { originOf } from './mcpDiscovery';

/** The address people paste into Claude or ChatGPT. */
export const connectorUrl = (request: Request) => `${originOf(request)}/api/mcp`;

/** Signed in, a database with migration 0378, and for `admin` management. The refusal is ready to return. */
export async function connectorGate(request: Request, env: Env, admin: boolean): Promise<{ session: Session; response?: undefined } | { session?: undefined; response: Response }> {
  const { session, response } = await requireSession(request, env);
  if (!session) return { response: response! };
  if (!(await mcpReady(env))) return { response: fail('NOT_CONFIGURED', 'The AI Connector is not set up on this system yet: its database update (migration 0378) has not been applied.', 503) };
  if (admin && !isMcpAdmin({ role: session.role })) return { response: fail('FORBIDDEN', 'Only management can manage the AI Connector.', 403) };
  return { session };
}

/** "Name" for the audit log. */
export const actorOf = (s: Session) => ({ actorId: s.userId, actorLabel: s.fullName || s.email });
