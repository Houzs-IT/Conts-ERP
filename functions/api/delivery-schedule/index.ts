import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { isScheduleStatus, isTimeSlot, toSchedulePayload, type ScheduleRow } from '../../_lib/delivery-schedule';
import { strOrNull, genId } from '../../_lib/scm-util';
import { checkDate, invalid, type Fields } from '../../_lib/validate';

const LIST_SQL = `
  SELECT s.id, s.sales_order_id, s.so_doc_no, s.customer_name, s.address, s.zone, s.planned_date, s.time_slot, s.planned_time,
         s.driver_id, s.vehicle_id, s.sequence_no, s.status, s.notes, s.dispatched_at, s.delivered_at,
         d.name AS driver_name, v.code AS vehicle_code, so.status AS so_status
  FROM delivery_schedule s
  LEFT JOIN drivers d ON d.id = s.driver_id
  LEFT JOIN vehicles v ON v.id = s.vehicle_id
  LEFT JOIN sales_orders so ON so.id = s.sales_order_id`;

/** GET /api/delivery-schedule?status=&date=&driverId=&search= */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const date = url.searchParams.get('date');
  const driverId = url.searchParams.get('driverId');
  const search = (url.searchParams.get('search') ?? '').trim();
  const where: string[] = ['1 = 1']; const args: unknown[] = [];
  if (isScheduleStatus(status)) { where.push('s.status = ?'); args.push(status); }
  if (date) { where.push('s.planned_date = ?'); args.push(date); }
  if (driverId) { where.push('s.driver_id = ?'); args.push(driverId); }
  if (search) { where.push('(lower(s.so_doc_no) LIKE ? OR lower(s.customer_name) LIKE ?)'); const q = `%${search.toLowerCase()}%`; args.push(q, q); }
  const rows = await all<ScheduleRow>(env, `${LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY s.planned_date ASC NULLS LAST, s.sequence_no ASC NULLS LAST, s.so_doc_no ASC`, ...args);
  return json({ generatedAt: nowIso(), data: rows.map(toSchedulePayload) });
};

/** POST /api/delivery-schedule { salesOrderId, plannedDate?, timeSlot?, notes? } — schedule an SO. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can schedule deliveries.', 403);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const fields: Fields = {};
  checkDate(fields, 'plannedDate', b.plannedDate, { label: 'Planned date' });
  const bad = invalid(fields); if (bad) return bad;
  const soId = String(b.salesOrderId ?? '').trim();
  const so = await one<{ id: string; doc_no: string; customer_name: string; status: string }>(env, 'SELECT id, doc_no, customer_name, status FROM sales_orders WHERE id = ?', soId);
  if (!so) return fail('VALIDATION', 'Pick a sales order.', 422, { salesOrderId: 'Unknown sales order.' });
  if (so.status === 'CANCELLED') return fail('CONFLICT', 'A cancelled sales order cannot be scheduled.', 409);
  if (await one(env, 'SELECT 1 AS x FROM delivery_schedule WHERE sales_order_id = ?', soId)) return fail('CONFLICT', 'That sales order is already on the schedule.', 409, { salesOrderId: 'Already scheduled.' });
  const plannedDate = strOrNull(b.plannedDate);
  const id = genId('dsch');
  const now = nowIso();
  await run(env, `INSERT INTO delivery_schedule (id, sales_order_id, so_doc_no, customer_name, address, zone, planned_date, time_slot, notes, status, created_by, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, soId, so.doc_no, so.customer_name, strOrNull(b.address), strOrNull(b.zone), plannedDate, isTimeSlot(b.timeSlot) ? b.timeSlot : null,
    strOrNull(b.notes), plannedDate ? 'UNPLANNED' : 'UNPLANNED', session.userId, now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'delivery_schedule.create', entityTable: 'delivery_schedule', entityId: id, after: { soId } });
  return json({ id }, 201);
};
