import { type Env, fail, audit } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { fileToUpload, forwardClaims } from '../../../../_lib/claimsForward';
import { billsToPay } from '../../../../_lib/utilityScan';
import { linkRequest } from '../../../../_lib/utilityRequests';

const MAX_FILES = 8;
const MAX_BYTES = 25 * 1024 * 1024;

/** POST /api/expenses/utilities/scan/payment-requests (multipart: `data` = { batchId, part, scanIds, provider }, and up
 *  to 8 `file`s, the PDFs and photos the bills came from)
 *  The bills a scan recorded for the company to pay (not ticked "Owner paid") go to finance as one payment request for
 *  the provider (chew, 2 Nov 2026), kept in the engine (conts/utility-bill-routes.ts). `scanIds` are the pages one save
 *  recorded and `part` numbers that save within the scan, so each save is its own request and sending the same save
 *  again answers with the request already made. The files go as a form, not JSON text, as on My claims
 *  (functions/api/claims/[[path]].ts). Finance and management only. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Utility bills are entered by finance and management.', 403);
  const form = await request.formData().catch(() => null);
  let b: { batchId?: string; part?: number; scanIds?: string[]; provider?: string } | null = null;
  try { b = JSON.parse(String(form?.get('data') ?? 'null')); } catch { b = null; }
  const batchId = String(b?.batchId ?? ''), provider = String(b?.provider ?? ''), part = Number(b?.part ?? 1);
  const scanIds = Array.isArray(b?.scanIds) ? b!.scanIds.map(String).slice(0, 300) : [];
  if (!batchId || !provider || !scanIds.length || !Number.isInteger(part) || part < 1) return fail('VALIDATION', 'Name the scan, the save and the provider.', 422);
  const picked = (form?.getAll('file') ?? []).filter((f): f is File => f instanceof File);
  if (picked.length > MAX_FILES || picked.reduce((n, f) => n + f.size, 0) > MAX_BYTES) return fail('VALIDATION', `Up to ${MAX_FILES} files, under 25 MB together.`, 422);
  const [group] = await billsToPay(env, batchId, scanIds, provider);
  if (!group) return fail('NOT_FOUND', `No ${provider} bills of this save are left for the company to pay.`, 404);
  const files = await Promise.all(picked.map(fileToUpload));
  const res = await forwardClaims(env, session, 'POST', '/utility-bills/payment-request', { provider, scanBatchId: `${batchId}#${part}`, bills: group.bills, files });
  if (res.ok) {
    /* Each bill keeps the request it went out on (Utility bills "By payment request"; chew, 5 Nov 2026). */
    const made = await res.clone().json<{ id?: string; requestNo?: string }>().catch(() => null);
    if (made?.id) await linkRequest(env, group.expenseIds, { id: made.id, requestNo: made.requestNo ?? null });
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'expense.utility_scan_payment_request', entityTable: 'utility_bill_scans', entityId: batchId,
      after: { batchId, part, provider, bills: group.bills.length, amountSen: group.bills.reduce((n, x) => n + x.amountSen, 0) } });
  }
  return res;
};
