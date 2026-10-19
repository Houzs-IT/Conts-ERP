import { type Env, one, fail, json } from './db';
import { requireSession, isFieldRole, type Session } from './auth';
import { MASTER_ROLES } from './properties';
import { channexConfigured, channexTestConnection, channexMappingDetails, type HotelOta } from './channex';
import { purposeOf, NOT_ON_CHANNELS } from './unitPurpose';

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
  if ((await purposeOf(env, unitId)) !== 'rental') return { response: fail('NOT_RENTAL', NOT_ON_CHANNELS, 409) };
  if (!u.channex_property_id || !u.channex_rate_plan_id) return { response: fail('NOT_LINKED', 'Set this unit up in Channex first.', 409) };
  return { session, unit: {
    id: u.id, unitNumber: u.unit_number, title: u.listing_name?.trim() || `${u.property_name} ${u.unit_number}`,
    propertyId: u.channex_property_id, ratePlanId: u.channex_rate_plan_id, maxGuests: Math.max(1, Number(u.max_guests) || 2),
  } };
}

/** A Channex refusal as a user-safe failure; the detail goes along for support. */
export const channexRefused = (what: string, status: number, body: unknown) =>
  fail('CHANNEX_REFUSED', `Channex did not ${what} (${status}).`, 502, { detail: JSON.stringify(body ?? {}).slice(0, 300) });

/** Checks a Booking.com or Agoda Hotel ID with Channex and answers with the rooms and rates that hotel has on the OTA. */
export async function hotelRooms(env: Env, b: any): Promise<Response> {
  const ota = b?.ota as HotelOta;
  if (ota !== 'booking_com' && ota !== 'agoda') return fail('VALIDATION', 'Pick Booking.com or Agoda.', 422);
  const hotelId = String(b?.hotelId ?? '').trim();
  if (!/^\d{3,12}$/.test(hotelId)) return fail('VALIDATION', 'Enter the Hotel ID (numbers only).', 422, { hotelId: 'Numbers only.' });

  const test = await channexTestConnection(env, ota, hotelId);
  // vocab-ok: OTA_LABEL is a code name; the text shows the channel name
  if (!test.ok) return channexRefused(`check the ${OTA_LABEL[ota]} Hotel ID`, test.status, test.body);
  if (!test.body?.data?.success) {
    // vocab-ok: OTA_LABEL is a code name; the text shows the channel name
    return fail('HOTEL_NOT_READY', `${OTA_LABEL[ota]} did not accept Hotel ID ${hotelId}. Check the number, and that Channex is chosen as the channel manager in the ${OTA_LABEL[ota]} extranet.`, 422,
      { detail: JSON.stringify(test.body?.data?.errors ?? {}).slice(0, 300) });
  }
  const details = await channexMappingDetails(env, ota, hotelId);
  // vocab-ok: OTA_LABEL is a code name; room is the Booking.com/Agoda word on the linking screen
  if (!details.ok) return channexRefused(`read the ${OTA_LABEL[ota]} rooms`, details.status, details.body);
  const d = details.body?.data ?? {};
  return json({
    pricingType: d.pricing_type ?? 'Standard',
    rooms: (d.rooms ?? []).map((r: any) => ({
      id: String(r.id), title: r.title,
      rates: (r.rates ?? []).map((x: any) => ({ id: String(x.id), title: x.title, maxPersons: x.max_persons ?? null, pricing: x.pricing ?? d.pricing_type ?? 'Standard', readonly: !!x.readonly })),
    })),
  });
}

export interface ChannexBuilding { id: string; name: string; channex_property_id: string | null }

/** Signed in, allowed to change connections, Channex configured here, and the building has its Channex listing. */
export async function buildingFor(request: Request, env: Env, id: string): Promise<{ session: Session; building: ChannexBuilding } | { response: Response }> {
  const { session, response } = await requireSession(request, env);
  if (!session) return { response: response! };
  if (!MASTER_ROLES.includes(session.role) || isFieldRole(session.role)) return { response: fail('FORBIDDEN', 'Only management, finance and operations managers can change channel connections.', 403) };
  if (!channexConfigured(env)) return { response: fail('NOT_CONFIGURED', 'Channex is not connected on this environment yet.', 501) };
  const building = await one<ChannexBuilding>(env, 'SELECT id, name, channex_property_id FROM properties WHERE id = ?', id);
  if (!building) return { response: fail('NOT_FOUND', 'That building does not exist.', 404) };
  if (!building.channex_property_id) return { response: fail('NOT_LINKED', "Set one of this building's units up in Channex first; that creates the building's listing.", 409) };
  return { session, building };
}
