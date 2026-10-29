import { type Env, json, fail } from './db';
import { type Session } from './auth';
import { claimsAssertion, scmEngineConfigured } from './scmEngine';

/** Staff receipts, petty cash and payment requests live in the engine (finance, 29 Oct 2026; design
 *  docs/superpowers/specs/2026-10-28-payment-requests-petty-cash-design.md §4.3). Property OS forwards each call, server
 *  to server, with a signed statement of who it is for; the engine checks it and limits every answer to that person.
 *  Nobody needs an engine account to hand in a receipt. */
export async function forwardClaims(env: Env, session: Session, method: 'GET' | 'POST', enginePath: string, body?: unknown): Promise<Response> {
  if (!scmEngineConfigured(env)) return fail('NOT_CONFIGURED', 'Claims are not set up on this environment yet.', 501);
  let res: Response;
  try {
    res = await fetch(`${env.SCM_ENGINE_API!.replace(/\/+$/, '')}/api/claims-forward${enginePath}`, {
      method,
      headers: { 'x-conts-staff': await claimsAssertion(env, session), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    return fail('ENGINE_UNREACHABLE', 'The finance system could not be reached. Try again in a moment.', 502);
  }
  const type = res.headers.get('content-type') ?? '';
  // A receipt's photo or PDF comes back as it is.
  if (!type.includes('application/json')) {
    return new Response(res.body, { status: res.status, headers: { 'content-type': type || 'application/octet-stream', 'content-disposition': res.headers.get('content-disposition') ?? 'inline', 'cache-control': 'private, max-age=300' } });
  }
  const data = await res.json<Record<string, unknown>>().catch(() => null);
  if (!res.ok) {
    const message = String(data?.message ?? data?.error ?? `The finance system refused this (${res.status}).`);
    return fail(String(data?.error ?? 'ENGINE_REFUSED').toUpperCase(), message, res.status >= 500 ? 502 : res.status);
  }
  return json(data ?? {}, res.status);
}

/** A file from a form, as the engine takes it. */
export async function fileToUpload(file: File): Promise<{ name: string; mime: string; dataBase64: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { name: file.name.slice(0, 200), mime: file.type || 'application/octet-stream', dataBase64: btoa(bin) };
}
