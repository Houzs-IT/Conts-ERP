import { type Env, one, run, json, fail, audit } from '../../../../_lib/db';
import { can } from '../../../../_lib/access';
import { requireSession } from '../../../../_lib/auth';

/** DELETE /api/reservations/:id/payments/:paymentId — removes a payment typed in by mistake. A payout line that came
 *  from the owner workbook is refused: it is rewritten by the next import, so it is corrected in the workbook. Audited
 *  with the whole row, so the removal can be traced and put back. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!can(session, 'finance', 'edit')) return fail('FORBIDDEN', 'Only people who can edit Finance remove payments.', 403);

  const p = await one<any>(env, 'SELECT * FROM booking_payments WHERE id = ? AND reservation_id = ?', String(params.paymentId), String(params.id));
  if (!p) return fail('NOT_FOUND', 'That payment does not exist.', 404);
  if (p.source !== 'manual') return fail('CONFLICT', 'This payout line comes from the owner workbook. Correct it in the workbook and import step 4 again.', 409);

  const receipt = await one<{ doc_no: string }>(env, `SELECT doc_no FROM issued_documents WHERE payment_id = ? AND doc_type = 'receipt' AND voided_at IS NULL`, p.id).catch(() => null);
  if (receipt) return fail('HAS_RECEIPT', `Official receipt ${receipt.doc_no} was issued for this payment. Void the receipt first, with the reason.`, 409);

  await run(env, 'DELETE FROM booking_payments WHERE id = ?', p.id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'reservation.payment_removed', entityTable: 'reservations', entityId: p.reservation_id,
    before: { paymentId: p.id, amount: Number(p.amount), kind: p.kind, receivedOn: p.received_on, method: p.method, reference: p.reference, note: p.note, createdBy: p.created_by, createdAt: p.created_at } });
  return json({ id: p.id, removed: true });
};
