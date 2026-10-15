import { type Env, json, fail } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { hubFor, relay, askHub, readForm, filesRefusal, reporterFields, auditSent } from '../../../_lib/itHub';

const STATUSES = new Set(['open', 'in_progress', 'on_hold', 'testing', 'waiting_reporter', 'resolved', 'closed', 'rejected']);
/** What the browser may set. Who is reporting is filled in from the session (reporterFields). */
const FIELDS = ['title', 'description', 'type', 'priority', 'page_url', 'occurred_at'] as const;
const TYPES = ['bug', 'development'];
const PRIORITIES = ['urgent', 'high', 'medium', 'low'];

/** GET /api/it-support/tickets[?status=a,b] — the signed-in person's own IT requests, newest activity first. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const { hub, refusal } = hubFor(env, session);
  if (!hub) return refusal;
  const statuses = (new URL(request.url).searchParams.get('status') ?? '').split(',').filter(s => STATUSES.has(s));
  return relay(hub, `/tickets${statuses.length ? `?status=${statuses.join(',')}` : ''}`);
};

/** POST /api/it-support/tickets (multipart or JSON: title, description, type, priority, page_url, files) —
 *  reports a problem to IT as the signed-in person (session.userId). */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const { hub, refusal } = hubFor(env, session);
  if (!hub) return refusal;

  const input = await readForm(request);
  if (!input) return fail('VALIDATION', 'That could not be read. Fill in the form and send it again.', 422);
  const title = (input.fields.title ?? '').trim();
  if (!title) return fail('VALIDATION', 'Say in a few words what the problem is.', 422, { title: 'Say in a few words what the problem is.' });
  if (input.fields.type && !TYPES.includes(input.fields.type)) return fail('VALIDATION', 'Choose what kind of request this is.', 422);
  if (input.fields.priority && !PRIORITIES.includes(input.fields.priority)) return fail('VALIDATION', 'Choose how urgent this is.', 422);
  const badFiles = filesRefusal(input.files);
  if (badFiles) return fail('VALIDATION', badFiles, 422);

  const out = new FormData();
  FIELDS.forEach(k => { if (input.fields[k]?.trim()) out.set(k, input.fields[k].trim()); });
  reporterFields(session, request, out);
  input.files.forEach(f => out.append('files', f, f.name));

  const sent = await askHub<{ code: string; status: string; created_at: string }>(hub, '/tickets', { method: 'POST', body: out });
  if (sent.refusal) return sent.refusal;
  await auditSent(env, session, 'it_support.report', sent.data.code, { title, type: input.fields.type ?? 'bug', priority: input.fields.priority ?? 'medium', files: input.files.length });
  return json(sent.data, 201);
};
