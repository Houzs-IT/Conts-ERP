// A manual journal still in draft has booked nothing, so it can be thrown away rather than reversed (chew, 17 Nov 2026:
// two month-end utility accruals keyed as drafts before the ERP began booking utilities itself on payment). Only a
// MANUAL draft of the company goes; anything posted is reversed instead, and a document's own entry follows its
// document.

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as everywhere in acc/ */
type Db = any;

export type DiscardResult = { ok: true; jeNo: string } | { ok: false; status: 404 | 409 | 500; error: string };

export async function discardDraftJournal(sb: Db, companyId: number, id: string): Promise<DiscardResult> {
  const { data, error } = await sb.from('journal_entries').select('id, je_no, source_type, posted')
    .eq('company_id', companyId).eq('id', id).maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  const je = data as { id: string; je_no: string; source_type: string; posted: boolean | null } | null;
  if (!je) return { ok: false, status: 404, error: 'No such journal entry in this company.' };
  if (je.source_type !== 'MANUAL') return { ok: false, status: 409, error: `${je.je_no} belongs to its document; cancel the document instead.` };
  if (je.posted === true) return { ok: false, status: 409, error: `${je.je_no} is posted; reverse it instead.` };
  const lines = await sb.from('journal_entry_lines').delete().eq('journal_entry_id', je.id);
  if (lines.error) return { ok: false, status: 500, error: lines.error.message };
  const del = await sb.from('journal_entries').delete().eq('company_id', companyId).eq('id', je.id).eq('posted', false);
  if (del.error) return { ok: false, status: 500, error: del.error.message };
  return { ok: true, jeNo: je.je_no };
}
