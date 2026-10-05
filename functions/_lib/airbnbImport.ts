import { type Env, one, fail } from './db';
import { requireSession, type Session } from './auth';
import { MASTER_ROLES } from './properties';
import { channexConfigured, channexListChannels } from './channex';

/** The account's Airbnb connection in Channex. One Airbnb account is one channel shared by every unit,
 *  so a linked unit already names it; before the first listing is linked it is looked up in Channex. */
export async function airbnbChannelId(env: Env): Promise<string | null> {
  const row = await one<{ channex_channel_id: string }>(env, "SELECT channex_channel_id FROM channex_channels WHERE ota = 'airbnb' ORDER BY created_at LIMIT 1");
  if (row) return row.channex_channel_id;
  const r = await channexListChannels(env);
  const found = (r.body?.data ?? []).find(c => String(c.attributes?.channel ?? '').toLowerCase() === 'airbnb');
  return found?.id ?? null;
}

/** Shared gate for the Airbnb import endpoints. */
export async function importGate(request: Request, env: Env): Promise<{ session: Session } | { response: Response }> {
  const { session, response } = await requireSession(request, env);
  if (!session) return { response: response! };
  if (!MASTER_ROLES.includes(session.role)) return { response: fail('FORBIDDEN', 'Only management, finance and operations managers can change channel connections.', 403) };
  if (!channexConfigured(env)) return { response: fail('NOT_CONFIGURED', 'Channex is not connected on this environment yet.', 501) };
  return { session };
}

/** Airbnb sends prices in whole currency units; Conts keeps integer sen. */
export const toSen = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};
