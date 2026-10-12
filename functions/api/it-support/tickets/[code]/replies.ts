import { type Env, json, fail } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { hubFor, askHub, readForm, filesRefusal, auditSent, REQUEST_CODE } from '../../../../_lib/itHub';

/** POST /api/it-support/tickets/:code/replies (multipart or JSON: body, files) — the signed-in person's reply on
 *  their own IT request (session.userId). A reply on a request IT marked done puts it back to work. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const { hub, refusal } = hubFor(env, session);
  if (!hub) return refusal;
  const code = String(params.code);
  if (!REQUEST_CODE.test(code)) return fail('NOT_FOUND', 'That IT request could not be found.', 404);

  const input = await readForm(request);
  if (!input) return fail('VALIDATION', 'That could not be read. Write your reply and send it again.', 422);
  const body = (input.fields.body ?? '').trim();
  if (!body && input.files.length === 0) return fail('VALIDATION', 'Write a reply or attach a file.', 422);
  const badFiles = filesRefusal(input.files);
  if (badFiles) return fail('VALIDATION', badFiles, 422);

  const out = new FormData();
  if (body) out.set('body', body);
  input.files.forEach(f => out.append('files', f, f.name));
  const sent = await askHub<{ ok: boolean; status: string }>(hub, `/tickets/${code}/replies`, { method: 'POST', body: out },
    'This IT request is closed. Report the problem again if it is back.');
  if (sent.refusal) return sent.refusal;
  await auditSent(env, session, 'it_support.reply', code, { files: input.files.length });
  return json(sent.data, 201);
};
