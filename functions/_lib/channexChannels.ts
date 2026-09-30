import { type Env, one, fail } from './db';
import { requireSession, type Session } from './auth';
import { MASTER_ROLES } from './properties';
import { channexConfigured } from './channex';

export const OTAS = ['airbnb', 'booking_com', 'agoda'] as const;
export type Ota = typeof OTAS[number];
export const OTA_LABEL: Record<Ota, string> = { airbnb: 'Airbnb', booking_com: 'Booking.com', agoda: 'Agoda' };

export interface LinkedUnit { id: string; unitNumber: string; title: string; propertyId: string; ratePlanId: string; maxGuests: number }

/** Shared gate for the channel-connection endpoints: signed in, allowed to change connections, Channex
 *  configured here, and the unit already set up in Channex. Returns the unit or the refusal to send. */
export async function linkedUnitFor(request: Request, env: Env, unitId: string): Promise<{ session: Session; unit: LinkedUnit } | { response: Response }> {
  const { session, response } = await requireSession(request, env);
  if (!session) return { response: response! };
  if (!MASTER_ROLES.includes(session.role)) return { response: fail('FORBIDDEN', 'Only management, finance and operations managers can change channel connections.', 403) };
  if (!channexConfigured(env)) return { response: fail('NOT_CONFIGURED', 'Channex is not connected on this environment yet.', 501) };
  const u = await one<{ id: string; unit_number: string; listing_name: string | null; property_name: string; max_guests: number; channex_property_id: string | null; channex_rate_plan_id: string | null }>(env, `
    SELECT u.id, u.unit_number, u.listing_name, u.max_guests, u.channex_property_id, u.channex_rate_plan_id, p.name AS property_name
    FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = ?`, unitId);
  if (!u) return { response: fail('NOT_FOUND', 'That unit does not exist.', 404) };
  if (!u.channex_property_id || !u.channex_rate_plan_id) return { response: fail('NOT_LINKED', 'Set this unit up in Channex first.', 409) };
  return { session, unit: {
    id: u.id, unitNumber: u.unit_number, title: u.listing_name?.trim() || `${u.property_name} ${u.unit_number}`,
    propertyId: u.channex_property_id, ratePlanId: u.channex_rate_plan_id, maxGuests: Math.max(1, Number(u.max_guests) || 2),
  } };
}

/** A Channex refusal as a user-safe failure; the detail goes along for support. */
export const channexRefused = (what: string, status: number, body: unknown) =>
  fail('CHANNEX_REFUSED', `Channex did not ${what} (${status}).`, 502, { detail: JSON.stringify(body ?? {}).slice(0, 300) });
