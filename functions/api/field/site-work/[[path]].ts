import { type Env, fail, audit } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { fileToUpload, forwardToEngine, type ForwardTarget } from '../../../_lib/claimsForward';

const PROGRESS_PATH = /^lines\/[A-Za-z0-9-]+\/progress$/;
const MIN_PHOTOS = 1;
const MAX_PHOTOS = 10;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const TARGET: ForwardTarget = { mount: 'site-forward', systemName: 'renovation', notConfiguredMessage: 'Jobs are not set up on this environment yet.' };

const pathOf = (params: Record<string, string | string[]>): string => (Array.isArray(params.path) ? params.path.join('/') : String(params.path ?? ''));

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response;
  if (session.role !== 'renovator') return fail('FORBIDDEN', 'Jobs are for Renovation staff.', 403);
  if (pathOf(params) !== 'jobs') return fail('NOT_FOUND', 'Not found.', 404);
  return forwardToEngine(env, session, TARGET, 'GET', '/jobs');
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response;
  if (session.role !== 'renovator') return fail('FORBIDDEN', 'Jobs are for Renovation staff.', 403);
  const path = pathOf(params);
  if (!PROGRESS_PATH.test(path)) return fail('NOT_FOUND', 'Not found.', 404);
  const form = await request.formData().catch(() => null);
  if (!form) return fail('VALIDATION', 'Send the count and photos as a form.', 422);
  let doneQty: unknown;
  try { doneQty = (JSON.parse(String(form.get('data') ?? '{}')) as { doneQty?: unknown }).doneQty; } catch { return fail('VALIDATION', 'The form could not be read.', 422); }
  if (typeof doneQty !== 'number' || !Number.isFinite(doneQty)) return fail('VALIDATION', 'Send the count as a number.', 422);
  const files = form.getAll('photo').filter((entry): entry is File => entry instanceof File);
  if (files.length < MIN_PHOTOS) return fail('VALIDATION', 'Add at least one photo of the work.', 422);
  if (files.length > MAX_PHOTOS) return fail('VALIDATION', `Up to ${MAX_PHOTOS} photos.`, 422);
  if (files.some(file => !PHOTO_TYPES.has(file.type))) return fail('VALIDATION', 'Only photos can be added as proof.', 422);
  if (files.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_BYTES) return fail('VALIDATION', 'The photos together must be under 25 MB.', 422);
  const photos = await Promise.all(files.map(fileToUpload));
  const res = await forwardToEngine(env, session, TARGET, 'PUT', `/${path}`, { doneQty, photos });
  if (res.ok) {
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'renovation.line_progress', entityTable: 'engine_so_items', entityId: path.split('/')[1] ?? '', after: { doneQty, photos: photos.length }, source: 'field_app' });
  }
  return res;
};
