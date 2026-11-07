/* Draft delivery on the phone (owner, 7 Nov 2026): draft DOs as small job cards for production workers, by day. Tap one for
   the job; photos and who received it, then Mark complete confirms the DO. Boards PhoneDeliveries and PhoneDeliveryJob. */

import { useState, type ReactElement, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fmtDate, fmtQty } from "@2990s/shared";
import { PhotoAddButtons, PhotoUploads, usePhotoQueue } from "../components/PhotoAdd";
import { useNotify } from "../vendor/scm/components/NotifyDialog";
import { useToast } from "../hooks/useToast";
import { authedFetch } from "../vendor/scm/lib/authed-fetch";
import { uploadSlipFull } from "../vendor/scm/lib/slip";
import { cn } from "../lib/utils";
import { JOB_DAYS, isLate, jobsFor, todayKl, type DraftJob, type JobDay } from "./renovationDraftDeliveryModel";

const KEY = ["draft-deliveries"];
const CARD = "rounded-lg border border-border bg-surface";
const CAPS = "text-[10px] font-semibold uppercase tracking-[.1em] text-ink-muted";

function Pill({ late }: { late: boolean }): ReactElement {
  return <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", late ? "bg-err/10 text-err" : "bg-warning-bg text-warning-text")}>{late ? "Late" : "Coming"}</span>;
}

function Head({ title, sub, onBack }: { title: string; sub: ReactNode; onBack: () => void }): ReactElement {
  return (
    <div className="shrink-0 border-b border-border bg-surface px-4 pb-3 pt-3.5">
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Back" onClick={onBack} className="-ml-1 flex h-9 w-9 items-center justify-center text-ink-secondary"><ArrowLeft size={20} /></button>
        <h1 className="m-0 min-w-0 flex-1 truncate text-[20px] font-bold">{title}</h1>
      </div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">{sub}</div>
    </div>
  );
}

function Info({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return <div className="flex justify-between gap-3 py-1.5 text-[13px]"><span className="text-ink-secondary">{label}</span><span className="min-w-0 text-right font-semibold">{children}</span></div>;
}

function Job({ job, today, onBack, onDone }: { job: DraftJob; today: string; onBack: () => void; onDone: () => void }): ReactElement {
  const photos = usePhotoQueue(async (file) => (await uploadSlipFull({ file })).r2Key);
  const [receivedBy, setReceivedBy] = useState("");
  const [saving, setSaving] = useState(false);
  const notify = useNotify();
  const toast = useToast();
  const ready = photos.results.length > 0 && receivedBy.trim().length > 0 && !photos.busy;
  const complete = async (): Promise<void> => {
    setSaving(true);
    try {
      await authedFetch(`/production-orders/draft-deliveries/${encodeURIComponent(job.id)}/complete`, {
        method: "POST", body: JSON.stringify({ podKeys: photos.results, receivedBy: receivedBy.trim() }),
      });
      toast.success(`${job.doNumber} confirmed`);
      onDone();
    } catch (e) {
      notify({ title: "Not completed", body: e instanceof Error ? e.message : "Try again.", tone: "error" });
    } finally {
      setSaving(false);
    }
  };
  const pos = [...new Set(job.pos.map((p) => p.poNumber))];
  const suppliers = [...new Set(job.pos.map((p) => p.supplier).filter(Boolean))];
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg text-ink">
      <Head title={job.place} onBack={onBack} sub={<span className="flex items-center justify-between gap-2"><span>Arrives {[job.time, job.due ? fmtDate(job.due) : null].filter(Boolean).join(", ") || "date not set"}</span><Pill late={isLate(job, today)} /></span>} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-2.5 px-4 pb-4 pt-3">
          <section className={cn(CARD, "divide-y divide-border-subtle px-3 py-1")}>
            <Info label="Project">{job.projectCode ?? job.soDocNo ?? "-"}</Info>
            <Info label="Delivery order"><span className="font-mono">{job.doNumber}</span></Info>
            <Info label="Purchase order"><span className="font-mono">{pos.join(", ") || "-"}</span></Info>
            <Info label="Supplier">{suppliers.join(", ") || "-"}</Info>
          </section>
          <section className={cn(CARD, "p-3")}>
            <div className={CAPS}>Items · {job.items.length}</div>
            <ul className="m-0 mt-1 list-none divide-y divide-border-subtle p-0">
              {job.items.map((i, n) => (
                <li key={`${i.code}-${n}`} className="flex justify-between gap-3 py-1.5 text-[13px]"><span className="min-w-0">{i.description}</span><span className="whitespace-nowrap font-semibold">{fmtQty(Number(i.qty))} {i.uom ?? ""}</span></li>
              ))}
            </ul>
          </section>
          <section className={cn(CARD, "flex flex-col gap-2 p-3")}>
            <div className="flex items-baseline justify-between"><span className={CAPS}>POD photos · {photos.results.length}</span><span className="text-[12px] text-ink-muted">At least 1</span></div>
            <PhotoUploads queue={photos} />
            <PhotoAddButtons queue={photos} disabled={saving} />
          </section>
          <label className={cn(CARD, "block p-3")}>
            <span className={CAPS}>Received by</span>
            <input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} className="mt-1 h-11 w-full rounded-md border border-border bg-surface px-2.5 text-[14px]" />
          </label>
        </div>
      </div>
      <div className="shrink-0 border-t border-border bg-surface p-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        <button type="button" disabled={!ready || saving} onClick={() => void complete()} className="h-[52px] w-full rounded-md bg-sidebar text-[15px] font-bold text-white disabled:opacity-50">{saving ? "Completing…" : "Mark complete"}</button>
      </div>
    </div>
  );
}

export function MobileDraftDelivery({ onBack }: { onBack: () => void }): ReactElement {
  const q = useQuery({ queryKey: KEY, queryFn: () => authedFetch<{ jobs: DraftJob[] }>("/production-orders/draft-deliveries").then((r) => r.jobs) });
  const qc = useQueryClient();
  const [day, setDay] = useState<JobDay>("today");
  const [openId, setOpenId] = useState<string | null>(null);
  const today = todayKl();
  const jobs = q.data ?? [];
  const open = jobs.find((j) => j.id === openId);
  if (open) return <Job job={open} today={today} onBack={() => setOpenId(null)} onDone={() => { setOpenId(null); void qc.invalidateQueries({ queryKey: KEY }); }} />;
  const shown = jobsFor(jobs, day, today);
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg text-ink">
      <Head title="Draft delivery" onBack={onBack} sub={`${fmtDate(today)} · ${jobsFor(jobs, "today", today).length} to do`} />
      <div className="flex shrink-0 gap-1.5 overflow-x-auto px-4 pt-2.5">
        {JOB_DAYS.map((d) => (
          <button key={d.key} type="button" aria-pressed={day === d.key} onClick={() => setDay(d.key)}
            className={cn("min-h-[32px] whitespace-nowrap rounded-full border px-2.5 text-[12px] font-semibold", day === d.key ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface text-ink-secondary")}>
            {d.label} · {jobsFor(jobs, d.key, today).length}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-2 px-4 pb-4 pt-2.5">
          {q.isPending && <p className="py-6 text-center text-[13px] text-ink-muted">Loading deliveries…</p>}
          {q.error && <p role="alert" className="py-6 text-center text-[13px] text-err">{q.error instanceof Error ? q.error.message : "The deliveries could not be loaded."}</p>}
          {!q.isPending && !q.error && shown.length === 0 && <p className="py-6 text-center text-[13px] text-ink-muted">No deliveries for this day.</p>}
          {shown.map((j) => (
            <button key={j.id} type="button" onClick={() => setOpenId(j.id)} className={cn(CARD, "grid min-h-[64px] w-full grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-2.5 text-left")}>
              <b className="text-[15px] font-bold">{j.time ?? (j.due && j.due !== today ? fmtDate(j.due).slice(0, 5) : "Today")}</b>
              <span className="min-w-0">
                <b className="block truncate text-[14px] font-semibold">{j.place}</b>
                <span className="block truncate text-[12px] text-ink-muted">{j.items.length} item{j.items.length === 1 ? "" : "s"} · {j.doNumber}</span>
              </span>
              <Pill late={isLate(j, today)} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
