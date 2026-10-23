import { type Env, one, fail } from '../../../_lib/db';
import { can } from '../../../_lib/access';
import { requireSession } from '../../../_lib/auth';
import { renderDocument } from '../../../_lib/guestDocumentPdf';

/** GET /api/guest-documents/:id/pdf — the print-ready document (Save as PDF from the browser), exactly as issued.
 *  A voided one prints with VOID across it and the reason. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!can(session, 'finance', 'view')) return fail('FORBIDDEN', 'Guest documents are for people with Finance access.', 403);
  const d = await one<any>(env, 'SELECT snapshot, voided_at, void_reason FROM issued_documents WHERE id = ?', String(params.id));
  if (!d) return fail('NOT_FOUND', 'That document does not exist.', 404);
  const snap = typeof d.snapshot === 'string' ? JSON.parse(d.snapshot) : d.snapshot;
  return renderDocument(snap, d.voided_at ? { at: d.voided_at, reason: d.void_reason } : null);
};
