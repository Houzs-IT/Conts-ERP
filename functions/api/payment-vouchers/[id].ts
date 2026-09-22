import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { toPvHeaderPayload, toPvAllocPayload, type PvHeaderRow, type PvAllocRow } from '../../_lib/payment-vouchers';
import { recomputePiStatus } from '../../_lib/purchase-invoices';

const HEADER_SQL = `
  SELECT pv.id, pv.voucher_number, pv.supplier_id, pv.payment_date, pv.method, pv.reference, pv.amount_sen, pv.notes,
         pv.status, pv.created_at, pv.updated_at, s.code AS supplier_code, s.name AS supplier_name
  FROM payment_vouchers pv JOIN suppliers s ON s.id = pv.supplier_id WHERE pv.id = ?`;

/** GET /api/payment-vouchers/:id — header + allocations. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const id = String(params.id);
  const header = await one<PvHeaderRow>(env, HEADER_SQL, id);
  if (!header) return fail('NOT_FOUND', 'That payment voucher does not exist.', 404);
  const allocs = await all<PvAllocRow>(env, `SELECT a.id, a.purchase_invoice_id, a.amount_sen, pi.invoice_number, pi.total_sen AS invoice_total_sen
    FROM payment_voucher_allocations a JOIN purchase_invoices pi ON pi.id = a.purchase_invoice_id WHERE a.voucher_id = ?`, id);
  return json({ data: { ...toPvHeaderPayload(header), allocations: allocs.map(toPvAllocPayload) } });
};

/** PATCH /api/payment-vouchers/:id — cancel (reverses each allocation's paid_sen). */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can change payment vouchers.', 403);

  const id = String(params.id);
  const cur = await one<{ status: string }>(env, 'SELECT status FROM payment_vouchers WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That payment voucher does not exist.', 404);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  if (b.status !== 'CANCELLED') return fail('VALIDATION', 'Only CANCELLED is accepted.', 422);
  if (cur.status === 'CANCELLED') return json({ id });

  const allocs = await all<{ purchase_invoice_id: string; amount_sen: number }>(env, 'SELECT purchase_invoice_id, amount_sen FROM payment_voucher_allocations WHERE voucher_id = ?', id);
  const now = nowIso();
  for (const a of allocs) {
    await run(env, 'UPDATE purchase_invoices SET paid_sen = GREATEST(0, paid_sen - ?), updated_at = ? WHERE id = ?', a.amount_sen, now, a.purchase_invoice_id);
    await recomputePiStatus(env, a.purchase_invoice_id);
  }
  await run(env, 'UPDATE payment_vouchers SET status = ?, updated_at = ? WHERE id = ?', 'CANCELLED', now, id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'payment_voucher.cancel', entityTable: 'payment_vouchers', entityId: id });
  return json({ id });
};
