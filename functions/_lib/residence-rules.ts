/** Delivery Residence Rules, ported from 2990's SCM. Per-building-type delivery config. */

export interface ResRuleRow {
  id: string; building_type: string; service_duration_minutes: number; earliest_delivery_time: string | null;
  latest_delivery_time: string | null; requires_lift_booking: number; requires_registration: number;
  notes: string | null; is_active: number;
}

export function toResRulePayload(r: ResRuleRow) {
  return {
    id: r.id, buildingType: r.building_type, serviceDurationMinutes: r.service_duration_minutes,
    earliestDeliveryTime: r.earliest_delivery_time ?? '', latestDeliveryTime: r.latest_delivery_time ?? '',
    requiresLiftBooking: r.requires_lift_booking === 1, requiresRegistration: r.requires_registration === 1,
    notes: r.notes ?? '', isActive: r.is_active === 1,
  };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function invalidResRule(b: { buildingType?: unknown; earliestDeliveryTime?: unknown; latestDeliveryTime?: unknown }): { field: string; message: string } | null {
  if (typeof b.buildingType !== 'string' || !b.buildingType.trim()) return { field: 'buildingType', message: 'Enter a building type.' };
  for (const [k, label] of [['earliestDeliveryTime', 'Earliest'], ['latestDeliveryTime', 'Latest']] as const) {
    const v = (b as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.trim() && !HHMM.test(v.trim())) return { field: k, message: `${label} time must be HH:MM.` };
  }
  return null;
}
