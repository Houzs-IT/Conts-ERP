// ----------------------------------------------------------------------------
// scan-job-driver — the browser runs queued scan jobs (Conts, after Hookka #485).
//
// The engine has no Cloudflare Queue and no cron, and work started with
// ctx.waitUntil is cancelled ~30 s after the reply — shorter than a slip's OCR.
// So /scan-{so,gr,pi}/enqueue only stores the photos and a 'queued' job, and the
// open scan screen POSTs .../jobs/:id/work, a request the server keeps open
// until the job has run. A job whose request was cut (app closed, network
// dropped) goes stale on the server: the screen shows it as stalled or failed
// with a Retry button (.../jobs/:id/retry), and drives it again.
// ----------------------------------------------------------------------------

import { useEffect, useRef } from "react";
import { authedFetch } from "./authed-fetch";

export type ScanBase = "/scan-so" | "/scan-gr" | "/scan-pi";
type DrivableJob = { id: string; status: string; updatedAt: string | null };

/** Same window as the server (scan-job-drive.ts SCAN_JOB_STALE_MS). */
export const SCAN_JOB_STALE_MS = 3 * 60 * 1000;
/** At most this many held-open /work requests per tab: OCR calls are heavy. */
const MAX_DRIVING = 3;

/** Still queued/running on the server, but nothing has touched it for the stale window: its run was cut off. */
export function isStalledScanJob(j: DrivableJob, now = Date.now()): boolean {
  if (j.status !== "queued" && j.status !== "running") return false;
  const t = j.updatedAt ? Date.parse(j.updatedAt) : NaN;
  return Number.isFinite(t) && now - t > SCAN_JOB_STALE_MS;
}

/** Whether this tab should start a /work request for the job: queued, or running but stalled. */
export function shouldDrive(j: DrivableJob, now = Date.now()): boolean {
  return j.status === "queued" || (j.status === "running" && isStalledScanJob(j, now));
}

// Module-level, so two screens (or a remount) never drive the same job twice from one tab. The server's conditional
// claim stops two tabs or devices from doing so.
const driving = new Set<string>();

/** Start /work for every job that needs it, up to MAX_DRIVING at once. `onSettled` runs as each one answers. */
export function driveScanJobs(base: ScanBase, jobs: DrivableJob[], onSettled: () => void): void {
  for (const j of jobs) {
    if (driving.size >= MAX_DRIVING) return;
    if (driving.has(j.id) || !shouldDrive(j)) continue;
    driving.add(j.id);
    authedFetch(`${base}/jobs/${encodeURIComponent(j.id)}/work`, { method: "POST" })
      .catch(() => { /* the job's own row carries the outcome; the next poll shows it */ })
      .finally(() => {
        driving.delete(j.id);
        onSettled();
      });
  }
}

/** Drive the given jobs whenever the list changes, while the screen is open. */
export function useScanJobDriver(base: ScanBase, jobs: DrivableJob[], onSettled: () => void): void {
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const key = jobs.map((j) => `${j.id}:${j.status}:${j.updatedAt ?? ""}`).join("|");
  useEffect(() => {
    driveScanJobs(base, jobs, () => settled.current());
    // `key` stands for `jobs`: re-run only when a job's state actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, key]);
}

/** Put a failed or stalled scan back in the queue; the driver then runs it. Throws a plain sentence when it cannot. */
export async function retryScanJob(base: ScanBase, id: string): Promise<void> {
  await authedFetch(`${base}/jobs/${encodeURIComponent(id)}/retry`, { method: "POST" });
}
