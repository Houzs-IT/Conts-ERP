import { type Env, all, json, fail, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MONEY_ROLES } from '../../_lib/bookingMoney';
import { issue, toDoc, DOC_SQL, DocRefused, type DocType } from '../../_lib/guestDocuments';

/** GET /api/guest-documents?type=invoice|receipt&status=live|void&month=YYYY-MM&q=&page=&pageSize=
 *  Every invoice and official receipt issued, newest first. Counts per type and status come with every page. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MONEY_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Guest documents are for management, finance and operations managers.', 403);

  const url = new URL(request.url);
  const type = url.searchParams.get('type'), status = url.searchParams.get('status'), month = url.searchParams.get('month');
  const q = url.searchParams.get('q')?.trim() || null;
  if (type && type !== 'invoice' && type !== 'receipt') return fail('VALIDATION', 'Unknown document type.', 422);
  if (status && status !== 'live' && status !== 'void') return fail('VALIDATION', 'Unknown status.', 422);
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail('VALIDATION', 'Month must look like 2026-09.', 422);
  const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
  const pageSize = Math.min(200, Math.max(1, Math.floor(Number(url.searchParams.get('pageSize')) || 50)));

  const base: string[] = [], args: unknown[] = [];
  if (month) {
    // issued_at is UTC; the month is Malaysia's.
    base.push(`to_char((d.issued_at::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur'), 'YYYY-MM') = ?`); args.push(month);
  }
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, m => '\\' + m)}%`;
    base.push(`(d.doc_no ILIKE ? OR d.snapshot->'guest'->>'name' ILIKE ? OR d.snapshot->'booking'->>'ref' ILIKE ? OR d.snapshot->'booking'->>'unit' ILIKE ?)`); args.push(like, like, like, like);
  }
  const baseSql = base.length ? 'AND ' + base.join(' AND ') : '';
  const filt = [type ? 'd.doc_type = ?' : '', status ? (status === 'void' ? 'd.voided_at IS NOT NULL' : 'd.voided_at IS NULL') : ''].filter(Boolean);
  const filtSql = filt.length ? 'AND ' + filt.join(' AND ') : '';
  const filtArgs = type ? [type] : [];

  const [rows, counts, months] = await Promise.all([
    all<any>(env, `${DOC_SQL} WHERE 1 = 1 ${baseSql} ${filtSql} ORDER BY d.issued_at DESC, d.doc_no DESC LIMIT ? OFFSET ?`, ...args, ...filtArgs, pageSize, (page - 1) * pageSize),
    all<{ doc_type: string; voided: boolean; n: number; amount: number }>(env, `SELECT d.doc_type, d.voided_at IS NOT NULL AS voided, COUNT(*)::int AS n, COALESCE(SUM(d.amount), 0)::bigint AS amount
      FROM issued_documents d WHERE 1 = 1 ${baseSql} GROUP BY 1, 2`, ...args),
    all<{ m: string }>(env, `SELECT DISTINCT to_char((issued_at::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur'), 'YYYY-MM') AS m FROM issued_documents ORDER BY 1 DESC`),
  ]);
  const c = (t: string | null, v: boolean | null) => counts.filter(x => (t === null || x.doc_type === t) && (v === null || !!x.voided === v));
  const sum = (xs: typeof counts, k: 'n' | 'amount') => xs.reduce((s, x) => s + Number(x[k]), 0);
  const total = sum(c(type, status === null ? null : status === 'void'), 'n');
  return json({
    generatedAt: nowIso(), page, pageSize, total,
    counts: { all: sum(c(null, null), 'n'), invoice: sum(c('invoice', null), 'n'), receipt: sum(c('receipt', null), 'n'), void: sum(c(null, true), 'n') },
    liveAmounts: { invoice: sum(c('invoice', false), 'amount'), receipt: sum(c('receipt', false), 'amount') },
    months: months.map(m => m.m),
    data: rows.map(toDoc),
  });
};

/** POST /api/guest-documents { type: 'invoice'|'receipt', reservationId, paymentId? (receipt) } — issues the next
 *  number and freezes what is printed. 201 with the document. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MONEY_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers issue guest documents.', 403);
  const b = await request.json<{ type?: string; reservationId?: string; paymentId?: string }>().catch(() => null);
  if (b?.type !== 'invoice' && b?.type !== 'receipt') return fail('VALIDATION', 'Choose an invoice or a receipt.', 422);
  if (!b.reservationId) return fail('VALIDATION', 'Say which booking.', 422);
  if (b.type === 'receipt' && !b.paymentId) return fail('VALIDATION', 'Choose the payment the receipt is for.', 422);
  try {
    return json(await issue(env, session, { type: b.type as DocType, reservationId: String(b.reservationId), paymentId: b.paymentId ? String(b.paymentId) : null }), 201);
  } catch (e) {
    if (e instanceof DocRefused) return fail(e.code, e.message, e.status);
    throw e;
  }
};
