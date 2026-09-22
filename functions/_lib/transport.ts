/** Transport masters (drivers, vehicles), ported from 2990's SCM. */

export interface DriverRow { id: string; driver_code: string; name: string; phone: string | null; ic_number: string | null; vehicle: string | null; active: number }
export interface VehicleRow { id: string; code: string; plate: string | null; vehicle_type: string | null; capacity_m3_milli: number; active: number; notes: string | null }

export function toDriverPayload(r: DriverRow) {
  return { id: r.id, driverCode: r.driver_code, name: r.name, phone: r.phone ?? '', icNumber: r.ic_number ?? '', vehicle: r.vehicle ?? '', active: r.active === 1 };
}
export function toVehiclePayload(r: VehicleRow) {
  return { id: r.id, code: r.code, plate: r.plate ?? '', vehicleType: r.vehicle_type ?? '', capacityM3Milli: r.capacity_m3_milli, active: r.active === 1, notes: r.notes ?? '' };
}

export function invalidDriver(b: { driverCode?: unknown; name?: unknown }): { field: string; message: string } | null {
  if (typeof b.driverCode !== 'string' || !b.driverCode.trim()) return { field: 'driverCode', message: 'Enter a driver code.' };
  if (typeof b.name !== 'string' || !b.name.trim()) return { field: 'name', message: 'Enter a name.' };
  return null;
}
export function invalidVehicle(b: { code?: unknown }): { field: string; message: string } | null {
  if (typeof b.code !== 'string' || !b.code.trim()) return { field: 'code', message: 'Enter a vehicle code.' };
  return null;
}
