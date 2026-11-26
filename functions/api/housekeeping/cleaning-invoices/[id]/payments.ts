import { type Env, json, fail, audit } from '../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../_lib/auth';
import { fileToUpload, forwardClaims } from '../../../../_lib/claimsForward';
import { knownInvoice } from '../../../../_lib/cleaningBilling';

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MAX_SLIP = 10 * 1024 * 1024;

/** POST /api/housekeeping/cleaning-invoices/:id/payments (multipart: paidAt, method cash|transfer, amount in sen, note?, slip)
 *  What the client paid on a cleaning invoice. It waits for finance: the engine records it with a draft receipt and
 *  posts nothing until finance confirms the money against the bank (Official receipts), which makes the receipt formal
 *  and books it. A transfer needs its slip. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Client payments are recorded by the office.', 403);
  const id = String(params.id);
  const known = await knownInvoice(env, id);
  if (!known) return fail('NOT_FOUND', 'No cleaning job is billed on that invoice.', 404);
  const form = await request.formData().catch(() => null);
  if (!form) return fail('VALIDATION', 'Send the payment as a form.', 422);
  const paidAt = String(form.get('paidAt') ?? '');
  const method = String(form.get('method') ?? '');
  const amountSen = Number(form.get('amount'));
  const fields: Record<string, string> = {};
  if (!DAY.test(paidAt)) fields.paidAt = 'Enter the day the client paid.';
  if (method !== 'cash' && method !== 'transfer') fields.method = 'Pick cash or bank transfer.';
  if (!Number.isSafeInteger(amountSen) || amountSen <= 0) fields.amount = 'Enter the amount paid.';
  const file = form.get('slip');
  const slip = file instanceof File && file.size > 0 ? file : null;
  if (method === 'transfer' && !slip) fields.slip = 'Attach the transfer slip.';
  if (slip && slip.size > MAX_SLIP) fields.slip = 'The slip is over 10 MB.';
  if (Object.keys(fields).length) return fail('VALIDATION', Object.values(fields)[0], 422, fields);

  const res = await forwardClaims(env, session, 'POST', `/cleaning-invoices/${encodeURIComponent(id)}/payments`, {
    paidAt, method, amountSen, note: String(form.get('note') ?? '').trim().slice(0, 300) || null, slip: slip ? await fileToUpload(slip) : null,
  });
  if (!res.ok) return res;
  const data = await res.json<{ invoice?: unknown }>().catch(() => null);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'cleaning.payment', entityTable: 'tasks', entityId: id,
    after: { invoiceNo: known.invoiceNo, paidAt, method, amountSen, slip: !!slip } });
  return json(data ?? {}, res.status);
};
