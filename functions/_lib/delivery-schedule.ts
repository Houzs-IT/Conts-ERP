/** Delivery scheduling (Transportation planning cluster), ported from 2990's SCM
 *  delivery-planning as a manual scheduler. One row per sales order to be delivered. */

export const SCHEDULE_STATUSES = ['UNPLANNED', 'SCHEDULED', 'DISPATCHED', 'DELIVERED', 'CANCELLED'] as const;
export const isScheduleStatus = (v: unknown): v is typeof SCHEDULE_STATUSES[number] => typeof v === 'string' && (SCHEDULE_STATUSES as readonly string[]).includes(v);
export const TIME_SLOTS = ['MORNING', 'AFTERNOON', 'EVENING'] as const;
export const isTimeSlot = (v: unknown): v is typeof TIME_SLOTS[number] => typeof v === 'string' && (TIME_SLOTS as readonly string[]).includes(v);

export interface ScheduleRow {
  id: string; sales_order_id: string; so_doc_no: string; customer_name: string; address: string | null; zone: string | null;
  planned_date: string | null; time_slot: string | null; planned_time: string | null; driver_id: string | null;
  vehicle_id: string | null; sequence_no: number | null; status: string; notes: string | null;
  dispatched_at: string | null; delivered_at: string | null;
  driver_name?: string | null; vehicle_code?: string | null; so_status?: string | null;
}

export function toSchedulePayload(r: ScheduleRow) {
  return {
    id: r.id, salesOrderId: r.sales_order_id, soDocNo: r.so_doc_no, customerName: r.customer_name, address: r.address ?? '', zone: r.zone ?? '',
    plannedDate: r.planned_date ?? '', timeSlot: r.time_slot ?? '', plannedTime: r.planned_time ?? '', driverId: r.driver_id ?? '',
    vehicleId: r.vehicle_id ?? '', sequenceNo: r.sequence_no, status: r.status, notes: r.notes ?? '',
    dispatchedAt: r.dispatched_at ?? '', deliveredAt: r.delivered_at ?? '',
    driverName: r.driver_name ?? '', vehicleCode: r.vehicle_code ?? '', soStatus: r.so_status ?? '',
  };
}

/** Derive the status from what is filled: a driver + date = SCHEDULED, else UNPLANNED. Never
 *  downgrades a dispatched/delivered/cancelled row. */
export function deriveStatus(cur: string, plannedDate: string | null, driverId: string | null): string {
  if (cur === 'DISPATCHED' || cur === 'DELIVERED' || cur === 'CANCELLED') return cur;
  return plannedDate && driverId ? 'SCHEDULED' : 'UNPLANNED';
}
