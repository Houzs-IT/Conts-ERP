import { type Env, all, json, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

/** GET /api/coverage-fleet — a read-only fleet coverage overview (2990's SCM Coverage & Fleet),
 *  drawn in Conts by aggregating vehicles + open maintenance, and drivers + today's leave.
 *  No new table; a live view over the fleet masters. */
interface VRow { id: string; code: string; plate: string | null; vehicle_type: string | null; active: number; open_maint: number; overdue: number }
interface DRow { id: string; driver_code: string; name: string; phone: string | null; active: number; on_leave: boolean | number }

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const today = nowIso().slice(0, 10);

  const vehicles = await all<VRow>(env, `
    SELECT v.id, v.code, v.plate, v.vehicle_type, v.active,
           (SELECT COUNT(*) FROM fleet_maintenance_records f WHERE f.vehicle_id = v.id AND f.status = 'SCHEDULED') AS open_maint,
           (SELECT COUNT(*) FROM fleet_maintenance_records f WHERE f.vehicle_id = v.id AND f.next_due_date IS NOT NULL AND f.next_due_date < ?) AS overdue
    FROM vehicles v ORDER BY v.code`, today);

  const drivers = await all<DRow>(env, `
    SELECT d.id, d.driver_code, d.name, d.phone, d.active,
           EXISTS(SELECT 1 FROM driver_leave l WHERE l.driver_id = d.id AND l.start_date <= ? AND l.end_date >= ?) AS on_leave
    FROM drivers d ORDER BY d.name`, today, today);

  const veh = vehicles.map(v => ({
    id: v.id, code: v.code, plate: v.plate ?? '', vehicleType: v.vehicle_type ?? '', active: v.active === 1,
    openMaintenance: v.open_maint, overdue: v.overdue,
    state: v.active !== 1 ? 'INACTIVE' : (v.overdue > 0 || v.open_maint > 0) ? 'MAINTENANCE' : 'AVAILABLE',
  }));
  const drv = drivers.map(d => ({
    id: d.id, driverCode: d.driver_code, name: d.name, phone: d.phone ?? '', active: d.active === 1,
    onLeave: d.on_leave === true || d.on_leave === 1,
    state: d.active !== 1 ? 'INACTIVE' : (d.on_leave === true || d.on_leave === 1) ? 'ON_LEAVE' : 'AVAILABLE',
  }));

  return json({
    generatedAt: nowIso(),
    vehicles: veh,
    drivers: drv,
    summary: {
      vehiclesTotal: veh.length, vehiclesAvailable: veh.filter(v => v.state === 'AVAILABLE').length, vehiclesMaintenance: veh.filter(v => v.state === 'MAINTENANCE').length,
      driversTotal: drv.length, driversAvailable: drv.filter(d => d.state === 'AVAILABLE').length, driversOnLeave: drv.filter(d => d.state === 'ON_LEAVE').length,
    },
  });
};
