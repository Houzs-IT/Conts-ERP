import type { Env } from './types';
import { HttpError } from './http';

/**
 * Calls to Supabase's admin API. The service-role key is an all-access key:
 * it lives only in Worker secrets and never reaches a browser.
 */
async function adminFetch(env: Env, path: string, init: RequestInit = {}) {
  const res = await fetch(`${env.SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new HttpError(res.status === 422 ? 409 : 502, 'Supabase rejected the request', body.slice(0, 500));
  }
  return res;
}

/** Send an invite email. Returns the new (or existing) auth user id. */
export async function inviteUser(env: Env, email: string, fullName: string, redirectTo: string) {
  const res = await adminFetch(env, '/auth/v1/invite', {
    method: 'POST',
    body: JSON.stringify({ email, data: { full_name: fullName }, redirect_to: redirectTo }),
  });
  const user = (await res.json()) as { id: string; email: string };
  return user;
}

/** Block or unblock a login at the source, not just in our own tables. */
export async function setAuthUserBanned(env: Env, userId: string, banned: boolean) {
  await adminFetch(env, `/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ ban_duration: banned ? '876000h' : 'none' }),
  });
}

export async function uploadAvatar(env: Env, path: string, contentType: string, body: ArrayBuffer) {
  const bucket = env.AVATAR_BUCKET ?? 'avatars';
  await adminFetch(env, `/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: { 'content-type': contentType, 'x-upsert': 'true' },
    body,
  });
  return `${bucket}/${path}`;
}

/** Short-lived link to a private photo; the bucket itself stays closed. */
export async function signedAvatarUrl(env: Env, storedPath: string, expiresIn = 3600) {
  const [bucket, ...rest] = storedPath.split('/');
  const res = await adminFetch(env, `/storage/v1/object/sign/${bucket}/${rest.join('/')}`, {
    method: 'POST',
    body: JSON.stringify({ expiresIn }),
  });
  const { signedURL } = (await res.json()) as { signedURL: string };
  return `${env.SUPABASE_URL}/storage/v1${signedURL}`;
}
