import { type Env, json, fail, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { meetingsHubFor, meetingsFetch, relayMeetings, maybePushDirectory, meetingsConnected, type MeetingsHub } from '../../_lib/meetingsHub';

/**
 * /api/meetings/* — the Meetings page (src/pages/meetings). Every call goes to the Houzs IT Hub (functions/_lib/
 * meetingsHub.ts), which decides every booking rule; this file checks the shape of what is sent, keeps the room and
 * change-log calls to people with Manage meeting rooms, and writes an audit row for each change the hub accepted.
 *
 *   GET  status | bootstrap | calendar?from&to | mine | unread-count | meetings/:id | meetings/:id/files/:fid | links | log
 *   POST notifications/read | meet-link | meetings | meetings/:id/(cancel|start|end) | meetings/:id/files | rooms | links
 *   PATCH meetings/:id | rooms/:id | links/:id
 */
const ID = /^\d{1,12}$/;
const MAX_FILES = 10;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const UNREADABLE = 'That could not be read. Try again.';
const MANAGE_ONLY = 'You need Manage meeting rooms for that.';
const GONE = 'That meeting is not there any more.';

const readJson = async (request: Request): Promise<Record<string, unknown> | null> => {
  try { return await request.json() as Record<string, unknown>; } catch { return null; }
};
const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });

export const onRequest: PagesFunction<Env> = async ({ request, env, params, waitUntil }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const parts = ([] as string[]).concat(params.path ?? []).filter(Boolean);
  const method = request.method;
  const route = parts.join('/');

  if (method === 'GET' && route === 'status') return json({ connected: meetingsConnected(env) });

  const { hub, refusal } = await meetingsHubFor(env, session);
  if (!hub) return refusal;
  const manage = hub.headers['X-Can-Manage-Rooms'] === '1';
  const url = new URL(request.url);

  /** A change the hub accepted, written to Conts's own audit log as well. */
  const changed = async (res: Response, action: string, entityId: string, after?: unknown) => {
    if (res.ok) {
      try { await audit(env, { actorId: session.userId, actorLabel: session.fullName, action, entityTable: 'meetings', entityId, after }); }
      catch (e) { console.error('Meetings audit failed', action, entityId, e); }
    }
    return res;
  };
  const send = (path: string, init?: RequestInit) => relayMeetings(meetingsFetch(hub as MeetingsHub, path, init));

  if (method === 'GET') {
    if (route === 'bootstrap') { maybePushDirectory(env, waitUntil); return send('/bootstrap'); }
    if (route === 'mine') return send('/mine');
    if (route === 'links') return send('/links');
    if (route === 'log') return manage ? send('/log') : fail('FORBIDDEN', MANAGE_ONLY, 403);
    if (route === 'calendar') {
      const from = url.searchParams.get('from') ?? '';
      const to = url.searchParams.get('to') ?? '';
      if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to))) return fail('VALIDATION', 'from and to are required', 400);
      return send(`/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    }
    if (route === 'unread-count') {
      const res = await send('/unread');
      if (!res.ok) return res;
      const n = Number(((await res.json()) as { unread?: unknown }).unread);
      return json({ count: Number.isFinite(n) && n > 0 ? n : 0 });
    }
    if (parts[0] === 'meetings' && parts.length === 2) return ID.test(parts[1]) ? send(`/meetings/${parts[1]}`) : fail('NOT_FOUND', GONE, 404);
    if (parts[0] === 'meetings' && parts.length === 4 && parts[2] === 'files') {
      if (!ID.test(parts[1]) || !ID.test(parts[3])) return fail('NOT_FOUND', 'That file could not be found.', 404);
      let res: Response;
      try { res = await meetingsFetch(hub, `/meetings/${parts[1]}/files/${parts[3]}`); }
      catch { return fail('UPSTREAM', 'Meetings could not be reached. Try again in a moment.', 502); }
      if (res.status === 404) return fail('NOT_FOUND', 'That file could not be found.', 404);
      if (!res.ok || !res.body) return fail('UPSTREAM', 'Meetings could not be reached. Try again in a moment.', 502);
      const headers = new Headers({ 'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
      const disposition = res.headers.get('Content-Disposition');
      if (disposition) headers.set('Content-Disposition', disposition);
      return new Response(res.body, { status: 200, headers });
    }
    return fail('NOT_FOUND', 'Not found.', 404);
  }

  if (method === 'POST') {
    if (route === 'notifications/read') return send('/notifications/read', { method: 'POST' });
    if (route === 'meet-link') return send('/meet-link', { method: 'POST' });
    if (route === 'meetings') {
      const body = await readJson(request);
      if (!body) return fail('VALIDATION', UNREADABLE, 400);
      const res = await send('/meetings', jsonInit('POST', body));
      const ids = res.ok ? ((await res.clone().json().catch(() => ({}))) as { ids?: unknown[] }).ids ?? [] : [];
      return changed(res, 'meetings.book', ids.map(String).join(',') || String(body.title ?? '').slice(0, 120), { title: body.title, start: body.start, end: body.end, roomId: body.roomId, repeat: body.repeat });
    }
    if (parts[0] === 'meetings' && parts.length === 3 && ['cancel', 'start', 'end'].includes(parts[2])) {
      if (!ID.test(parts[1])) return fail('NOT_FOUND', GONE, 404);
      const res = await send(`/meetings/${parts[1]}/${parts[2]}`, jsonInit('POST', (await readJson(request)) ?? {}));
      return changed(res, `meetings.${parts[2]}`, parts[1]);
    }
    if (parts[0] === 'meetings' && parts.length === 3 && parts[2] === 'files') {
      if (!ID.test(parts[1])) return fail('NOT_FOUND', GONE, 404);
      let files: File[] = [];
      try {
        const form = await request.formData();
        files = form.getAll('files').filter((f): f is File => typeof f !== 'string' && (f as File).size > 0);
      } catch {
        return fail('VALIDATION', 'Those files could not be read. Attach them again.', 400);
      }
      if (!files.length) return fail('VALIDATION', 'Attach at least one file.', 400);
      if (files.length > MAX_FILES) return fail('VALIDATION', `Attach at most ${MAX_FILES} files at a time.`, 400);
      const big = files.find(f => f.size > MAX_FILE_BYTES);
      if (big) return fail('VALIDATION', `${big.name} is larger than 25 MB.`, 413);
      const out = new FormData();
      for (const f of files) out.append('files', f, f.name);
      const res = await send(`/meetings/${parts[1]}/files`, { method: 'POST', body: out });
      return changed(res, 'meetings.attach', parts[1], { files: files.map(f => f.name) });
    }
    if (route === 'rooms') {
      if (!manage) return fail('FORBIDDEN', MANAGE_ONLY, 403);
      const body = await readJson(request);
      if (!body) return fail('VALIDATION', UNREADABLE, 400);
      const res = await send('/rooms', jsonInit('POST', body));
      return changed(res, 'meetings.room_add', String(body.name ?? ''), body);
    }
    if (route === 'links') {
      const body = await readJson(request);
      if (!body) return fail('VALIDATION', UNREADABLE, 400);
      const res = await send('/links', jsonInit('POST', body));
      return changed(res, 'meetings.link_add', String(body.name ?? ''), body);
    }
    return fail('NOT_FOUND', 'Not found.', 404);
  }

  if (method === 'PATCH' && parts.length === 2) {
    const [kind, id] = parts;
    if (!ID.test(id) || !['meetings', 'rooms', 'links'].includes(kind)) return fail('NOT_FOUND', 'Not found.', 404);
    if (kind === 'rooms' && !manage) return fail('FORBIDDEN', MANAGE_ONLY, 403);
    const body = await readJson(request);
    if (!body) return fail('VALIDATION', UNREADABLE, 400);
    const res = await send(`/${kind}/${id}`, jsonInit('PATCH', body));
    return changed(res, kind === 'meetings' ? 'meetings.change' : kind === 'rooms' ? 'meetings.room_change' : 'meetings.link_change', id, body);
  }

  return fail('NOT_FOUND', 'Not found.', 405);
};
