/** Driver Leave, ported from 2990's SCM. Dated leave periods per driver (drivers-only —
 *  Conts has no helpers module). */

export interface DriverLeaveRow {
  id: string; driver_id: string; start_date: string; end_date: string; reason: string | null;
  driver_code?: string | null; driver_name?: string | null;
}

export function toDriverLeavePayload(r: DriverLeaveRow) {
  return {
    id: r.id, driverId: r.driver_id, startDate: (r.start_date ?? '').slice(0, 10), endDate: (r.end_date ?? '').slice(0, 10),
    reason: r.reason ?? '', driverCode: r.driver_code ?? '', driverName: r.driver_name ?? '',
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function invalidLeave(b: { driverId?: unknown; startDate?: unknown; endDate?: unknown }): { field: string; message: string } | null {
  if (typeof b.driverId !== 'string' || !b.driverId.trim()) return { field: 'driverId', message: 'Pick a driver.' };
  if (typeof b.startDate !== 'string' || !ISO_DATE.test(b.startDate)) return { field: 'startDate', message: 'Enter a start date.' };
  if (typeof b.endDate !== 'string' || !ISO_DATE.test(b.endDate)) return { field: 'endDate', message: 'Enter an end date.' };
  if (b.endDate < b.startDate) return { field: 'endDate', message: 'The end date is before the start date.' };
  return null;
}
