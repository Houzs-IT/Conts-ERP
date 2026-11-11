// ---------------------------------------------------------------------------
// scan-job-drive — runs a scan job inside a request the screen holds open,
// instead of in ctx.waitUntil (Conts fix, after Hookka #485 / 87fc435a9).
//
// Why: Cloudflare cancels waitUntil work about 30 s after the response is
// sent, and a real slip's OCR call takes 60-110 s. With no SCAN_QUEUE bound
// (Conts has none: a Queue is a paid resource and the engine runs no cron), the
// enqueue routes used to start the pipeline in waitUntil, so a long scan was
// cut mid-call, sat 'running' until the reaper's one re-run (also waitUntil,
// also cut), then failed. A request the client keeps open has no wall-clock
// limit while it stays connected, so:
//
//   - enqueue only stores the photos and a 'queued' row (no waitUntil);
//   - the screen POSTs .../jobs/:id/work, which claims the row (queued, or
//     running but stale) and runs the whole pipeline before answering;
//   - a job nobody drives, or whose request was cut (app closed), goes stale
//     on its updated_at clock: the reaper re-queues it once, then marks it
//     'error' — visible on the screen with a Retry button that calls
//     .../jobs/:id/retry and drives it again.
//
// With a SCAN_QUEUE bound the queue consumer owns every attempt and /work does
// nothing, so a job never runs twice.
// ---------------------------------------------------------------------------

import type { SupabaseClient as SupabaseClientGeneric } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema-parameterised scm client, same alias as scan-so.ts
type SupabaseClient = SupabaseClientGeneric<any, any, any>;

/** A queued/running job untouched this long is dead (same 3 minutes as the reapers; the OCR call aborts at 110 s). */
export const SCAN_JOB_STALE_MS = 3 * 60 * 1000;

export type ScanDocType = 'SO' | 'GR' | 'PI';

/** Whether a job row is stalled: still queued/running but not touched within the stale window. */
export function isStalledScanJob(status: string, updatedAt: string | null | undefined, now = Date.now()): boolean {
  if (status !== 'queued' && status !== 'running') return false;
  const t = updatedAt ? Date.parse(updatedAt) : NaN;
  return Number.isFinite(t) && now - t > SCAN_JOB_STALE_MS;
}

/**
 * Claim a job for a /work request: queued, or running but stalled, flips to running with a fresh updated_at. The update
 * is conditional, so two screens driving the same job can never both run it. Returns whether this caller won.
 */
export async function claimScanJobForWork(
  svc: SupabaseClient, id: string, companyId: number | null, docType: ScanDocType, now = Date.now(),
): Promise<boolean> {
  const nowIso = new Date(now).toISOString();
  const cutoff = new Date(now - SCAN_JOB_STALE_MS).toISOString();
  let q = svc
    .from('scan_jobs')
    .update({ status: 'running', updated_at: nowIso })
    .eq('id', id)
    .eq('document_type', docType)
    .or(`status.eq.queued,and(status.eq.running,updated_at.lt.${cutoff})`);
  if (companyId != null) q = q.eq('company_id', companyId);
  const { data, error } = await q.select('id');
  if (error) {
    console.warn('[scan-job drive] claim failed:', id, error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

/**
 * Put a failed or stalled job back in the queue for the screen to drive again. Only a job whose photos were kept
 * (image_keys) can run again; anything else answers 'not_replayable' so the screen asks for a new scan.
 */
export async function requeueScanJob(
  svc: SupabaseClient, id: string, companyId: number | null, docType: ScanDocType, now = Date.now(),
): Promise<'requeued' | 'not_found' | 'not_replayable' | 'busy'> {
  let read = svc.from('scan_jobs').select('id, status, image_keys, updated_at').eq('id', id).eq('document_type', docType);
  if (companyId != null) read = read.eq('company_id', companyId);
  const { data, error } = await read.limit(1).maybeSingle();
  if (error || !data) return 'not_found';
  const r = data as Record<string, unknown>;
  const status = String(r.status ?? '');
  const keys = r.imageKeys ?? r.image_keys;
  if (!Array.isArray(keys) || keys.length === 0) return 'not_replayable';
  const updatedAt = (r.updatedAt ?? r.updated_at ?? null) as string | null;
  if (status !== 'error' && !isStalledScanJob(status, updatedAt, now)) return 'busy';

  const { data: moved } = await svc
    .from('scan_jobs')
    .update({ status: 'queued', error: null, retry_count: 0, updated_at: new Date(now).toISOString() })
    .eq('id', id)
    .eq('status', status)
    .select('id');
  return Array.isArray(moved) && moved.length > 0 ? 'requeued' : 'busy';
}

/**
 * What the reapers do with a stale first-attempt job they have just re-claimed (status queued, retry_count 1). Never
 * waitUntil: with a queue, hand it to the queue; without one, leave it queued for the screen's /work call.
 */
export async function handOffReclaimedJob(env: { SCAN_QUEUE?: { send(m: unknown): Promise<unknown> } }, id: string): Promise<void> {
  if (!env.SCAN_QUEUE) return;
  try {
    await env.SCAN_QUEUE.send({ jobId: id });
  } catch (e) {
    console.warn('[scan-job drive] SCAN_QUEUE.send failed for re-queued job:', id, (e as Error).message);
  }
}

const JOB_COLUMNS = 'id, status, salesperson, so_doc_no, linked_doc_no, document_type, error, sample_id, duplicate_of, image_keys, created_at, updated_at';
const DRIVE_FAILED = 'The scan stopped before it finished. Press Retry to run it again.';

/**
 * The body of POST /scan-{so,gr,pi}/jobs/:id/work: claim the job and run `run` (the route's own queue-consumer
 * function) inside this request, then read the row back for the screen. With a queue bound, or when another request
 * already holds the job, it only reads. Never throws: a failed run leaves the row in 'error' with a plain sentence.
 */
export async function workScanJob(
  env: { SCAN_QUEUE?: unknown },
  svc: SupabaseClient,
  id: string,
  companyId: number | null,
  docType: ScanDocType,
  run: (jobId: string) => Promise<void>,
): Promise<{ ran: boolean; job: Record<string, unknown> | null }> {
  let ran = false;
  if (!env.SCAN_QUEUE && (await claimScanJobForWork(svc, id, companyId, docType))) {
    ran = true;
    try {
      await run(id);
    } catch (e) {
      console.error('[scan-job drive] run threw:', id, (e as Error).message);
      await svc.from('scan_jobs')
        .update({ status: 'error', error: DRIVE_FAILED, updated_at: new Date().toISOString() })
        .eq('id', id).in('status', ['queued', 'running']);
    }
  }
  let q = svc.from('scan_jobs').select(JOB_COLUMNS).eq('id', id).eq('document_type', docType);
  if (companyId != null) q = q.eq('company_id', companyId);
  const { data } = await q.limit(1).maybeSingle();
  return { ran, job: (data as Record<string, unknown> | null) ?? null };
}

/** Plain sentences for the screen when Retry cannot run a job. */
export const REQUEUE_REASON: Record<'not_found' | 'not_replayable' | 'busy', string> = {
  not_found: 'That scan is no longer on the list.',
  not_replayable: 'The photos for this scan were not kept, so it cannot run again. Please scan it again.',
  busy: 'This scan is still running. Wait a moment, then try again.',
};
