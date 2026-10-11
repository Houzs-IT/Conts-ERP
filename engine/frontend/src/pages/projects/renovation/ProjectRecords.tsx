/* The records of a simplified renovation project (owner decisions 11 Oct 2026):
   the contract (read from the sales order only), the people on it, design (site
   measure, 2D / 3D files) and the unit key log. Each fact lives once, in its own
   module; this page only shows it or records it. */

import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, KeyRound, Link2, Ruler, Unlink, Upload, Users } from "lucide-react";
import { Button } from "../../../components/Button";
import { useQuery } from "../../../hooks/useQuery";
import { simpleApi, type DesignFile, type ProjectDetailV2 } from "./simpleApi";
import { errorText, money, shortDate } from "./renovationModel";
import { AuthImage, Dialog, Field, inputClass } from "./renovationUi";
import { PersonSelect } from "./PersonSelect";

type OnDone = (text: string) => void;
type OnError = (text: string) => void;

const todayMyt = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

function Card({ title, icon, children, actions }: { title: string; icon: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">{icon}{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function ContractCard({ d, canWrite, onDone, onError }: { d: ProjectDetailV2; canWrite: boolean; onDone: OnDone; onError: OnError }) {
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const id = d.project.id;
  const hidden = d.financeHidden;
  return (
    <Card title="Contract (sales order)" icon={<FileText size={14} />}>
      {d.so ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <div className="col-span-2"><dt className="text-xs text-ink-secondary">Sales order</dt>
            <dd><Link className="text-primary" to={`/scm/renovation/sales-orders/${encodeURIComponent(d.so.doc_no)}`}>{d.so.doc_no}</Link>
              <span className="text-ink-secondary"> · {d.so.status.replace(/^RENO_/, "").replace(/_/g, " ").toLowerCase()} · {shortDate(d.so.so_date)}</span></dd></div>
          <div><dt className="text-xs text-ink-secondary">Contract total</dt><dd className="tabular-nums">{hidden ? "Hidden" : money(d.money.contractSen)}</dd></div>
          <div><dt className="text-xs text-ink-secondary">Received</dt>
            <dd className="tabular-nums">{hidden ? "Hidden" : d.money.receivedSen == null ? "Not available" : `${money(d.money.receivedSen)}${d.money.receivedPct != null ? ` (${d.money.receivedPct}%)` : ""}`}</dd></div>
          <div><dt className="text-xs text-ink-secondary">Variation orders</dt><dd>{d.vo == null ? "Not available" : d.vo.count === 0 ? "None" : `${d.vo.count} (${d.vo.approved} approved)`}</dd></div>
          {canWrite && <div className="flex items-end justify-end"><Button variant="ghost" icon={<Unlink size={14} />} onClick={() => setUnlinking(true)}>Unlink</Button></div>}
        </dl>
      ) : (
        <div className="space-y-2 text-sm">
          <p className="text-ink-secondary">Not signed yet: this project has no sales order. Payments, VOs and ordering all live under the sales order.</p>
          {canWrite && (
            <div className="flex flex-wrap gap-2">
              <Link to={`/scm/renovation/quotations?newFor=${id}`}><Button>Create quotation</Button></Link>
              <Button variant="secondary" icon={<Link2 size={14} />} onClick={() => setLinking(true)}>Link existing SO</Button>
            </div>
          )}
        </div>
      )}
      {linking && <LinkSoDialog projectId={id} onClose={() => setLinking(false)} onLinked={(doc) => { setLinking(false); onDone(`${doc} linked to this project.`); }} />}
      {unlinking && d.so && (
        <Dialog title={`Unlink ${d.so.doc_no}?`} onClose={() => setUnlinking(false)}
          footer={<>
            <Button variant="secondary" onClick={() => setUnlinking(false)}>Cancel</Button>
            <Button onClick={async () => {
              try { await simpleApi.unlinkSo(id); setUnlinking(false); onDone(`${d.so!.doc_no} is no longer linked to this project.`); }
              catch (e) { setUnlinking(false); onError(errorText(e)); }
            }}>Unlink</Button>
          </>}>
          <p className="text-sm text-ink-secondary">The sales order stays as it is; it just stops belonging to this project, and the site tasks made from its lines that nobody has touched are removed. This is refused once the handover is signed, a purchase order line was received, or a site task on its lines has started.</p>
        </Dialog>
      )}
    </Card>
  );
}

function LinkSoDialog({ projectId, onClose, onLinked }: { projectId: number; onClose: () => void; onLinked: (docNo: string) => void }) {
  const [q, setQ] = useState("");
  const list = useQuery(["renovation", "linkable-sos", q], () => simpleApi.linkableSos(q), [q]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Link an existing sales order" onClose={onClose}>
      <Field label="Search"><input className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder="SO number, customer, building" /></Field>
      <ul className="mt-2 max-h-72 space-y-1 overflow-auto">
        {list.loading && <li className="text-sm text-ink-secondary">Loading...</li>}
        {!list.loading && (list.data?.data ?? []).length === 0 && <li className="text-sm text-ink-secondary">No renovation sales order without a project matches.</li>}
        {(list.data?.data ?? []).map((s) => (
          <li key={s.doc_no}>
            <button type="button" disabled={busy} className="w-full rounded-md border border-border px-3 py-2 text-left text-sm hover:border-primary"
              onClick={async () => {
                setBusy(true); setError(null);
                try { await simpleApi.linkSo(projectId, s.doc_no); onLinked(s.doc_no); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
              }}>
              <span className="font-medium text-ink">{s.doc_no}</span>
              <span className="text-ink-secondary"> · {[s.debtor_name, s.building, s.unit_no].filter(Boolean).join(" · ")} · {shortDate(s.so_date)}</span>
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-2 text-sm text-err">{error}</p>}
    </Dialog>
  );
}

export function PeopleCard({ d, canWrite, onDone, onError }: { d: ProjectDetailV2; canWrite: boolean; onDone: OnDone; onError: OnError }) {
  const id = d.project.id;
  const save = async (b: Parameters<typeof simpleApi.setPeople>[1], text: string) => {
    try { await simpleApi.setPeople(id, b); onDone(text); } catch (e) { onError(errorText(e)); }
  };
  return (
    <Card title="People" icon={<Users size={14} />}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
        <Field label="Sales"><PersonSelect label="Sales" role="sales" value={d.people.sales.id} disabled={!canWrite} onChange={(v) => save({ salesPersonId: v }, "Sales person saved.")} /></Field>
        <Field label="Designer"><PersonSelect label="Designer" role="designer" value={d.people.designer.id} disabled={!canWrite} onChange={(v) => save({ designerPersonId: v }, "Designer saved.")} /></Field>
        <Field label="Renovation PIC"><PersonSelect label="Renovation PIC" role="reno_pic" value={d.people.renoPic.id} disabled={!canWrite} onChange={(v) => save({ renoPicPersonId: v }, "Renovation PIC saved.")} /></Field>
      </div>
      {!d.people.sales.id && d.so?.agent && <p className="mt-1 text-xs text-ink-secondary">Sales order agent: {d.so.agent}</p>}
    </Card>
  );
}

const KIND_LABEL: Record<DesignFile["kind"], string> = { "2d": "2D drawings", "3d": "3D design", other: "Other files" };

export function DesignCard({ projectId, canWrite, onDone, onError }: { projectId: number; canWrite: boolean; onDone: OnDone; onError: OnError }) {
  const q = useQuery(["renovation", "design", projectId], () => simpleApi.designRecords(projectId), [projectId]);
  const [measureOn, setMeasureOn] = useState(todayMyt());
  const [measurer, setMeasurer] = useState<number | null>(null);
  const [kind, setKind] = useState<DesignFile["kind"]>("2d");
  const [drawer, setDrawer] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<DesignFile | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const files = q.data?.files ?? [];
  const measures = q.data?.measures ?? [];

  async function run(fn: () => Promise<unknown>, text: string) {
    setBusy(true);
    try { await fn(); q.reload(); onDone(text); } catch (e) { onError(errorText(e)); } finally { setBusy(false); }
  }

  return (
    <Card title="Design" icon={<Ruler size={14} />}>
      <div className="text-sm">
        <div className="text-xs font-medium text-ink-secondary">Site measure</div>
        {measures.length === 0 ? <p className="text-ink-secondary">Not measured yet.</p> : (
          <ul className="mt-1 space-y-0.5">{measures.map((m) => <li key={m.id}>{shortDate(m.done_on)}{m.person_name ? ` · ${m.person_name}` : ""}{m.note ? ` · ${m.note}` : ""}</li>)}</ul>
        )}
        {canWrite && (
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[9rem_1fr_auto] items-end">
            <Field label="Date"><input type="date" className={inputClass} value={measureOn} max={todayMyt()} onChange={(e) => setMeasureOn(e.target.value)} /></Field>
            <Field label="Measured by"><PersonSelect label="Measured by" role="designer" value={measurer} onChange={setMeasurer} /></Field>
            <Button variant="secondary" disabled={busy || !measureOn} onClick={() => run(() => simpleApi.addSiteMeasure(projectId, { doneOn: measureOn, personId: measurer }), "Site measure recorded.")}>Record</Button>
          </div>
        )}
      </div>
      <div className="mt-3 border-t border-border pt-3 text-sm">
        {(["2d", "3d", "other"] as const).map((k) => {
          const list = files.filter((f) => f.kind === k);
          if (list.length === 0 && k === "other") return null;
          return (
            <div key={k} className="mb-2">
              <div className="text-xs font-medium text-ink-secondary">{KIND_LABEL[k]}</div>
              {list.length === 0 ? <p className="text-ink-secondary">None yet.</p> : (
                <ul className="mt-0.5 space-y-0.5">
                  {list.map((f, i) => (
                    <li key={f.id} className="flex flex-wrap items-baseline gap-x-1">
                      <button type="button" className="text-primary text-left" onClick={() => (f.external_url ? window.open(f.external_url, "_blank", "noopener") : setView(f))}>v{f.version} {f.file_name}</button>
                      {i === 0 && <span className="text-xs text-synced">latest</span>}
                      <span className="text-xs text-ink-secondary">{[f.person_name, f.uploaded_by_name ? `uploaded by ${f.uploaded_by_name}` : null, shortDate(f.uploaded_at)].filter(Boolean).join(" · ")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {canWrite && (
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[8rem_1fr_auto] items-end">
            <Field label="Kind">
              <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as DesignFile["kind"])}>
                <option value="2d">2D</option><option value="3d">3D</option><option value="other">Other</option>
              </select>
            </Field>
            <Field label="Drawn by"><PersonSelect label="Drawn by" role="designer" value={drawer} onChange={setDrawer} /></Field>
            <Button variant="secondary" icon={<Upload size={14} />} disabled={busy} onClick={() => fileRef.current?.click()}>Upload</Button>
            <input ref={fileRef} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.dwg,.zip" aria-label="Design file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void run(() => simpleApi.uploadDesignFile(projectId, kind, f, drawer, null), `${f.name} uploaded.`);
              }} />
          </div>
        )}
      </div>
      {view?.r2_key && (
        <Dialog title={`v${view.version} ${view.file_name}`} onClose={() => setView(null)}>
          {/\.(png|jpe?g|webp)$/i.test(view.r2_key)
            ? <AuthImage path={simpleApi.fileUrl(projectId, view.r2_key)} alt={view.file_name} className="w-full rounded" />
            : <p className="text-sm"><a className="text-primary" href={simpleApi.fileUrl(projectId, view.r2_key)} target="_blank" rel="noopener">Open the file</a></p>}
        </Dialog>
      )}
    </Card>
  );
}

export function KeyCard({ d, canWrite, onDone, onError }: { d: ProjectDetailV2; canWrite: boolean; onDone: OnDone; onError: OnError }) {
  const id = d.project.id;
  const q = useQuery(["renovation", "keys", id], () => simpleApi.keyLog(id), [id]);
  const [adding, setAdding] = useState(false);
  const [from, setFrom] = useState<number | null>(d.keyHolder?.personId ?? null);
  const [to, setTo] = useState<number | null>(null);
  const [on, setOn] = useState(todayMyt());
  const [busy, setBusy] = useState(false);
  const rows = q.data?.data ?? [];
  return (
    <Card title="Unit key" icon={<KeyRound size={14} />} actions={canWrite && !adding ? <Button variant="ghost" onClick={() => { setFrom(d.keyHolder?.personId ?? null); setAdding(true); }}>Record a pass</Button> : undefined}>
      <p className="text-sm">{d.keyHolder ? <>With <span className="font-medium">{d.keyHolder.name ?? "someone not in the list"}</span> since {shortDate(d.keyHolder.movedOn)}</> : <span className="text-ink-secondary">No key pass recorded.</span>}</p>
      {adding && (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Field label="Date"><input type="date" className={inputClass} value={on} max={todayMyt()} onChange={(e) => setOn(e.target.value)} /></Field>
          <Field label="Passed by"><PersonSelect label="Passed by" value={from} onChange={setFrom} /></Field>
          <Field label="Received by"><PersonSelect label="Received by" value={to} onChange={setTo} /></Field>
          <div className="sm:col-span-3 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button>
            <Button disabled={busy || (!from && !to)} onClick={async () => {
              setBusy(true);
              try { await simpleApi.addKeyMove(id, { movedOn: on, fromPersonId: from, toPersonId: to }); setAdding(false); q.reload(); onDone("Key pass recorded."); }
              catch (e) { onError(errorText(e)); } finally { setBusy(false); }
            }}>Save</Button>
          </div>
        </div>
      )}
      {rows.length > 0 && (
        <ul className="mt-2 divide-y divide-border text-xs">
          {rows.slice(0, 8).map((r) => <li key={r.id} className="py-1">{shortDate(r.moved_on)} · {r.from_person_name ?? "-"} to {r.to_person_name ?? "-"}{r.note ? ` · ${r.note}` : ""}</li>)}
        </ul>
      )}
    </Card>
  );
}
