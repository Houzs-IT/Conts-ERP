/* The records of a simplified renovation project (owner decisions 11 and 14 Oct
   2026): the contract (read from the sales order only), the project team (Project
   PIC and Attending) and the unit key log. Each fact lives once, in its own
   module; this page only shows it or records it. Design lives in DesignTask.tsx. */

import { useState } from "react";
import { Link } from "react-router-dom";
import { FileText, KeyRound, Link2, Pencil, Plus, Trash2, Unlink, UserCircle2, Users, X } from "lucide-react";
import { useDialog } from "../../../hooks/useDialog";
import { cn } from "../../../lib/utils";
import { Button } from "../../../components/Button";
import { useQuery } from "../../../hooks/useQuery";
import { simpleApi, type AttendingPerson, type KeyMove, type ProjectDetailV2 } from "./simpleApi";
import { errorText, money, shortDate } from "./renovationModel";
import { Dialog, Field, inputClass, smallBtn, smallInput } from "./renovationUi";
import { PersonSelect, personPosition, usePeople } from "./PersonSelect";
import { daysBetween, keyDraftRefusal, keyLogRows, type KeyDraft } from "./keyLog";

type OnDone = (text: string) => void;
type OnError = (text: string) => void;

export const todayMyt = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

export function Card({ title, icon, children, actions }: { title: string; icon: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode }) {
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

/** Project PIC (one person) and Attending (several), both from the people master (owner, 14 Oct 2026). */
export function PeopleCard({ d, canWrite, onDone, onError }: { d: ProjectDetailV2; canWrite: boolean; onDone: OnDone; onError: OnError }) {
  const id = d.project.id;
  const save = async (b: Parameters<typeof simpleApi.setPeople>[1], text: string) => {
    try { await simpleApi.setPeople(id, b); onDone(text); } catch (e) { onError(errorText(e)); }
  };
  return (
    <Card title="Project team" icon={<Users size={14} />}>
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-secondary"><UserCircle2 size={11} />Project PIC</div>
      <PersonSelect label="Project PIC" value={d.people.pic.id} disabled={!canWrite} placeholder="Unassigned" className={smallInput}
        onChange={(v) => save({ picPersonId: v }, "Project PIC saved.")} />
      <div className="mt-3 border-t border-border pt-2">
        <AttendingPicker attending={d.people.attending} canWrite={canWrite}
          onSave={(ids, text) => save({ attendingPersonIds: ids }, text)} />
      </div>
    </Card>
  );
}

/* Same look and behaviour as the exhibition "Project team" panel (Projects.tsx
   ProjectTeamSection): chips with a remove x, a filter box, a ticked list, Add. */
export function AttendingPicker({ attending, canWrite, onSave }: {
  attending: AttendingPerson[]; canWrite: boolean; onSave: (ids: number[], text: string) => Promise<void>;
}) {
  const people = usePeople();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const taken = new Set(attending.map((a) => a.id));
  const available = (people.data?.data ?? []).filter((p) => p.active && !taken.has(p.id));
  const q = search.trim().toLowerCase();
  const filtered = q ? available.filter((p) => p.name.toLowerCase().includes(q)) : available;
  const current = attending.map((a) => a.id);

  async function run(ids: number[], text: string) {
    setBusy(true);
    try { await onSave(ids, text); } finally { setBusy(false); }
  }
  function toggle(pid: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid); else next.add(pid);
      return next;
    });
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-secondary">
        <Users size={11} />Attending<span className="ml-auto font-mono">{attending.length}</span>
      </div>
      {attending.length === 0 && <p className="text-xs text-ink-secondary">Nobody yet.</p>}
      {attending.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {attending.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-dim py-0.5 pl-2 pr-0.5 text-[11px]">
              <span className="font-medium text-ink">{a.name}{a.active ? "" : " (inactive)"}</span>
              {personPosition(a) && <span className="text-[10px] text-ink-secondary">· {personPosition(a)}</span>}
              {canWrite && (
                <button type="button" aria-label={`Remove ${a.name}`} disabled={busy}
                  className="rounded-full p-0.5 text-ink-secondary hover:bg-err/10 hover:text-err"
                  onClick={() => void run(current.filter((x) => x !== a.id), `${a.name} removed from attending.`)}>
                  <X size={11} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {canWrite && (
        <div className="mt-2">
          {people.loading ? <p className="text-xs text-ink-secondary">Loading people...</p>
            : available.length === 0 ? <p className="text-[11px] italic text-ink-secondary">{(people.data?.data ?? []).length === 0 ? "No people yet. Add them in Project Maintenance." : "Everyone is already attending."}</p>
            : !picking ? (
              <button type="button" onClick={() => setPicking(true)} className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-primary hover:underline">
                <Plus size={11} />Add people
              </button>
            ) : (
              <>
                <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter..." aria-label="Filter people" className={smallInput} />
                <div className="mt-1 max-h-44 overflow-auto rounded border border-border">
                  {filtered.length === 0 ? <div className="px-2 py-2 text-[11px] text-ink-secondary">No matches.</div> : filtered.map((p) => (
                    <label key={p.id} className="flex cursor-pointer items-center gap-2 border-t border-border px-2 py-1.5 text-[11px] first:border-t-0 hover:bg-surface-dim">
                      <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                      <span className="truncate text-ink">{p.name}{personPosition(p) && <span className="ml-1 text-[10px] text-ink-secondary">· {personPosition(p)}</span>}</span>
                      {p.phone && <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-secondary">{p.phone}</span>}
                    </label>
                  ))}
                </div>
                <button type="button" disabled={busy || selected.size === 0}
                  onClick={() => {
                    const add = [...selected].filter((x) => !taken.has(x));
                    void run([...current, ...add], `${add.length} added to attending.`).then(() => { setSelected(new Set()); setSearch(""); setPicking(false); });
                  }}
                  className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded border border-primary/40 bg-surface px-2 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50">
                  <Plus size={11} /> Add{selected.size > 0 ? ` ${selected.size} selected` : ""}
                </button>
                <button type="button" onClick={() => { setPicking(false); setSelected(new Set()); setSearch(""); }} className="mt-1 w-full text-center text-[11px] text-ink-secondary hover:text-ink">Cancel</button>
              </>
            )}
        </div>
      )}
    </div>
  );
}

/** The unit key (owner, 14 Oct 2026): "With X · day N", the latest moves (all on demand, each editable or deletable),
    and "+ Record key pass", a one-row form (Date / Passed by / Received by) with Passed by prefilled with the
    current holder. Messages show inside the card: the page banner sits above the fold when this card is in view,
    which is why a refused Add used to look like nothing happened. */
export function KeyCard({ d, canWrite, onDone }: { d: ProjectDetailV2; canWrite: boolean; onDone: OnDone; onError?: OnError }) {
  const id = d.project.id;
  const q = useQuery(["renovation", "keys", id], () => simpleApi.keyLog(id), [id]);
  const dialog = useDialog();
  const today = todayMyt();
  const holder = d.keyHolder;
  const fresh = (): KeyDraft => ({ on: today, from: holder?.personId ?? null, to: null });
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<KeyDraft>(fresh);
  const [editing, setEditing] = useState<{ moveId: number; draft: KeyDraft } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const rows = keyLogRows(q.data?.data ?? [], today);
  const loaded = !q.loading || q.data != null;
  const formOpen = canWrite && (adding || (loaded && rows.length === 0));
  const shown = showAll ? rows : rows.slice(0, 3);

  async function save(fn: () => Promise<unknown>, ok: string, after?: () => void) {
    setBusy(true);
    setMsg(null);
    try { await fn(); after?.(); q.reload(); setMsg({ tone: "ok", text: ok }); onDone(ok); }
    catch (e) { setMsg({ tone: "err", text: errorText(e) }); }
    finally { setBusy(false); }
  }
  function submitNew() {
    const refusal = keyDraftRefusal(draft, today);
    if (refusal) { setMsg({ tone: "err", text: refusal }); return; }
    void save(() => simpleApi.addKeyMove(id, { movedOn: draft.on, fromPersonId: draft.from, toPersonId: draft.to }), "Key pass recorded.",
      () => { setAdding(false); setDraft({ on: today, from: draft.to, to: null }); });
  }
  function submitEdit() {
    if (!editing) return;
    const refusal = keyDraftRefusal(editing.draft, today);
    if (refusal) { setMsg({ tone: "err", text: refusal }); return; }
    const e = editing;
    void save(() => simpleApi.editKeyMove(e.moveId, { movedOn: e.draft.on, fromPersonId: e.draft.from, toPersonId: e.draft.to }), "Key pass updated.", () => setEditing(null));
  }
  async function remove(r: KeyMove) {
    const text = `${shortDate(r.moved_on)}: ${r.from_person_name ?? "-"} to ${r.to_person_name ?? "-"}`;
    const ok = await dialog.confirm({ title: "Delete this key pass?", message: text, confirmLabel: "Delete", danger: true });
    if (ok) void save(() => simpleApi.deleteKeyMove(r.id), "Key pass deleted.");
  }

  return (
    <Card title="Unit key" icon={<KeyRound size={14} />}
      actions={canWrite && !formOpen ? (
        <button type="button" onClick={() => { setMsg(null); setDraft(fresh()); setAdding(true); }} className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-primary hover:underline">
          <Plus size={11} />Record key pass
        </button>
      ) : undefined}>
      <p className="text-xs">
        {holder
          ? <>With <span className="font-semibold text-ink">{holder.name ?? "someone not in the list"}</span> · day {daysBetween(holder.movedOn, today) + 1} <span className="text-ink-secondary">(since {shortDate(holder.movedOn)})</span></>
          : <span className="text-ink-secondary">No key pass recorded.</span>}
      </p>
      {formOpen && adding && <div aria-hidden className="fixed inset-0 z-40 bg-black/30 sm:hidden" onClick={() => setAdding(false)} />}
      {formOpen && (
        <div role={adding ? "dialog" : undefined} aria-label={adding ? "Record key pass" : undefined}
          className={cn("mt-2 rounded border border-border bg-surface p-1.5",
            adding && "max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-50 max-sm:mt-0 max-sm:rounded-b-none max-sm:rounded-t-xl max-sm:p-3 max-sm:shadow-lg")}>
          {adding && <div className="mb-2 text-sm font-semibold text-ink sm:hidden">Record key pass</div>}
          <KeyFields draft={draft} onChange={setDraft} today={today} prefix="New key pass" />
          <div className="mt-1 flex gap-1">
            {adding && <Button variant="ghost" className={cn(smallBtn, "flex-1")} disabled={busy} onClick={() => { setAdding(false); setMsg(null); }}>Cancel</Button>}
            <Button className={cn(smallBtn, "flex-1")} disabled={busy} onClick={submitNew}>{busy ? "Saving..." : "Add"}</Button>
          </div>
          {msg?.tone === "err" && !editing && <p role="alert" className="mt-1 text-xs text-err">{msg.text}</p>}
        </div>
      )}
      {msg && (msg.tone === "ok" || editing || !formOpen) && <p role={msg.tone === "err" ? "alert" : "status"} className={cn("mt-1 text-xs", msg.tone === "err" ? "text-err" : "text-synced")}>{msg.text}</p>}
      {q.loading && rows.length === 0 && <p className="mt-2 text-xs text-ink-secondary">Loading key log...</p>}
      {rows.length > 0 && (
        <div className="mt-2">
          <table className="w-full text-[11px]">
            <thead className="text-left text-ink-secondary">
              <tr>
                <th className="py-1 pr-2 font-medium">Date</th><th className="py-1 pr-2 font-medium">Passed by</th><th className="py-1 pr-2 font-medium">Received by</th>
                <th className="py-1 text-right font-medium">Days</th>{canWrite && <th className="w-12"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((r) => editing?.moveId === r.id ? (
                <tr key={r.id}>
                  <td colSpan={5} className="py-1.5">
                    <KeyFields draft={editing.draft} onChange={(x) => setEditing({ moveId: r.id, draft: x })} today={today} prefix="Edit key pass" />
                    <div className="mt-1 grid grid-cols-2 gap-1">
                      <Button variant="ghost" className={smallBtn} disabled={busy} onClick={() => setEditing(null)}>Cancel</Button>
                      <Button className={smallBtn} disabled={busy} onClick={submitEdit}>Save</Button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={r.id} className={r.current ? "font-medium text-ink" : "text-ink"}>
                  <td className="whitespace-nowrap py-1 pr-2">{shortDate(r.moved_on)}</td>
                  <td className="py-1 pr-2">{r.from_person_name ?? "-"}</td>
                  <td className="py-1 pr-2">{r.to_person_name ?? "-"}</td>
                  <td className="py-1 text-right tabular-nums">{r.daysHeld}</td>
                  {canWrite && (
                    <td className="whitespace-nowrap py-1 pl-1 text-right">
                      <button type="button" aria-label={`Edit key pass of ${shortDate(r.moved_on)}`} className="p-0.5 text-ink-secondary hover:text-ink" disabled={busy}
                        onClick={() => { setMsg(null); setEditing({ moveId: r.id, draft: { on: r.moved_on, from: r.from_person_id, to: r.to_person_id } }); }}>
                        <Pencil size={12} />
                      </button>
                      <button type="button" aria-label={`Delete key pass of ${shortDate(r.moved_on)}`} className="p-0.5 text-ink-secondary hover:text-err" disabled={busy}
                        onClick={() => void remove(r)}>
                        <Trash2 size={12} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 3 && (
            <button type="button" className="mt-1 text-[11px] text-primary hover:underline" onClick={() => setShowAll((x) => !x)}>
              {showAll ? "Show latest 3" : `Show all ${rows.length} moves`}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

/** Date, Passed by, Received by: one row of three columns. */
function KeyFields({ draft, onChange, today, prefix }: { draft: KeyDraft; onChange: (d: KeyDraft) => void; today: string; prefix: string }) {
  return (
    <div className="grid grid-cols-3 gap-1">
      <label className="min-w-0"><span className="block text-[10px] text-ink-secondary">Date</span>
        <input type="date" aria-label={`${prefix} date`} className={smallInput} value={draft.on} max={today} onChange={(e) => onChange({ ...draft, on: e.target.value })} /></label>
      <label className="min-w-0"><span className="block text-[10px] text-ink-secondary">Passed by</span>
        <PersonSelect label={`${prefix} passed by`} placeholder="Optional" value={draft.from} onChange={(v) => onChange({ ...draft, from: v })} className={smallInput} /></label>
      <label className="min-w-0"><span className="block text-[10px] text-ink-secondary">Received by</span>
        <PersonSelect label={`${prefix} received by`} placeholder="Pick" value={draft.to} onChange={(v) => onChange({ ...draft, to: v })} className={smallInput} /></label>
    </div>
  );
}
