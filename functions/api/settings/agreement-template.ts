import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { maySee } from '../../_lib/access';
import { PLACEHOLDERS, templatesReady, currentTemplate, usedKeys } from '../../_lib/agreement';

/** GET /api/settings/agreement-template — the template in use, its earlier versions and the placeholders it can use.
 *  POST { title, body } — saves a new version (management only); earlier versions are kept, never changed. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!maySee(session, ['management'])) return fail('FORBIDDEN', 'The agreement template is for management, finance and operations managers.', 403);
  if (!(await templatesReady(env))) return json({ ready: false, current: null, versions: [], placeholders: PLACEHOLDERS });
  const [current, versions] = await Promise.all([
    currentTemplate(env),
    all<any>(env, 'SELECT id, version, title, created_at, created_by_label, length(body) AS chars FROM agreement_templates ORDER BY version DESC LIMIT 50'),
  ]);
  return json({
    ready: true, current, placeholders: PLACEHOLDERS,
    versions: versions.map(v => ({ id: v.id, version: Number(v.version), title: v.title, createdAt: v.created_at, createdBy: v.created_by_label ?? null, chars: Number(v.chars) })),
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (session.role !== 'management') return fail('FORBIDDEN', 'Only management can change the agreement template.', 403);
  if (!(await templatesReady(env))) return fail('NOT_READY', 'The agreement template needs the latest database update.', 501);
  const b = await request.json<{ title?: string; body?: string }>().catch(() => null);
  const fields: Record<string, string> = {};
  const title = typeof b?.title === 'string' ? b.title.trim() : '', body = typeof b?.body === 'string' ? b.body.replace(/\r\n/g, '\n').trim() : '';
  if (!title || title.length > 160) fields.title = 'Enter a title of up to 160 characters.';
  if (!body || body.length > 100000) fields.body = 'Enter the agreement text (up to 100,000 characters).';
  const unknown = usedKeys(body).filter(k => !PLACEHOLDERS.some(p => p.key === k));
  if (unknown.length) fields.body = `Unknown placeholder${unknown.length === 1 ? '' : 's'}: ${unknown.map(k => `{{${k}}}`).join(', ')}.`;
  if (Object.keys(fields).length) return fail('VALIDATION', Object.values(fields)[0], 422, fields);
  const cur = await currentTemplate(env);
  if (cur && cur.title === title && cur.body === body) return fail('VALIDATION', 'Nothing has changed.', 422);
  const next = Number((await one<{ v: number }>(env, 'SELECT COALESCE(MAX(version), 0) AS v FROM agreement_templates'))?.v ?? 0) + 1;
  const id = crypto.randomUUID();
  await run(env, 'INSERT INTO agreement_templates (id, version, title, body, created_at, created_by, created_by_label) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, next, title, body, nowIso(), session.userId, session.fullName);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'settings.agreement_template', entityTable: 'agreement_templates', entityId: id,
    before: cur ? { version: cur.version, title: cur.title } : null, after: { version: next, title, chars: body.length } });
  return json({ id, version: next }, 201);
};
