import { type Env, json, fail, audit } from './db';
import type { Session } from './auth';

/**
 * IT Support. Staff report a problem with the system, follow it and reply. The requests are not kept in Conts:
 * they live in the Houzs IT Hub, the one inbox the developers work for every system, and these functions are
 * the only thing that talks to it, server to server.
 *
 *  - Conts's key for the hub (IT_HUB_API_KEY) never leaves the server.
 *  - Who is asking is the signed-in person (session.userId), never a value from the request: the hub shows a
 *    reporter only their own requests, keyed on that id.
 *  - "The hub could not be asked" is answered as that (501 not connected, 502 unreachable), never as an empty
 *    list: no requests and no answer are different facts.
 */
const TIMEOUT_MS = 20_000;
export const REQUEST_CODE = /^[A-Z0-9]{2,6}-\d{1,8}$/;
export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FILE_KINDS = /^(image\/|video\/mp4$|video\/quicktime$|application\/pdf$)/;

const ROLE_NAME: Record<string, string> = {
  management: 'Management', operations_staff: 'Operations staff',
};

export interface Hub { base: string; key: string; reporterId: string }

/** The hub settings for this person, or the refusal to send when IT Support is not connected here. */
export function hubFor(env: Env, session: Session): { hub: Hub; refusal: null } | { hub: null; refusal: Response } {
  const base = (env.IT_HUB_URL ?? '').trim().replace(/\/+$/, '');
  const key = (env.IT_HUB_API_KEY ?? '').trim();
  if (!base || !key) {
    return { hub: null, refusal: fail('NOT_CONFIGURED', 'IT Support is not connected on this system yet. Tell IT directly for now.', 501) };
  }
  return { hub: { base, key, reporterId: session.userId }, refusal: null };
}

export function hubFetch(hub: Hub, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${hub.key}`);
  headers.set('X-Reporter-Id', hub.reporterId);
  return fetch(`${hub.base}/api/v1/sys${path}`, { ...init, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

const unreachable = () => fail('UPSTREAM', 'IT Support could not be reached. Try again in a moment.', 502);

export type HubAnswer<T> = { data: T; status: number; refusal: null } | { data: null; status: number; refusal: Response };

/**
 * One call to the hub. `conflict` is the sentence for the hub's 409 (it refuses an action the request's state does
 * not allow). A 401 from the hub means Conts's key is wrong: nothing the person can act on, and it must not read
 * as their own sign-in having ended, so it is answered as unreachable and logged.
 */
export async function askHub<T>(hub: Hub, path: string, init?: RequestInit, conflict?: string): Promise<HubAnswer<T>> {
  let res: Response;
  try {
    res = await hubFetch(hub, path, init);
  } catch (e) {
    console.error('IT Hub unreachable', e instanceof Error ? e.message : e);
    return { data: null, status: 502, refusal: unreachable() };
  }
  const body = await res.json().catch(() => null) as (T & { error?: string }) | null;
  if (res.ok && body) return { data: body, status: res.status, refusal: null };
  if (res.status === 404) return { data: null, status: 404, refusal: fail('NOT_FOUND', 'That IT request could not be found.', 404) };
  if (res.status === 409) return { data: null, status: 409, refusal: fail('CONFLICT', conflict ?? 'That cannot be done on this IT request as it stands. Refresh the page.', 409) };
  if (res.status === 400) return { data: null, status: 400, refusal: fail('VALIDATION', typeof body?.error === 'string' ? body.error : 'Some details are missing or not valid.', 422) };
  console.error('IT Hub answered', res.status, typeof body?.error === 'string' ? body.error : '');
  return { data: null, status: 502, refusal: unreachable() };
}

/** The same call, answered straight to the browser. */
export async function relay(hub: Hub, path: string, init?: RequestInit, conflict?: string): Promise<Response> {
  const a = await askHub<unknown>(hub, path, init, conflict);
  return a.refusal ?? json(a.data, a.status === 201 ? 201 : 200);
}

/** Text and files off the browser's form. Null when the body cannot be read. */
export async function readForm(request: Request): Promise<{ fields: Record<string, string>; files: File[] } | null> {
  const fields: Record<string, string> = {};
  const files: File[] = [];
  try {
    if ((request.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const form = await request.formData();
      form.forEach((v, k) => {
        if (typeof v === 'string') fields[k] = v;
        else if (k === 'files' && (v as File).size > 0) files.push(v as File);
      });
    } else {
      const body = await request.json() as Record<string, unknown>;
      Object.entries(body ?? {}).forEach(([k, v]) => { if (v != null) fields[k] = String(v); });
    }
  } catch {
    return null;
  }
  return { fields, files };
}

/** What is wrong with the attached files, in a sentence, or null. Checked here so the wording is ours. */
export function filesRefusal(files: File[]): string | null {
  if (files.length > MAX_FILES) return `Attach at most ${MAX_FILES} files.`;
  const big = files.find(f => f.size > MAX_FILE_BYTES);
  if (big) return `${big.name} is larger than 10 MB.`;
  const odd = files.find(f => !FILE_KINDS.test(f.type));
  return odd ? `${odd.name} is not a picture, an MP4 or MOV video, or a PDF.` : null;
}

/** Who the hub is told is reporting: the signed-in person, from the session. */
export function reporterFields(session: Session, request: Request, out: FormData) {
  out.set('reporter_name', session.fullName || session.email);
  out.set('reporter_email', session.email);
  out.set('reporter_department', ROLE_NAME[session.role] ?? session.role);
  const agent = request.headers.get('user-agent');
  if (agent) out.set('user_agent', agent.slice(0, 500));
}

/** The audit row for something sent to the hub. The request is already with IT when this runs, so a failed audit
 *  write is logged and not turned into an error: the person would send it again and IT would get it twice. */
export async function auditSent(env: Env, session: Session, action: string, code: string, after?: unknown) {
  try {
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action, entityTable: 'it_requests', entityId: code, after });
  } catch (e) {
    console.error('IT Support audit failed', action, code, e);
  }
}
