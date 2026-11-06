/* Add photo for work on site (owner, 7 Nov 2026): take several in a row with the camera, or pick many from the album. Two
   inputs because a phone cannot do both from one: `capture` opens the camera and takes one shot, `multiple` opens the album.
   Every photo uploads on its own, shows how it went, and a failed one can be tried again without the others. */

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { Camera, Images, RotateCw, X } from "lucide-react";
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
  return url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <span className="block h-full w-full bg-surface-2" />;
}

/** The two ways in, side by side. */
export function PhotoAddButtons<T>({ queue, disabled, className }: { queue: PhotoQueue<T>; disabled?: boolean; className?: string }): ReactElement {
  const camera = useRef<HTMLInputElement>(null);
  const button = "flex min-h-[44px] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-ink";
  return (
    <div className={cn("flex gap-2", disabled && "pointer-events-none opacity-50", className)}>
      <label className={button}>
        <Camera size={16} aria-hidden="true" />{queue.jobs.length > 0 ? "Take another" : "Take photo"}
        {/* After a shot the camera comes straight back on a phone, until it is cancelled. A browser may refuse: the button stays. */}
        <input ref={camera} type="file" accept={ACCEPT} capture="environment" className="sr-only" aria-label="Take photo" disabled={disabled}
          onChange={(e) => { queue.add(e.target.files); e.target.value = ""; if (usesTouch()) window.setTimeout(() => camera.current?.click(), 0); }} />
      </label>
      <label className={button}>
        <Images size={16} aria-hidden="true" />From album
        <input type="file" accept={ACCEPT} multiple className="sr-only" aria-label="Choose from album" disabled={disabled}
          onChange={(e) => { queue.add(e.target.files); e.target.value = ""; }} />
      </label>
    </div>
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
