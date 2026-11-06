/* The working parts of a production order (owner, 6 Nov 2026), shared by the desktop page and the phone screen: the actions,
   their dialogs, the change notice, the day strip. Start with everything ready starts at once; only unready materials bring
   one short reminder. Complete has no pop-up. Before Start it is Add raw material; after it, Request more and Return stock. */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { fmtDate, fmtQty } from "@2990s/shared";
import { Button } from "../../components/Button";
import { ModalOverlay } from "../../components/scm-v2/DocumentRelationshipMapModal";
import { DocFilesViewer, FileThumb } from "../../components/doc-attachments/DocAttachments";
import { docFilesKey, filesBaseUrl, listDocFiles, uploadDocFile, type DocFile } from "../../components/doc-attachments/docAttachmentsApi";
import { HEIC_ACCEPT, toUploadableImage } from "../../lib/heicToJpeg";
import { cn } from "../../lib/utils";
import { todayMyt } from "../../vendor/scm/lib/dates";
import { useNotify } from "../../vendor/scm/components/NotifyDialog";
import { useToast } from "../../hooks/useToast";
import { useWarehouses } from "../../vendor/scm/lib/inventory-queries";
import {
  completeProductionOrder, useAddProductionMaterial, useAssignWorkers, useProductionMaterials, useMaterialStatus, useProductionWorkers, useRawSkus, useRequestMore, useReturnStock, useSetProductionTime, useStartProduction,
  type MaterialRow, type OrderChange, type ProductionProgress, type ProductionWorker,
} from "../../vendor/scm/lib/production-order-queries";
import { RawMaterialAddPanel, type RawPick } from "./RawMaterialAddPanel";
import { dayStrip, initialDay, materialTally, mytTime, pageStart, peopleOn, photoWord, shortDate } from "./renovationProductionDays";

const FIELD = "mt-1 block h-10 w-full rounded-md border border-border bg-surface px-2.5 text-[14px] text-ink";
const message = (e: unknown): string => (e instanceof Error ? e.message : "Something went wrong.");

/* A number typed over a leading zero reads 020 otherwise. */
const wholeEntry = (v: string): string => v.replace(/^0+(?=\d)/, "");

export function useOrderFiles(orderId: string) {
  const q = useQuery({ queryKey: docFilesKey("production_order", orderId), queryFn: () => listDocFiles("production_order", orderId), staleTime: 30_000 });
  /* The day strip is the order's own photos, wherever on it they were added; a photo shown from its PO stays on the PO. */
  const photos = useMemo(() => {
    const d = q.data;
    return [...(d?.files ?? []), ...(d?.lines ?? []).flatMap((l) => l.files)].filter((f) => f.kind === "image" && !f.from);
  }, [q.data]);
  return { ...q, photos };
}

export function useAddPhotos(orderId: string) {
  const qc = useQueryClient();
  const notify = useNotify();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const add = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy(true);
    let done = 0;
    try {
      for (const raw of Array.from(list)) {
        await uploadDocFile("production_order", orderId, await toUploadableImage(raw));
        done += 1;
      }
      toast.success(`${photoWord(done)} added`);
    } catch (e) {
      notify({ title: done > 0 ? `${photoWord(done)} added, then it stopped` : "Photo not added", body: message(e), tone: "error" });
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: docFilesKey("production_order", orderId) });
    }
  };
  return { add, busy };
}

/** Start and Complete, with their one reminder. The screen supplies the buttons; both behave alike on desktop and phone. */
export function useProductionPress(order: { id: string; po_number: string; title: string }, refetch: () => void) {
  const materials = useProductionMaterials(order.id);
  const statuses = useMaterialStatus(order.id);
  const start = useStartProduction(order.id);
  const notify = useNotify();
  const toast = useToast();
  const [completing, setCompleting] = useState<string | null>(null);
  const [reminder, setReminder] = useState(false);
  const rows = materials.data ?? [];
  const tally = materialTally(rows, statuses.data, fmtDate);

  const startNow = () => {
    setReminder(false);
    start.mutate(undefined, {
      onSuccess: () => toast.success(`${order.po_number} started`),
      onError: (e) => notify({ title: "Not started", body: message(e), tone: "error" }),
    });
  };
  /* The reminder must read today's stock, so a list still loading or refreshing is waited for. */
  const pressStart = async () => {
    const list = (materials.isFetching ? (await materials.refetch()).data : materials.data) ?? [];
    const fresh = statuses.isFetching || !statuses.data ? (await statuses.refetch()).data : statuses.data;
    if (materialTally(list, fresh, fmtDate).ready) startNow(); else setReminder(true);
  };
  const complete = async () => {
    try {
      await completeProductionOrder(order.id, setCompleting);
      toast.success(`${order.po_number} complete. GR and DO are ready.`);
    } catch (e) {
      notify({ title: "Complete stopped", body: `${message(e)} What was already raised stays; Retry carries on from there.`, tone: "error" });
    } finally {
      setCompleting(null);
      refetch();
    }
  };
  const dialog = (
    <ModalOverlay open={reminder} onClose={() => setReminder(false)} title="Raw materials not ready"
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setReminder(false)}>Not yet</Button><Button onClick={startNow} disabled={start.isPending}>Start anyway</Button></div>}>
      <p className="mb-3 text-[13px] text-ink-secondary">{order.title} · {order.po_number}</p>
      <div className="flex gap-2 rounded-md bg-warning-bg px-2.5 py-2 text-[13px] text-warning-text">
        <b className="font-bold">!</b>
        <span><b className="font-semibold">{tally.readyCount} of {tally.total} ready</b><br /><span className="text-[12px]">{tally.tally.split(" · ").slice(1).join(", ") || "Some are not here yet"}. The rest can come later.</span></span>
      </div>
    </ModalOverlay>
  );
  return { pressStart, starting: start.isPending, complete, completing, dialog, tally, materials: rows, statuses: statuses.data };
}

/** Add raw material before Start, on the phone. The desktop page has the same panel inline. */
export function AddMaterialDialog({ orderId, taken, open, onClose }: { orderId: string; taken: ReadonlySet<string>; open: boolean; onClose: () => void }) {
  const skus = useRawSkus(open);
  const add = useAddProductionMaterial(orderId);
  const toast = useToast();
  const onAdd = async (picks: RawPick[]) => {
    for (const p of picks) await add.mutateAsync({ itemCode: p.code, qtyNeeded: p.qty, processingDate: null, deliveryDate: null });
    toast.success(`${picks.length} raw material${picks.length === 1 ? "" : "s"} added`);
    onClose();
  };
  return (
    <ModalOverlay open={open} onClose={onClose} title="Add raw material">
      {open && <RawMaterialAddPanel skus={skus.data ?? []} taken={taken} onAdd={onAdd} />}
    </ModalOverlay>
  );
}

export function RequestMoreDialog({ orderId, open, onClose }: { orderId: string; open: boolean; onClose: () => void }) {
  const skus = useRawSkus(open);
  const request = useRequestMore(orderId);
  const notify = useNotify();
  const toast = useToast();
  const [code, setCode] = useState("");
  const [qty, setQty] = useState("");
  const [neededBy, setNeededBy] = useState("");
  useEffect(() => { if (open) { setCode(""); setQty(""); setNeededBy(""); } }, [open]);
  const n = Number(qty);
  const send = () => request.mutate({ itemCode: code, qty: n, neededBy: neededBy || null }, {
    onSuccess: (r) => { toast.success(r.short ? `${code} added: it shows Short until it is bought` : `${code} taken from stock`); onClose(); },
    onError: (e) => notify({ title: "Not requested", body: message(e), tone: "error" }),
  });
  return (
    <ModalOverlay open={open} onClose={onClose} title="Request more"
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={send} disabled={!code || !(n > 0) || request.isPending}>Send request</Button></div>}>
      <p className="mb-3 text-[13px] text-ink-secondary">The extra goes to Raw materials and shows Short until it is bought.</p>
      <label className="mb-2.5 block text-[13px] text-ink-secondary">Raw material
        <select className={FIELD} aria-label="Raw material" value={code} onChange={(e) => setCode(e.target.value)}>
          <option value="">Choose a raw material</option>
          {(skus.data ?? []).map((s) => <option key={s.code} value={s.code}>{s.name ? `${s.name} · ${s.code}` : s.code}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2.5">
        <label className="block text-[13px] text-ink-secondary">Quantity
          <input className={FIELD} aria-label="Quantity" type="number" min="1" step="1" inputMode="numeric" value={qty} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setQty(wholeEntry(e.target.value))} />
        </label>
        <label className="block text-[13px] text-ink-secondary">Needed by
          <input className={FIELD} aria-label="Needed by" type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
        </label>
      </div>
    </ModalOverlay>
  );
}

export function ReturnStockDialog({ orderId, materials, open, onClose }: { orderId: string; materials: readonly MaterialRow[]; open: boolean; onClose: () => void }) {
  const warehouses = useWarehouses({});
  const back = useReturnStock(orderId);
  const notify = useNotify();
  const toast = useToast();
  const out = materials.filter((m) => m.qty_issued - m.qty_returned > 0);
  const places = (warehouses.data ?? []).filter((w) => w.code !== "ONSITE");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [where, setWhere] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setQty({}); setWhere({}); } }, [open]);
  const fallback = places[0]?.id ?? "";
  const lines = out.flatMap((m) => {
    const n = Number(qty[m.id] ?? 0);
    return n > 0 ? [{ materialId: m.id, qty: n, warehouseId: where[m.id] ?? fallback, uom: m.uom }] : [];
  });
  const total = lines.reduce((t, l) => t + l.qty, 0);
  const uoms = new Set(lines.map((l) => l.uom ?? ""));
  const bad = out.some((m) => { const n = Number(qty[m.id] ?? 0); return n < 0 || n > m.qty_issued - m.qty_returned || !Number.isInteger(n); });
  const send = () => back.mutate(lines.map(({ materialId, qty: q, warehouseId }) => ({ materialId, qty: q, warehouseId })), {
    onSuccess: () => { toast.success("Stock returned"); onClose(); },
    onError: (e) => notify({ title: "Not returned", body: message(e), tone: "error" }),
  });
  return (
    <ModalOverlay open={open} onClose={onClose} title="Return stock" size="lg"
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={send} disabled={total === 0 || bad || !fallback || back.isPending}>{total > 0 ? `Return ${total}${uoms.size === 1 ? ` ${[...uoms][0]}` : ""}` : "Return"}</Button></div>}>
      <p className="mb-3 text-[13px] text-ink-secondary">Used less than listed? Send it back and pick the warehouse.</p>
      {out.length === 0 ? <p className="text-[13px] text-ink-muted">Nothing has left stock for this order.</p> : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_72px_108px] gap-2 pb-1.5 font-mono text-[10px] font-semibold uppercase tracking-brand text-ink-muted"><span>Raw material</span><span>Return</span><span>Warehouse</span></div>
          {out.map((m) => (
            <div key={m.id} className="grid grid-cols-[minmax(0,1fr)_72px_108px] items-center gap-2 border-t border-border-subtle py-2">
              <div className="min-w-0">
                <b className="block truncate text-[13px] font-semibold">{m.description || m.item_code}</b>
                <div className="text-[12px] text-ink-muted">{m.item_code} · taken {m.qty_issued - m.qty_returned} {m.uom ?? ""}</div>
              </div>
              <input aria-label={`Return qty of ${m.item_code}`} type="number" min="0" step="1" inputMode="numeric" placeholder="0" value={qty[m.id] ?? ""} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setQty({ ...qty, [m.id]: wholeEntry(e.target.value) })}
                className="h-10 w-full rounded-md border border-border bg-surface px-2 text-right text-[13px]" />
              <select aria-label={`Warehouse for ${m.item_code}`} value={where[m.id] ?? fallback} onChange={(e) => setWhere({ ...where, [m.id]: e.target.value })} className="h-10 w-full rounded-md border border-border bg-surface px-2 text-[14px]">
                {places.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
              </select>
            </div>
          ))}
        </>
      )}
    </ModalOverlay>
  );
}

export function ProductionTimeDialog({ orderId, hours, open, onClose }: { orderId: string; hours: number | null; open: boolean; onClose: () => void }) {
  const save = useSetProductionTime(orderId);
  const notify = useNotify();
  const [value, setValue] = useState("");
  useEffect(() => { if (open) setValue(hours == null ? "" : String(hours)); }, [open, hours]);
  const send = () => save.mutate(value.trim() === "" ? null : Number(value), {
    onSuccess: onClose,
    onError: (e) => notify({ title: "Not saved", body: message(e), tone: "error" }),
  });
  return (
    <ModalOverlay open={open} onClose={onClose} title="Set production time"
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={send} disabled={save.isPending}>Save</Button></div>}>
      <p className="mb-3 text-[13px] text-ink-secondary">The hours management gives this job.</p>
      <div className="flex items-baseline gap-2">
        <input aria-label="Production time in hours" type="number" min="0" step="0.5" inputMode="decimal" value={value} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setValue(wholeEntry(e.target.value))}
          className="h-14 w-[120px] rounded-md border border-border bg-surface px-3 text-right text-[26px] font-bold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
        <span className="text-[15px] font-semibold">hours</span>
      </div>
    </ModalOverlay>
  );
}

export function AssignDialog({ orderId, workers, open, onClose }: { orderId: string; workers: readonly ProductionWorker[]; open: boolean; onClose: () => void }) {
  const roster = useProductionWorkers(open);
  const assign = useAssignWorkers(orderId);
  const notify = useNotify();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  useEffect(() => { if (open) { setPicked(new Set(workers.filter((w) => w.how === "ASSIGNED").map((w) => w.person_key))); setQ(""); } }, [open, workers]);
  const shown = (roster.data ?? []).filter((w) => `${w.name} ${w.trade ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const send = () => assign.mutate([...picked], { onSuccess: onClose, onError: (e) => notify({ title: "Not assigned", body: message(e), tone: "error" }) });
  return (
    <ModalOverlay open={open} onClose={onClose} title="Assign workers"
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={send} disabled={assign.isPending}>Assign {picked.size}</Button></div>}>
      <p className="mb-3 text-[13px] text-ink-secondary">Or leave it open: whoever presses Start becomes the worker.</p>
      <input aria-label="Search workers" placeholder="Search workers" value={q} onChange={(e) => setQ(e.target.value)} className="mb-2 h-10 w-full rounded-md border border-border bg-surface px-2.5 text-[13px]" />
      {roster.isSuccess && shown.length === 0 ? <p className="py-3 text-[13px] text-ink-muted">{(roster.data ?? []).length === 0 ? "No in-house technicians yet. Add them under HR." : "Nobody matches."}</p> : null}
      {shown.map((w) => (
        <label key={w.id} className="flex min-h-[44px] items-center gap-2.5 border-t border-border-subtle text-[13px]">
          <input type="checkbox" checked={picked.has(w.id)} onChange={() => toggle(w.id)} />
          <span className="flex-1"><b className="font-semibold">{w.name}</b> {w.trade ? <span className="text-[12px] text-ink-muted">{w.trade}</span> : null}</span>
        </label>
      ))}
    </ModalOverlay>
  );
}

export function ChangeNotice({ changes, phone }: { changes: readonly OrderChange[]; phone?: boolean }) {
  const first = changes[0];
  if (!first) return null;
  const more = changes.length - 1;
  return (
    <section role="status" className={cn("rounded-lg border border-warning-text/25 bg-warning-bg text-[13px] text-warning-text", phone ? "px-3 py-2.5" : "px-3.5 py-2.5")}>
      <b className="font-bold">New change from {first.source}</b> · {first.text}
      {more > 0 ? ` and ${more} more` : ""}
      {first.href ? <>, <Link to={first.href} className="font-semibold text-primary hover:underline">see what changed</Link></> : null}
    </section>
  );
}

export function ProgressBar({ pct, overdue }: { pct: number; overdue?: boolean }) {
  return <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className={cn("h-full", overdue ? "bg-err" : "bg-synced")} style={{ width: `${pct}%` }} /></div>;
}

function DayChip({ day, on, fixed, onClick }: { day: { label: string; date: string; photos: unknown[]; future: boolean }; on: boolean; fixed?: boolean; onClick: () => void }) {
  const n = day.photos.length;
  return (
    <button type="button" onClick={onClick} aria-pressed={on} data-on={on || undefined}
      className={cn("min-h-[60px] rounded-md border px-1.5 py-2 text-center", fixed ? "w-[76px] flex-none" : "w-full",
        on ? "border-sidebar bg-sidebar text-white" : "border-border bg-surface", !on && day.future ? "text-ink-muted" : !on ? "text-ink" : "")}>
      <b className="block text-[12px] font-semibold">{day.label}</b>
      <span className="block text-[11px] opacity-80">{shortDate(day.date)}</span>
      <span className={cn("mt-0.5 block text-[11px] font-semibold", on ? "text-white/80" : n === 0 && !day.future ? "text-warning-text" : "text-ink-muted")}>
        {n > 0 ? photoWord(n) : day.future ? "—" : "No photos"}
      </span>
    </button>
  );
}

const STRIP_PAGE = 8;

/** One line of days and the photos of the day picked. The desktop pages through a long job, the phone scrolls. */
export function ProgressPhotos({ orderId, progress, holidays, phone, canAdd, finishedOn }: { orderId: string; progress: ProductionProgress; holidays: readonly string[]; phone?: boolean; canAdd: boolean; finishedOn?: string | null }) {
  const today = todayMyt();
  const files = useOrderFiles(orderId);
  const days = useMemo(() => dayStrip(progress.planDays, files.photos, today, holidays, finishedOn), [progress.planDays, files.photos, today, holidays, finishedOn]);
  const [picked, setPicked] = useState<number | null>(null);
  const [offset, setOffset] = useState<number | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);
  const selected = Math.min(picked ?? initialDay(days, today), Math.max(0, days.length - 1));
  const day = days[selected];
  const paged = !phone && days.length > STRIP_PAGE;
  const start = offset ?? pageStart(selected, days.length, STRIP_PAGE);
  const shown = paged ? days.slice(start, start + STRIP_PAGE) : days;
  /* Sideways only: scrollIntoView would also pull the whole page down to the strip. */
  useEffect(() => {
    const strip = stripRef.current;
    const chip = strip?.querySelector<HTMLElement>("[data-on]");
    if (phone && strip && chip) strip.scrollLeft = chip.offsetLeft - strip.offsetLeft - (strip.clientWidth - chip.clientWidth) / 2;
  }, [phone, selected, days.length]);
  useEffect(() => { setShowAll(false); }, [selected]);
  const pick = (i: number) => { setPicked(i); };
  const photos = (day?.photos ?? []) as DocFile[];
  const limit = phone && !showAll && photos.length > 8 ? 7 : photos.length;
  if (days.length === 0) return <p className="px-3.5 py-3 text-[13px] text-ink-muted">Set the plan start and plan finish to see the days.</p>;
  return (
    <div className={phone ? "p-3" : "px-3.5 pb-3.5 pt-3"}>
      <div className={cn("flex gap-1.5", phone ? "mb-2.5" : "mb-3")}>
        {paged && <button type="button" aria-label="Earlier days" disabled={start === 0} onClick={() => setOffset(Math.max(0, start - STRIP_PAGE))} className="w-9 flex-none rounded-md border border-border bg-surface text-ink disabled:opacity-40"><ChevronLeft size={16} className="mx-auto" /></button>}
        <div ref={stripRef} className={cn("min-w-0 flex-1 gap-1.5", phone ? "flex overflow-x-auto [scrollbar-width:none]" : "grid")}
          style={phone ? undefined : { gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
          {shown.map((d) => { const i = days.indexOf(d); return <DayChip key={d.date} day={d} on={i === selected} fixed={phone} onClick={() => pick(i)} />; })}
        </div>
        {paged && <button type="button" aria-label="Later days" disabled={start + STRIP_PAGE >= days.length} onClick={() => setOffset(Math.min(days.length - STRIP_PAGE, start + STRIP_PAGE))} className="w-9 flex-none rounded-md border border-border bg-surface text-ink disabled:opacity-40"><ChevronRight size={16} className="mx-auto" /></button>}
      </div>
      {day && (
        <>
          <div className="mb-2 flex justify-between gap-2 text-[13px]">
            <b className="font-semibold">{phone && day.date === today ? "Today" : `${fmtDate(day.date)}${day.date === today ? " · Today" : ""}`}</b>
            {photos.length > 0 && <span className="text-ink-muted">{[photoWord(photos.length), peopleOn(photos)].filter(Boolean).join(" · ")}</span>}
          </div>
          {photos.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[13px] text-ink-muted">{day.future ? "This day has not come yet." : canAdd ? "No photos for this day. Press Add photos." : "No photos for this day."}</p>
          ) : (
            <div className={cn("grid gap-1.5", phone ? "grid-cols-4" : "grid-cols-8")}>
              {photos.slice(0, limit).map((f, i) => (
                <button key={f.id} type="button" aria-label={`Open photo taken at ${mytTime(f.at)}`} onClick={() => setViewing(i)} className="relative aspect-square overflow-hidden rounded-md bg-surface-2">
                  <FileThumb url={`${filesBaseUrl("production_order", orderId)}/${f.id}`} file={f} className="h-full w-full" />
                  <span className="absolute bottom-1 left-1 rounded bg-black/50 px-1 text-[11px] text-white">{mytTime(f.at)}</span>
                </button>
              ))}
              {limit < photos.length && (
                <button type="button" onClick={() => setShowAll(true)} className="aspect-square rounded-md bg-sidebar text-[15px] font-bold text-white">+{photos.length - limit}</button>
              )}
            </div>
          )}
        </>
      )}
      {viewing !== null && photos[viewing] && (
        <DocFilesViewer files={photos} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} baseUrlFor={() => filesBaseUrl("production_order", orderId)} />
      )}
    </div>
  );
}

export function ProgressSummary({ progress, hours, phone }: { progress: ProductionProgress; hours: number | null; phone?: boolean }) {
  const left = progress.daysLeft;
  const word = progress.overdue ? "Overdue" : "On track";
  return (
    <div className={phone ? "border-b border-border-subtle p-3" : "border-b border-border-subtle px-3.5 py-3"}>
      <ProgressBar pct={progress.pct} overdue={progress.overdue} />
      <div className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1.5 text-[13px]">
        <span>
          <span className={cn("inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", progress.overdue ? "bg-err/10 text-err" : "bg-synced/10 text-synced")}>{word}</span>
          {" "}<span className="text-ink-secondary">{progress.overdue ? "Past plan finish" : left == null ? "" : left === 0 ? "Last day" : `${left} day${left === 1 ? "" : "s"} left`}</span>
        </span>
        <span className="text-ink-secondary">{hours != null ? `${phone ? "" : "Production time "}${fmtQty(hours)} hours` : "No production time set"}</span>
      </div>
    </div>
  );
}

/** The right heading words for the upper case labels both screens use. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[9.5px] font-semibold uppercase tracking-brand text-ink-muted">{children}</span>;
}
