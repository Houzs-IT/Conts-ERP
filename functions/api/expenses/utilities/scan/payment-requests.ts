import { type Env, fail } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { forwardClaims } from '../../../../_lib/claimsForward';
import { billsToPay } from '../../../../_lib/utilityScan';

/** POST /api/expenses/utilities/scan/payment-requests { batchId, provider, files?: [{ name, mime, dataBase64 }] }
 *  The bills a scan recorded for the company to pay (not ticked "Owner paid") go to finance as one payment request for
 *  the provider (chew, 2 Nov 2026), kept in the engine (conts/utility-bill-routes.ts). Sending the same scan and
 *  provider again answers with the request already made. Finance and management only. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Utility bills are entered by finance and management.', 403);
  const b = await request.json<{ batchId?: string; provider?: string; files?: unknown[] }>().catch(() => null);
  const batchId = String(b?.batchId ?? ''), provider = String(b?.provider ?? '');
  if (!batchId || !provider) return fail('VALIDATION', 'Name the scan and the provider.', 422);
  const [group] = await billsToPay(env, batchId, provider);
  if (!group) return fail('NOT_FOUND', `No ${provider} bills of this scan are left for the company to pay.`, 404);
  const files = Array.isArray(b?.files) ? b!.files.slice(0, 8) : [];
  return forwardClaims(env, session, 'POST', '/utility-bills/payment-request', { provider, scanBatchId: batchId, bills: group.bills, files });
};
