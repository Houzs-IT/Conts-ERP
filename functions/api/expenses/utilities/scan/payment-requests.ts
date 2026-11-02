import { type Env, fail, audit } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { forwardClaims } from '../../../../_lib/claimsForward';
import { billsToPay } from '../../../../_lib/utilityScan';

/** POST /api/expenses/utilities/scan/payment-requests { batchId, part, scanIds, provider, files?: [{ name, mime, dataBase64 }] }
 *  The bills a scan recorded for the company to pay (not ticked "Owner paid") go to finance as one payment request for
 *  the provider (chew, 2 Nov 2026), kept in the engine (conts/utility-bill-routes.ts). `scanIds` are the pages one save
 *  recorded and `part` numbers that save within the scan, so each save is its own request and sending the same save
 *  again answers with the request already made. Finance and management only. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Utility bills are entered by finance and management.', 403);
  const b = await request.json<{ batchId?: string; part?: number; scanIds?: string[]; provider?: string; files?: unknown[] }>().catch(() => null);
  const batchId = String(b?.batchId ?? ''), provider = String(b?.provider ?? ''), part = Number(b?.part ?? 1);
  const scanIds = Array.isArray(b?.scanIds) ? b!.scanIds.map(String).slice(0, 300) : [];
  if (!batchId || !provider || !scanIds.length || !Number.isInteger(part) || part < 1) return fail('VALIDATION', 'Name the scan, the save and the provider.', 422);
  const [group] = await billsToPay(env, batchId, scanIds, provider);
  if (!group) return fail('NOT_FOUND', `No ${provider} bills of this scan are left for the company to pay.`, 404);
  const files = Array.isArray(b?.files) ? b!.files.slice(0, 8) : [];
  const res = await forwardClaims(env, session, 'POST', '/utility-bills/payment-request', { provider, scanBatchId: `${batchId}#${part}`, bills: group.bills, files });
  if (res.ok) {
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'expense.utility_scan_payment_request', entityTable: 'utility_bill_scans', entityId: batchId,
      after: { batchId, part, provider, bills: group.bills.length, amountSen: group.bills.reduce((n, x) => n + x.amountSen, 0) } });
  }
  return res;
};
