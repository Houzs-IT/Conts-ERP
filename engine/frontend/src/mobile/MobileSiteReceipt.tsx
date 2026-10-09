/* Site receipt on the phone (renovation POD): the site supervisor, at the unit,
   ticks what arrived (or which trade finished), photographs it in place and
   the supplier's delivery order, signs, and optionally has the customer sign.
   It becomes the purchase order's goods receipt with no stock movement.

   Patterns from MobilePOD: uploads happen FIRST and a failed upload aborts the
   whole receipt; only a real stroke counts as a signature; the location is
   taken once and never blocks. One idempotency key per form, so a double tap
   or a retry after a lost response cannot receive twice. */

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Camera, MapPin, Trash2 } from "lucide-react";
import { renovationApi, type OpenLine } from "../pages/projects/renovation/renovationApi";
import { errorText } from "../pages/projects/renovation/renovationModel";
import { SignaturePad, canvasBlob, readGps, type GpsFix } from "../pages/projects/renovation/renovationUi";
import { useQuery } from "../hooks/useQuery";

export type PhotoKind = "in_place" | "supplier_do" | "after" | "before" | "defect";

export interface StagedPhoto { id: string; kind: PhotoKind; file: File; room: string }

export interface PickState { [poItemId: string]: number }

/** What still stops the receipt being sent, in the order the screen shows it. */
export function siteReceiptProblems(lines: readonly OpenLine[], picks: PickState, photos: readonly StagedPhoto[], supervisorSigned: boolean, customerSigned: boolean, customerName: string): string[] {
  const out: string[] = [];
  const picked = lines.filter((l) => (picks[l.po_item_id] ?? 0) > 0);
  if (picked.length === 0) out.push("Tick at least one line that arrived or was finished.");
  for (const l of picked) if ((picks[l.po_item_id] ?? 0) > l.remaining) out.push(`${l.material_name}: only ${l.remaining} left to receive.`);
  const kinds = new Set(photos.map((p) => p.kind));
  if (!kinds.has("in_place") && !kinds.has("after")) out.push("Add a photo of the items in place (or an after photo for a trade).");
  if (picked.some((l) => l.group !== "WORKS") && !kinds.has("supplier_do")) out.push("Add a photo of the supplier's delivery order.");
  if (!supervisorSigned) out.push("The site supervisor must sign.");
  if (customerSigned && !customerName.trim()) out.push("Write the customer's name next to their signature.");
  return out;
}

export function MobileSiteReceipt({ projectId, projectName, onBack, onDone }: { projectId: number; projectName: string; onBack: () => void; onDone: (msg: string) => void }) {
  const q = useQuery(["renovation", "open-lines", projectId], () => renovationApi.openLines(projectId), [projectId]);
  const lines = q.data?.data ?? [];
  const [picks, setPicks] = useState<PickState>({});
  const [photos, setPhotos] = useState<StagedPhoto[]>([]);
  const [supSigned, setSupSigned] = useState(false);
  const [custSigned, setCustSigned] = useState(false);
  const [custName, setCustName] = useState("");
  const [notes, setNotes] = useState("");
  const [gps, setGps] = useState<GpsFix | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supRef = useRef<HTMLCanvasElement | null>(null);
  const custRef = useRef<HTMLCanvasElement | null>(null);
  const idemKey = useRef(`site-receipt-${projectId}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const rooms = useMemo(() => [...new Set(lines.map((l) => l.room).filter((r): r is string => !!r))], [lines]);

  useEffect(() => { void readGps().then(setGps); }, []);

  const problems = siteReceiptProblems(lines, picks, photos, supSigned, custSigned, custName);

  function addPhotos(kind: PhotoKind, files: FileList | null) {
    if (!files) return;
    const room = rooms[0] ?? "";
    setPhotos((xs) => [...xs, ...[...files].map((f, i) => ({ id: `${Date.now()}-${i}-${f.name}`, kind, file: f, room }))]);
  }

  async function submit() {
    if (problems.length > 0) { setError(problems[0]!); return; }
    setBusy(true);
    setError(null);
    try {
      const uploaded = [];
      for (const p of photos) {
        const { key } = await renovationApi.upload(projectId, p.kind, p.file);
        uploaded.push({ r2Key: key, kind: p.kind, location: p.room || null, takenAt: new Date(p.file.lastModified || Date.now()).toISOString() });
      }
      const sup = await renovationApi.upload(projectId, "supervisor-signature", await canvasBlob(supRef.current!));
      const cust = custSigned ? await renovationApi.upload(projectId, "customer-signature", await canvasBlob(custRef.current!)) : null;
      const res = await renovationApi.siteReceipt({
        projectId,
        lines: lines.filter((l) => (picks[l.po_item_id] ?? 0) > 0).map((l) => ({ poItemId: l.po_item_id, qty: picks[l.po_item_id] })),
        photos: uploaded,
        supervisorSignatureR2Key: sup.key,
        customerSignerName: cust ? custName.trim() : null,
        customerSignatureR2Key: cust?.key ?? null,
        ...(gps ? { lat: gps.lat, lng: gps.lng, accuracyM: gps.accuracyM, locatedAt: gps.atIso } : {}),
        notes: notes.trim() || null,
      }, idemKey.current);
      const nos = res.created.map((c) => c.grnNumber).join(", ");
      onDone(`Received on site: ${nos}.${res.tasksCompleted ? ` ${res.tasksCompleted} task${res.tasksCompleted === 1 ? "" : "s"} completed.` : ""}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface-dim pb-28">
      <header className="sticky top-0 z-10 flex items-center gap-2 bg-surface border-b border-border px-3 py-3">
        <button type="button" aria-label="Back" onClick={onBack} className="p-1"><ArrowLeft size={20} /></button>
        <div className="min-w-0">
          <div className="text-base font-semibold text-ink">Receive on site</div>
          <div className="text-xs text-ink-secondary truncate">{projectName}</div>
        </div>
      </header>

      <div className="space-y-3 p-3">
        <section className="rounded-lg bg-surface border border-border p-3">
          <h2 className="text-sm font-semibold text-ink">What arrived or was finished</h2>
          {q.loading && <p className="mt-2 text-sm text-ink-secondary">Loading purchase orders...</p>}
          {q.error && <p role="alert" className="mt-2 text-sm text-err">{q.error}</p>}
          {!q.loading && !q.error && lines.length === 0 && <p className="mt-2 text-sm text-ink-secondary">Nothing is waiting to be received for this project.</p>}
          <ul className="mt-2 divide-y divide-border">
            {lines.map((l) => {
              const n = picks[l.po_item_id] ?? 0;
              return (
                <li key={l.po_item_id} className="py-2">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-5 w-5"
                      checked={n > 0}
                      onChange={(e) => setPicks((p) => ({ ...p, [l.po_item_id]: e.target.checked ? l.remaining : 0 }))}
                      aria-label={`Received ${l.material_name}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-ink">{l.description || l.material_name}</span>
                      <span className="block text-xs text-ink-secondary">{[l.room, l.po_number, l.supplier_name].filter(Boolean).join(" · ")} · {l.remaining} to receive</span>
                    </span>
                  </label>
                  {n > 0 && l.remaining > 1 && (
                    <div className="mt-1 ml-8 flex items-center gap-2 text-sm">
                      <button type="button" className="h-8 w-8 rounded border border-border" onClick={() => setPicks((p) => ({ ...p, [l.po_item_id]: Math.max(1, n - 1) }))} aria-label="Less">-</button>
                      <span aria-live="polite">{n}</span>
                      <button type="button" className="h-8 w-8 rounded border border-border" onClick={() => setPicks((p) => ({ ...p, [l.po_item_id]: Math.min(l.remaining, n + 1) }))} aria-label="More">+</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-lg bg-surface border border-border p-3">
          <h2 className="text-sm font-semibold text-ink">Photos</h2>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <PhotoButton label="Items in place" onFiles={(f) => addPhotos("in_place", f)} />
            <PhotoButton label="Supplier's DO" onFiles={(f) => addPhotos("supplier_do", f)} />
            <PhotoButton label="After (trade)" onFiles={(f) => addPhotos("after", f)} />
            <PhotoButton label="Defect" onFiles={(f) => addPhotos("defect", f)} />
          </div>
          {photos.length > 0 && (
            <ul className="mt-2 space-y-1">
              {photos.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate">{p.kind.replace("_", " ")}: {p.file.name}</span>
                  <select className="rounded border border-border px-1 py-1 text-xs" value={p.room} onChange={(e) => setPhotos((xs) => xs.map((x) => (x.id === p.id ? { ...x, room: e.target.value } : x)))} aria-label="Room">
                    <option value="">No room</option>
                    {rooms.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <button type="button" aria-label="Remove photo" onClick={() => setPhotos((xs) => xs.filter((x) => x.id !== p.id))}><Trash2 size={16} /></button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg bg-surface border border-border p-3 space-y-3">
          <SignaturePad canvasRef={supRef} onChange={setSupSigned} label="Site supervisor signature" />
          <div>
            <input className="w-full rounded-md border border-border px-3 py-2 text-sm" placeholder="Customer name (optional)" value={custName} onChange={(e) => setCustName(e.target.value)} />
          </div>
          <SignaturePad canvasRef={custRef} onChange={setCustSigned} label="Customer signature (optional)" />
          <textarea className="w-full rounded-md border border-border px-3 py-2 text-sm" rows={2} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <p className="flex items-center gap-1 text-xs text-ink-secondary"><MapPin size={12} />{gps === undefined ? "Reading location..." : gps ? `Location taken (±${Math.round(gps.accuracyM ?? 0)} m)` : "No location (denied or unavailable); the receipt can still be made."}</p>
        </section>

        {error && <p role="alert" className="rounded-md border border-err/30 bg-err-bg px-3 py-2 text-sm text-err">{error}</p>}
        {!error && problems.length > 0 && <p className="text-xs text-ink-secondary">{problems[0]}</p>}
      </div>

      <footer className="fixed bottom-0 left-0 right-0 border-t border-border bg-surface p-3">
        <button type="button" disabled={busy || lines.length === 0} onClick={submit} className="w-full rounded-md bg-primary py-3 text-white font-semibold disabled:opacity-50">
          {busy ? "Saving receipt..." : "Confirm received"}
        </button>
      </footer>
    </div>
  );
}

function PhotoButton({ label, onFiles }: { label: string; onFiles: (f: FileList | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" onClick={() => ref.current?.click()} className="flex items-center justify-center gap-1 rounded-md border border-border py-3 text-sm text-ink">
        <Camera size={16} />{label}
      </button>
      <input ref={ref} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} aria-label={label} />
    </>
  );
}
