/* The auto-post of one supplier invoice made by POST /purchase-invoices/from-grn-items. Three answers, never two:
   'posted'; 'capped' when the database cap (migration 0273) refused it because a concurrent invoice billed the GRN
   line, and the draft is rolled back; or 'failed', when the draft is left as it is and the caller must say so rather
   than report it POSTED (review of #856). An unresolved company does not scope the write: the id is this request's
   own insert. */
import { scopeToCompanyIdOrOpen } from './companyScope';
import { isGrnLineOverInvoiced } from './pi-grn-source-guard';

export type FromGrnPost = { kind: 'posted' } | { kind: 'capped' } | { kind: 'failed'; reason: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostgREST-shaped client, as in the routes.
export async function postFromGrnDraft(sb: any, draftId: string, companyId: number | null | undefined): Promise<FromGrnPost> {
  const now = new Date().toISOString();
  const { data, error } = await scopeToCompanyIdOrOpen(
    sb.from('purchase_invoices').update({ status: 'POSTED', posted_at: now, updated_at: now }).eq('id', draftId), companyId,
  ).select('id').maybeSingle();
  if (isGrnLineOverInvoiced(error)) {
    await scopeToCompanyIdOrOpen(sb.from('purchase_invoices').delete().eq('id', draftId), companyId);
    return { kind: 'capped' };
  }
  if (error) return { kind: 'failed', reason: String(error.message ?? 'update failed') };
  if (!data) return { kind: 'failed', reason: 'the invoice was not found to post' };
  return { kind: 'posted' };
}
