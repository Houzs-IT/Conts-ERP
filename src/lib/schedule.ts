/** Shared types + constants for the Transportation planning cluster (delivery_schedule). */

export type SchedStatus = 'UNPLANNED' | 'SCHEDULED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED';
export type TimeSlot = '' | 'MORNING' | 'AFTERNOON' | 'EVENING';

export interface Sched {
  id: string; salesOrderId: string; soDocNo: string; customerName: string; address: string; zone: string;
  plannedDate: string; timeSlot: TimeSlot; plannedTime: string; driverId: string; vehicleId: string;
  sequenceNo: number | null; status: SchedStatus; notes: string; dispatchedAt: string; deliveredAt: string;
  driverName: string; vehicleCode: string; soStatus: string;
}
export interface SchedPayload { data: Sched[]; generatedAt: string }

export const SLOT_LABEL: Record<Exclude<TimeSlot, ''>, string> = { MORNING: 'Morning', AFTERNOON: 'Afternoon', EVENING: 'Evening' };

export interface Driver { id: string; driverCode: string; name: string }
export interface Vehicle { id: string; code: string; plate: string }
export interface OpenSo { id: string; docNo: string; customerName: string; status: string }

export const DRIVERS_FALLBACK: { data: Driver[] } = { data: [
  { id: 'd1', driverCode: 'DRV-001', name: 'Ahmad Zaki' }, { id: 'd2', driverCode: 'DRV-002', name: 'Ravi Kumar' },
] };
export const VEHICLES_FALLBACK: { data: Vehicle[] } = { data: [
  { id: 'v1', code: 'LRY-01', plate: 'WXY 1234' }, { id: 'v2', code: 'LRY-02', plate: 'VBA 5678' },
] };
export const SO_FALLBACK: { data: OpenSo[] } = { data: [
  { id: 'so1', docNo: 'SO-2026-0001', customerName: 'Vista Jaya Residences', status: 'READY_TO_SHIP' },
  { id: 'so2', docNo: 'SO-2026-0004', customerName: 'Arcoris Owner', status: 'IN_PRODUCTION' },
] };

export const schedFallback = (rows: Partial<Sched>[]): SchedPayload => ({
  generatedAt: '',
  data: rows.map((r, i) => ({
    id: `s${i}`, salesOrderId: '', soDocNo: '', customerName: '', address: '', zone: '', plannedDate: '', timeSlot: '' as TimeSlot,
    plannedTime: '', driverId: '', vehicleId: '', sequenceNo: null, status: 'UNPLANNED' as SchedStatus, notes: '', dispatchedAt: '',
    deliveredAt: '', driverName: '', vehicleCode: '', soStatus: '', ...r,
  })),
});
