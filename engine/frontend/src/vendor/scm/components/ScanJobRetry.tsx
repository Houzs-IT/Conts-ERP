// ----------------------------------------------------------------------------
// ScanJobRetry — the Retry button on a failed or stalled scan job card, shared
// by the mobile and desktop scan screens (scan-job-driver.ts explains why a job
// can stall). Retry puts the job back in the queue and the open screen runs it.
// ----------------------------------------------------------------------------

import { useState } from "react";
import { isStalledScanJob, retryScanJob, type ScanBase } from "../lib/scan-job-driver";

type Job = { id: string; status: string; updatedAt: string | null };

/** True when the card should offer Retry: the job failed, or its run was cut off and nothing is working on it. */
export const canRetryScanJob = (j: Job): boolean => j.status === "error" || isStalledScanJob(j);

export function ScanJobRetry({ base, job, onDone }: { base: ScanBase; job: Job; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!canRetryScanJob(job)) return null;
  const stalled = job.status !== "error";
  const retry = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await retryScanJob(base, job.id);
      onDone();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not retry this scan. Please scan it again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
      {stalled && (
        <span style={{ fontSize: 12, color: "#a16a2e" }}>This scan stopped part-way (the page was closed or the connection dropped).</span>
      )}
      <span>
        <button
          type="button"
          onClick={() => void retry()}
          disabled={busy}
          style={{ fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 8, border: "1px solid #c9ccc2", background: "#fff", cursor: busy ? "default" : "pointer" }}
        >
          {busy ? "Retrying…" : "Retry"}
        </button>
      </span>
      {problem && <span style={{ fontSize: 12, color: "#a33" }}>{problem}</span>}
    </div>
  );
}
