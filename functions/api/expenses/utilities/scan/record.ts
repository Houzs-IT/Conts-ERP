import { type Env, json, fail } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { recordScannedBills, type RecordRow } from '../../../../_lib/utilityScan';

/** POST /api/expenses/utilities/scan/record { batchId, rows: [{ scanId, unitId, accountId?, kind, billMonth, periodFrom?,
 *  periodTo?, amountSen, chargeTo?, ownerPaid? }] } — records the checked pages of a scan in one go (functions/_lib/
 *  utilityScan.ts recordScannedBills). Finance and management only. A page already recorded, or a bill already on file
 *  for that unit, kind and month, refuses the whole save (409) and names the page. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Utility bills are entered by finance and management.', 403);
  const b = await request.json<{ batchId?: string; rows?: RecordRow[] }>().catch(() => null);
  const rows = Array.isArray(b?.rows) ? b!.rows.map(r => ({ ...r, amountSen: Number(r?.amountSen) })) : [];
  const r = await recordScannedBills(env, session, String(b?.batchId ?? ''), rows);
  if (!r.ok) return fail(r.code, r.message, r.status, r.fields);
  return json(r, 201);
};
