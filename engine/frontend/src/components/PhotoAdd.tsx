/* Add photo for work on site (owner, 7 Nov 2026): take several in a row with the camera, or pick many from the album. Two
   inputs because a phone cannot do both from one: `capture` opens the camera and takes one shot, `multiple` opens the album.
   Every photo uploads on its own, shows how it went, and a failed one can be tried again without the others. */

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactElement } from "react";
import { Camera, Images, RotateCw, Video, X } from "lucide-react";
import { HEIC_ACCEPT } from "../lib/heicToJpeg";
import { cn } from "../lib/utils";

export type PhotoState = "uploading" | "done" | "failed";
export interface PhotoJob<T> { id: number; file: File; name: string; state: PhotoState; result?: T; error?: string }

export interface PhotoQueue<T> {
  jobs: ReadonlyArray<PhotoJob<T>>;
  add: (files: FileList | readonly File[] | null) => void;
  retry: (id: number) => void;
  remove: (id: number) => void;
  /** Something is still going up. */
  busy: boolean;
  /** What each finished upload answered, in the order taken. */
  results: T[];
}

/** Uploads run one at a time: a phone on site has one slow connection. */
export function usePhotoQueue<T>(upload: (file: File) => Promise<T>, onSettled?: () => void): PhotoQueue<T> {
  const [jobs, setJobs] = useState<Array<PhotoJob<T>>>([]);
  const next = useRef(1);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const uploadRef = useRef(upload);
  uploadRef.current = upload;
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;
  const patch = useCallback((id: number, p: Partial<PhotoJob<T>>) => setJobs((all) => all.map((j) => (j.id === id ? { ...j, ...p } : j))), []);
  const run = useCallback((id: number, file: File) => {
    chain.current = chain.current.then(async () => {
      try {
        const result = await uploadRef.current(file);
        patch(id, { state: "done", result, error: undefined });
      } catch (e) {
        patch(id, { state: "failed", error: e instanceof Error ? e.message : "The photo did not upload." });
      }
      settledRef.current?.();
    });
  }, [patch]);
  const add = useCallback((files: FileList | readonly File[] | null) => {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;
    const made = list.map((file) => ({ id: next.current++, file, name: file.name, state: "uploading" as const }));
    setJobs((all) => [...all, ...made]);
    for (const j of made) run(j.id, j.file);
  }, [run]);
  const retry = useCallback((id: number) => {
    setJobs((all) => {
      const j = all.find((x) => x.id === id);
      if (j && j.state === "failed") run(j.id, j.file);
      return all.map((x) => (x.id === id ? { ...x, state: "uploading" as const, error: undefined } : x));
    });
  }, [run]);
  const remove = useCallback((id: number) => setJobs((all) => all.filter((x) => x.id !== id)), []);
  return {
    jobs, add, retry, remove, busy: jobs.some((j) => j.state === "uploading"),
    results: jobs.flatMap((j) => (j.state === "done" && j.result !== undefined ? [j.result] : [])),
  };
}

const ACCEPT = `image/*,${HEIC_ACCEPT}`;
const usesTouch = (): boolean => typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

function Thumb({ file }: { file: File }): ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (typeof URL.createObjectURL !== "function") return undefined;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  if (url && file.type.startsWith("video/")) return <video src={url} muted playsInline preload="metadata" className="h-full w-full object-cover" />;
  return url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <span className="block h-full w-full bg-surface-2" />;
}

/** The ways in, side by side. The same standard as every photo and video upload in the ERP (owner, Oct 2026; production
    and site, 8 Nov 2026): on a phone, after each shot a sheet comes back with Take another, so several are shot in a row
    without leaving the job; the album picks many at once. With video on, a video can be recorded or picked as well. */
export function PhotoAddButtons<T>({ queue, disabled, className, video }: { queue: PhotoQueue<T>; disabled?: boolean; className?: string; video?: boolean }): ReactElement {
  const [again, setAgain] = useState<null | "photo" | "video">(null);
  const button = "flex min-h-[44px] flex-1 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-ink";
  const row = "flex min-h-[48px] w-full cursor-pointer items-center gap-3 rounded-md border border-border bg-surface px-3.5 text-[14px] font-semibold text-ink";
  const albumAccept = video ? `${ACCEPT},video/*` : ACCEPT;
  // A label around the input keeps the press a real tap, so the phone lets the camera open again.
  const shot = (kind: "photo" | "video") => (e: ChangeEvent<HTMLInputElement>) => {
    const had = e.target.files?.length ?? 0;
    queue.add(e.target.files); e.target.value = "";
    if (had > 0 && usesTouch()) setAgain(kind);
  };
  const camera = (cls: string, label: string, kind: "photo" | "video", icon: ReactElement, aria = label) => (
    <label className={cls}>
      {icon}<span className={cls === row ? "flex-1" : undefined}>{label}</span>
      <input type="file" accept={kind === "video" ? "video/*" : ACCEPT} capture="environment" className="sr-only" aria-label={aria} disabled={disabled} onChange={shot(kind)} />
    </label>
  );
  const album = (cls: string, label: string) => (
    <label className={cls}>
      <Images size={16} aria-hidden="true" /><span className={cls === row ? "flex-1" : undefined}>{label}</span>
      <input type="file" accept={albumAccept} multiple className="sr-only" aria-label="Choose from album" disabled={disabled}
        onChange={(e) => { queue.add(e.target.files); e.target.value = ""; setAgain(null); }} />
    </label>
  );
  return (
    <>
      <div className={cn("flex gap-2", disabled && "pointer-events-none opacity-50", className)}>
        {camera(button, queue.jobs.length > 0 ? "Take another" : "Take photo", "photo", <Camera size={16} aria-hidden="true" />, "Take photo")}
        {video && camera(button, "Record video", "video", <Video size={16} aria-hidden="true" />)}
        {album(button, "From album")}
      </div>
      {again && (
        <div role="dialog" aria-label="Add another" className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setAgain(null)}>
          <div className="flex w-full flex-col gap-2 rounded-t-2xl bg-surface p-4 pb-6" onClick={(e) => e.stopPropagation()}>
            <span className="mb-1 text-[12px] text-ink-secondary">{queue.jobs.length} on this job so far. Uploads keep going in the background.</span>
            {again === "video"
              ? camera(row, "Record another", "video", <Video size={18} aria-hidden="true" />)
              : camera(row, "Take another", "photo", <Camera size={18} aria-hidden="true" />)}
            {video && (again === "video"
              ? camera(row, "Take a photo", "photo", <Camera size={18} aria-hidden="true" />)
              : camera(row, "Record a video", "video", <Video size={18} aria-hidden="true" />))}
            {album(row, "From album")}
            <button type="button" onClick={() => setAgain(null)} className="mt-2 min-h-[48px] rounded-md bg-ink text-[14px] font-semibold text-white">Done</button>
          </div>
        </div>
      )}
    </>
  );
}

/** How each upload is going. */
export function PhotoUploads<T>({ queue, hideDone }: { queue: PhotoQueue<T>; hideDone?: boolean }): ReactElement | null {
  const shown = hideDone ? queue.jobs.filter((j) => j.state !== "done") : queue.jobs;
  if (shown.length === 0) return null;
  const done = queue.jobs.filter((j) => j.state === "done").length;
  return (
    <div className="flex flex-col gap-1.5">
      {queue.busy && <div role="status" className="text-[12px] text-ink-secondary">Uploading, {done} of {queue.jobs.length} done</div>}
      <ul className="m-0 grid list-none grid-cols-4 gap-1.5 p-0">
        {shown.map((j) => (
          <li key={j.id} className="relative aspect-square overflow-hidden rounded-md border border-border">
            <Thumb file={j.file} />
            {j.state === "uploading" && <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-[11px] font-semibold text-white">Uploading</span>}
            {j.state === "failed" && (
              <button type="button" aria-label={`Try ${j.name} again`} title={j.error} onClick={() => queue.retry(j.id)}
                className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-err/80 text-[11px] font-semibold text-white">
                <RotateCw size={15} aria-hidden="true" />Try again
              </button>
            )}
            {j.state !== "uploading" && (
              <button type="button" aria-label={`Remove ${j.name}`} onClick={() => queue.remove(j.id)}
                className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"><X size={13} aria-hidden="true" /></button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
