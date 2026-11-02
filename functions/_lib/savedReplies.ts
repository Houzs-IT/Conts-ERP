import { fail } from './db';

/** Saved replies: short texts staff insert into a message instead of typing them again (migration 0200). Shared by
 *  everyone who works in Messages. */
export const TITLE_MAX = 80, BODY_MAX = 2000;

export function parseSavedReply(b: any): { title: string; body: string } | { error: Response } {
  const title = String(b?.title ?? '').trim(), body = String(b?.body ?? '').trim();
  const fields: Record<string, string> = {};
  if (!title) fields.title = 'Give it a name.';
  else if (title.length > TITLE_MAX) fields.title = `At most ${TITLE_MAX} characters.`;
  if (!body) fields.body = 'Write the reply.';
  else if (body.length > BODY_MAX) fields.body = `At most ${BODY_MAX} characters.`;
  if (Object.keys(fields).length) return { error: fail('VALIDATION', 'Check the saved reply.', 422, fields) };
  return { title, body };
}

