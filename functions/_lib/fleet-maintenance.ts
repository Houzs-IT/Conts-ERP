/** Fleet Health, ported from 2990's SCM fleet-maintenance (core). Per-vehicle service log. */

export const FLEET_RECORD_TYPES = ['SERVICE', 'REPAIR', 'INSPECTION', 'TYRE', 'ROAD_TAX', 'INSURANCE', 'OTHER'] as const;
export const isFleetRecordType = (v: unknown): v is typeof FLEET_RECORD_TYPES[number] => typeof v === 'string' && (FLEET_RECORD_TYPES as readonly string[]).includes(v);

export interface FleetRecordRow {
  id: string; vehicle_id: string; record_type: string; service_date: string; odometer_km: number | null; cost_sen: number;
  next_due_date: string | null; next_due_km: number | null; status: string; vendor: string | null; notes: string | null;
  vehicle_code?: string | null; vehicle_plate?: string | null;
}

export function toFleetRecordPayload(r: FleetRecordRow) {
  return {
    id: r.id, vehicleId: r.vehicle_id, recordType: r.record_type, serviceDate: r.service_date, odometerKm: r.odometer_km,
    costSen: r.cost_sen, nextDueDate: r.next_due_date ?? '', nextDueKm: r.next_due_km, status: r.status,
    vendor: r.vendor ?? '', notes: r.notes ?? '', vehicleCode: r.vehicle_code ?? '', vehiclePlate: r.vehicle_plate ?? '',
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function invalidFleetRecord(b: { vehicleId?: unknown; serviceDate?: unknown; recordType?: unknown }): { field: string; message: string } | null {
  if (typeof b.vehicleId !== 'string' || !b.vehicleId.trim()) return { field: 'vehicleId', message: 'Pick a vehicle.' };
  if (typeof b.serviceDate !== 'string' || !ISO_DATE.test(b.serviceDate)) return { field: 'serviceDate', message: 'Enter a service date.' };
  if (b.recordType !== undefined && !isFleetRecordType(b.recordType)) return { field: 'recordType', message: 'Unknown record type.' };
  return null;
}
