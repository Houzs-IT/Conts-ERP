import { type Env, all, one, run, json, fail, nowIso, audit, mytToday } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { nextVoucherNumber, toPvHeaderPayload, PV_METHODS, type PvHeaderRow } from '../../_lib/payment-vouchers';
import { recomputePiStatus } from '../../_lib/purchase-invoices';
import { strOrNull, intOrNull, genId } from '../../_lib/scm-util';
import { checkDate, checkSen, invalid, type Fields } from '../../_lib/validate';

const LIST_SQL = `
  SELECT pv.id, pv.voucher_number, pv.supplier_id, pv.payment_date, pv.method, pv.reference, pv.amount_sen, pv.notes,
         pv.status, pv.created_at, pv.updated_at, s.code AS supplier_code, s.name AS supplier_name
  FROM payment_vouchers pv JOIN suppliers s ON s.id = pv.supplier_id`;

/** GET /api/payment-vouchers?status=&supplierId=&search= */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const supplierId = url.searchParams.get('supplierId');
  const search = (url.searchParams.get('search') ?? '').trim();

  const where: string[] = ['1 = 1'];
  const args: unknown[] = [];
  if (status === 'POSTED' || status === 'CANCELLED') { where.push('pv.status = ?'); args.push(status); }
  if (supplierId) { where.push('pv.supplier_id = ?'); args.push(supplierId); }
  if (search) { where.push('(lower(pv.voucher_number) LIKE ? OR lower(coalesce(pv.reference, \'\')) LIKE ? OR lower(s.name) LIKE ?)'); const q = `%${search.toLowerCase()}%`; args.push(q, q, q); }

  const rows = await all<PvHeaderRow>(env, `${LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY pv.payment_date DESC, pv.voucher_number DESC`, ...args);
  return json({ generatedAt: nowIso(), data: rows.map(toPvHeaderPayload) });
};

/** POST /api/payment-vouchers { supplierId, paymentDate?, method?, reference?, notes?, allocations[] } */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can record payments.', 403);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const fields: Fields = {};
  checkDate(fields, 'paymentDate', b.paymentDate, { label: 'Payment date' });
  if (Array.isArray(b.allocations)) (b.allocations as Record<string, unknown>[]).forEach((a, i) => {
    checkSen(fields, `allocations.${i}.amountSen`, a?.amountSen, { label: 'Payment amount' });
  });
  const bad = invalid(fields); if (bad) return bad;
  const supplierId = String(b.supplierId ?? '').trim();
  if (!supplierId || !await one(env, 'SELECT 1 AS x FROM suppliers WHERE id = ?', supplierId)) return fail('VALIDATION', 'Pick a supplier.', 422, { supplierId: 'Unknown supplier.' });

  const rawAllocs = Array.isArray(b.allocations) ? (b.allocations as Record<string, unknown>[]) : [];
  const allocs: { invoiceId: string; amount: number }[] = [];
  for (const a of rawAllocs) {
    const invoiceId = String(a.purchaseInvoiceId ?? '').trim();
    const amount = Math.max(0, intOrNull(a.amountSen) ?? 0);
    if (!invoiceId || amount <= 0) continue;
    const pi = await one<{ supplier_id: string; total_sen: number; paid_sen: number; status: string }>(env, 'SELECT supplier_id, total_sen, paid_sen, status FROM purchase_invoices WHERE id = ?', invoiceId);
    if (!pi || pi.supplier_id !== supplierId || pi.status === 'CANCELLED') return fail('VALIDATION', 'An allocation points to an invalid invoice.', 422);
    const outstanding = Math.max(0, pi.total_sen - pi.paid_sen);
    allocs.push({ invoiceId, amount: Math.min(amount, outstanding) });
  }
  const filtered = allocs.filter(a => a.amount > 0);
  if (!filtered.length) return fail('VALIDATION', 'Allocate a payment to at least one outstanding invoice.', 422, { allocations: 'Allocate at least one invoice.' });

  const amount = filtered.reduce((s, a) => s + a.amount, 0);
  const method = PV_METHODS.includes(String(b.method) as typeof PV_METHODS[number]) ? String(b.method) : 'TRANSFER';
  const id = genId('pv');
  const voucherNumber = await nextVoucherNumber(env);
  const now = nowIso();
  const paymentDate = strOrNull(b.paymentDate) ?? mytToday();

  await run(env, `INSERT INTO payment_vouchers (id, voucher_number, supplier_id, payment_date, method, reference, amount_sen, notes, status, created_by, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?, ?)`,
    id, voucherNumber, supplierId, paymentDate, method, strOrNull(b.reference), amount, strOrNull(b.notes), session.userId, now, now);

  for (const a of filtered) {
    await run(env, 'INSERT INTO payment_voucher_allocations (id, voucher_id, purchase_invoice_id, amount_sen) VALUES (?, ?, ?, ?)', genId('pva'), id, a.invoiceId, a.amount);
    await run(env, 'UPDATE purchase_invoices SET paid_sen = paid_sen + ?, updated_at = ? WHERE id = ?', a.amount, now, a.invoiceId);
    await recomputePiStatus(env, a.invoiceId);
  }

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'payment_voucher.create', entityTable: 'payment_vouchers', entityId: id, after: { voucherNumber, supplierId, amount } });
  return json({ id, voucherNumber }, 201);
};
