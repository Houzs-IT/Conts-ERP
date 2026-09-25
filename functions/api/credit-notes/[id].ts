import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { HEADER_SQL, buildLines, toNotePayload, toNoteLinePayload, type NoteHeaderRow, type NoteLineRow } from '../../_lib/credit-notes';
import { strOrNull, genId } from '../../_lib/scm-util';

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!canSeeFinance(session.role)) return fail('FORBIDDEN', 'Credit and debit notes are for finance and management.', 403);
  const id = String(params.id);
  const header = await one<NoteHeaderRow>(env, `${HEADER_SQL} WHERE n.id = ?`, id);
  if (!header) return fail('NOT_FOUND', 'That note does not exist.', 404);
  const lines = await all<NoteLineRow>(env, 'SELECT id, line_no, description, amount_sen FROM credit_note_lines WHERE note_id = ? ORDER BY line_no', id);
  return json({ data: { ...toNotePayload(header), lines: lines.map(toNoteLinePayload) } });
};

/** PATCH { status: 'POSTED' } posts it (only then does it move a balance); { status: 'CANCELLED' }
 *  cancels it (a posted note's effect is removed); anything else edits a DRAFT. As in Houzs, a
 *  posted note is never edited — cancel it and raise it again, so the trail stays. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can change credit or debit notes.', 403);
  const id = String(params.id);
  const cur = await one<{ status: string; note_number: string; total_sen: number }>(env, 'SELECT status, note_number, total_sen FROM credit_notes WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That note does not exist.', 404);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const now = nowIso();

  if (b.status === 'POSTED') {
    if (cur.status === 'CANCELLED') return fail('CONFLICT', `${cur.note_number} is cancelled.`, 409);
    if (cur.status === 'POSTED') return json({ id, status: 'POSTED' });
    await run(env, 'UPDATE credit_notes SET status = ?, posted_at = ?, posted_by = ?, updated_at = ? WHERE id = ?', 'POSTED', now, session.userId, now, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'credit_note.post', entityTable: 'credit_notes', entityId: id, after: { noteNumber: cur.note_number, totalSen: cur.total_sen } });
    return json({ id, status: 'POSTED' });
  }

  if (b.status === 'CANCELLED') {
    if (cur.status === 'CANCELLED') return json({ id, status: 'CANCELLED' });
    await run(env, 'UPDATE credit_notes SET status = ?, cancelled_at = ?, cancelled_by = ?, updated_at = ? WHERE id = ?', 'CANCELLED', now, session.userId, now, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'credit_note.cancel', entityTable: 'credit_notes', entityId: id, before: { status: cur.status }, after: { noteNumber: cur.note_number } });
    return json({ id, status: 'CANCELLED' });
  }

  if (cur.status !== 'DRAFT') return fail('CONFLICT', `${cur.note_number} is ${cur.status.toLowerCase()} — cancel it and raise it again.`, 409);
  const sets: string[] = ['updated_at = ?'];
  const args: unknown[] = [now];
  if (b.noteDate !== undefined) { sets.push('note_date = ?'); args.push(strOrNull(b.noteDate) ?? now.slice(0, 10)); }
  if (b.reason !== undefined) { sets.push('reason = ?'); args.push(strOrNull(b.reason)); }
  if (b.notes !== undefined) { sets.push('notes = ?'); args.push(strOrNull(b.notes)); }
  if (b.sourceDocNo !== undefined) { sets.push('source_doc_no = ?'); args.push(strOrNull(b.sourceDocNo)); }
  if (b.lines !== undefined) {
    const built = buildLines(b.lines);
    if ('message' in built) return fail('VALIDATION', built.message, 422, { lines: built.message });
    await run(env, 'DELETE FROM credit_note_lines WHERE note_id = ?', id);
    for (const [i, l] of built.lines.entries()) {
      await run(env, 'INSERT INTO credit_note_lines (id, note_id, line_no, description, amount_sen) VALUES (?, ?, ?, ?, ?)', genId('cnl'), id, i + 1, l.description, l.amountSen);
    }
    sets.push('total_sen = ?'); args.push(built.total);
  }
  await run(env, `UPDATE credit_notes SET ${sets.join(', ')} WHERE id = ?`, ...args, id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'credit_note.update', entityTable: 'credit_notes', entityId: id, after: { noteNumber: cur.note_number } });
  return json({ id });
};
