/* The Beta Home and Calendar forms as dialogs, copied from the mockup's workForm, assignForm, bookForm and
   amendForm (app.js). They save through the board routes (renovationBetaBoardApi.ts); a failed save stays on the
   screen with its message. "Edit project dates" is the data-backed part of the mockup's projForm: the 3D and 2D
   start dates. Sent and approved come from Drawings, the handover date from the project page. */

import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { errorText } from "../projects/renovation/renovationModel";
import {
  add, amendDue, APPT_LABEL, apptKindOf, apptWho, apptWithDefault, bookIssue, dateHints, designKind, ds, EVENT_TYPES, isEventType, ord,
  type ApptKey, type BoardModel, type CalEvent, type DesignProject, type Kind, type Viewing,
} from "./renovationBetaBoard";
import {
  addAmendment, assignPeople, boardApi, type EventBody,
} from "./renovationBetaBoardApi";
import { Badge } from "./BetaCalParts";
import { BETA } from "./renovationBetaTheme";

export type BetaDialog =
  | { t: "work"; ev: CalEvent | null; day: string }
  | { t: "assign"; projectId: number }
  | { t: "book"; projectId: number; key: ApptKey }
  | { t: "amend"; projectId: number; k: Kind }
  | { t: "dates"; projectId: number };

export interface FormEnv {
  m: BoardModel;
  who: Viewing;
  onClose: () => void;
  /** Called after a save: the screen reloads the board and says what happened. `jumpTo` moves the calendar to a date. */
  onSaved: (text: string, jumpTo?: string) => void;
}

const IN: CSSProperties = {
  minHeight: 40, border: `1px solid ${BETA.border}`, borderRadius: 8, padding: "0 10px", font: "inherit", fontSize: 14, background: BETA.surface, width: "100%", color: BETA.ink,
};
const LB: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: BETA.muted };
const TWO: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 };
const NOTE: CSSProperties = { fontSize: 13, color: "#3F4947", padding: "10px 12px", borderRadius: 8, background: "#F2F5F4" };
const FOOT_BTN: CSSProperties = { minHeight: 42, padding: "0 14px", border: `1px solid ${BETA.border}`, borderRadius: 8, background: BETA.surface, font: "inherit", fontWeight: 600, cursor: "pointer", color: BETA.ink };

function Field({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return <label style={LB}>{label}{children}</label>;
}

interface ModalProps {
  title: string;
  sub?: string;
  onClose: () => void;
  onSubmit: () => Promise<void>;
  error: string | null;
  busy: boolean;
  children: ReactNode;
  /** The left-hand destructive button, e.g. Delete. */
  danger?: { label: string; onClick: () => void };
}

const FOCUSABLE = "input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]";

/** The mockup's modal: dim page, a white 520px form with the title, fields and Cancel / Save. */
export function BetaModal({ title, sub, onClose, onSubmit, error, busy, children, danger }: ModalProps): ReactElement {
  const titleId = useId();
  const box = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    box.current?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea")?.focus();
    return () => before?.focus();
  }, []);

  function keys(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
    if (e.key !== "Tab" || !box.current) return;
    const els = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (els.length === 0) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function submit(e: FormEvent): void {
    e.preventDefault();
    void onSubmit();
  }

  return (
    <div
      onKeyDown={keys}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(23,32,31,.55)", overflowY: "auto", padding: "24px 16px" }}
    >
      <form
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={submit}
        style={{ maxWidth: 520, margin: "0 auto", background: BETA.surface, borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", gap: 12, color: BETA.ink }}
      >
        <h2 id={titleId} style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{title}</h2>
        {sub && <div style={{ fontSize: 14, color: "#3F4947" }}>{sub}</div>}
        {children}
        {error && <div role="alert" style={{ fontSize: 13, color: "#A12622", padding: "10px 12px", borderRadius: 8, background: "#FDF1F0" }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "space-between" }}>
          {danger ? (
            <button type="button" onClick={danger.onClick} disabled={busy} style={{ minHeight: 42, padding: "0 14px", border: "1px solid #E8A5A2", borderRadius: 8, background: BETA.surface, color: "#A12622", font: "inherit", fontWeight: 600, cursor: "pointer" }}>
              {danger.label}
            </button>
          ) : <span />}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={onClose} style={FOOT_BTN}>Cancel</button>
            <button type="submit" disabled={busy} style={{ minHeight: 42, padding: "0 18px", border: 0, borderRadius: 8, background: BETA.accent, color: "#FFFFFF", font: "inherit", fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}>
              {busy ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

/** Runs one save: busy while it runs, its error text kept on the form, closing only when it worked. */
function useSave(env: FormEnv): { busy: boolean; error: string | null; setError: (t: string | null) => void; run: (fn: () => Promise<{ text: string; jumpTo?: string }>) => Promise<void> } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<{ text: string; jumpTo?: string }>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      env.onSaved(r.text, r.jumpTo);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

function PersonOptions({ m, blank }: { m: BoardModel; blank?: string }): ReactElement {
  return (
    <>
      {blank != null && <option value="">{blank}</option>}
      {m.people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
    </>
  );
}

const num = (v: string): number | null => (v === "" ? null : Number(v));

/* ---------- Add work / Edit work ---------- */

function WorkForm({ env, ev, day }: { env: FormEnv; ev: CalEvent | null; day: string }): ReactElement {
  const { m, who } = env;
  const isNew = !ev;
  const [type, setType] = useState<string>(ev?.type ?? "client");
  const [note, setNote] = useState(ev?.note ?? "");
  const [d, setD] = useState(ev?.d ?? day);
  const [t, setT] = useState(ev?.t ?? "");
  const [person, setPerson] = useState<string>(String(ev ? ev.who?.id ?? "" : who === "All" ? m.mePersonId ?? "" : who));
  const [project, setProject] = useState<string>(ev?.projectId != null ? String(ev.projectId) : "");
  const [done, setDone] = useState(ev?.done ?? false);
  const save = useSave(env);

  async function submit(): Promise<void> {
    await save.run(async () => {
      if (!isEventType(type)) throw new Error("Pick a type.");
      const body: EventBody = { projectId: num(project), onDate: d, atTime: t || null, type, note: note.trim() || null, personId: num(person) };
      if (ev?.eventId != null) await boardApi.saveEvent(ev.eventId, { ...body, done });
      else await boardApi.addEvent(body);
      return { text: "Saved", jumpTo: isNew ? d : undefined };
    });
  }

  async function remove(): Promise<void> {
    const id = ev?.eventId;
    if (id == null) return;
    await save.run(async () => {
      await boardApi.deleteEvent(id);
      return { text: "Deleted" };
    });
  }

  return (
    <BetaModal title={isNew ? "Add work" : "Edit work"} onClose={env.onClose} onSubmit={submit} error={save.error} busy={save.busy} danger={isNew ? undefined : { label: "Delete", onClick: () => void remove() }}>
      <Field label="Type">
        <select name="type" value={type} onChange={(e) => setType(e.target.value)} style={IN}>
          {EVENT_TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </Field>
      <Field label="Note">
        <input name="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Client meeting @ 11am" maxLength={500} style={IN} />
      </Field>
      <div style={TWO}>
        <Field label="Date"><input type="date" name="d" required value={d} onChange={(e) => setD(e.target.value)} style={IN} /></Field>
        <Field label="Time"><input type="time" name="t" value={t} onChange={(e) => setT(e.target.value)} style={IN} /></Field>
      </div>
      <div style={TWO}>
        <Field label="Who">
          <select name="who" value={person} onChange={(e) => setPerson(e.target.value)} style={IN}><PersonOptions m={m} blank="Nobody" /></select>
        </Field>
        <Field label="Project">
          <select name="p" value={project} onChange={(e) => setProject(e.target.value)} style={IN}>
            <option value="">(No project)</option>
            {m.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      </div>
      {!isNew && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
          <input type="checkbox" name="done" checked={done} onChange={(e) => setDone(e.target.checked)} style={{ width: 18, height: 18, accentColor: BETA.accent }} />
          Done
        </label>
      )}
    </BetaModal>
  );
}

/* ---------- Assign ---------- */

function AssignForm({ env, p }: { env: FormEnv; p: DesignProject }): ReactElement {
  const { m } = env;
  const [lead, setLead] = useState<string>(String(p.lead?.id ?? m.mePersonId ?? ""));
  const [w3, setW3] = useState<string>(String(p.by["3"]?.id ?? p.lead?.id ?? m.mePersonId ?? ""));
  const [w2, setW2] = useState<string>(String(p.by["2"]?.id ?? p.lead?.id ?? m.mePersonId ?? ""));
  const [site, setSite] = useState<string>(String(p.site?.id ?? ""));
  const save = useSave(env);

  async function submit(): Promise<void> {
    await save.run(async () => {
      const leadId = num(lead);
      if (leadId == null) throw new Error("Choose the design lead.");
      const siteId = num(site);
      await assignPeople(p.id, {
        ...(p.lead ? {} : { designerPersonId: leadId }),
        ...(siteId !== (p.site?.id ?? null) ? { picPersonId: siteId } : {}),
        person3dId: num(w3),
        person2dId: num(w2),
      });
      const name = (v: string): string => m.people.find((x) => String(x.id) === v)?.name ?? "";
      return { text: `Assigned · 3D ${name(w3)} · 2D ${name(w2)}${site ? ` · Site ${name(site)}` : ""}` };
    });
  }

  return (
    <BetaModal title="Assign" sub={p.name} onClose={env.onClose} onSubmit={submit} error={save.error} busy={save.busy}>
      {p.lead ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 8, background: "#E4F1EF", fontSize: 14 }}>
          <Badge name={p.lead.name} /><b>Design lead · {p.lead.name}</b><span style={{ color: BETA.muted, fontSize: 12 }}>(fixed)</span>
        </div>
      ) : (
        <Field label="Design lead (3D and 2D)">
          <select name="lead" required value={lead} onChange={(e) => setLead(e.target.value)} style={IN}><PersonOptions m={m} blank="Choose..." /></select>
        </Field>
      )}
      <div style={TWO}>
        <Field label="3D by"><select name="who3" value={w3} onChange={(e) => setW3(e.target.value)} style={IN}><PersonOptions m={m} /></select></Field>
        <Field label="2D by"><select name="who2" value={w2} onChange={(e) => setW2(e.target.value)} style={IN}><PersonOptions m={m} /></select></Field>
      </div>
      <Field label="Site PIC (handover lead)">
        <select name="site" value={site} onChange={(e) => setSite(e.target.value)} style={IN}><PersonOptions m={m} blank="Not chosen" /></select>
      </Field>
      <div style={NOTE}>They see it in their own Calendar right away. Only people who can edit projects can change this.</div>
    </BetaModal>
  );
}

/* ---------- Book time / appointment ---------- */

function BookForm({ env, p, k }: { env: FormEnv; p: DesignProject; k: ApptKey }): ReactElement {
  const { m } = env;
  const a = p.appts[k];
  const isNew = !a?.d;
  const [d, setD] = useState(a?.d ?? "");
  const [t, setT] = useState(a?.t ?? "");
  const [person, setPerson] = useState<string>(String(a ? apptWho(p, a)?.id ?? "" : p.lead?.id ?? ""));
  const [withText, setWithText] = useState(a?.with || apptWithDefault(p, k));
  const [done, setDone] = useState(a?.done ?? false);
  const save = useSave(env);
  const cm = p.appts.cm?.d;

  async function submit(): Promise<void> {
    await save.run(async () => {
      const issue = bookIssue(p, k, d);
      if (issue) throw new Error(issue);
      await boardApi.saveAppointment(p.id, apptKindOf(k), { onDate: d, atTime: t || null, personId: num(person), withText: withText.trim() || null });
      if (done && !a?.done) await boardApi.appointmentDone(p.id, apptKindOf(k));
      return { text: `Booked ${ds(d)}${t ? ` ${t}` : ""} · on the calendar` };
    });
  }

  async function cancelBooking(): Promise<void> {
    await save.run(async () => {
      await boardApi.deleteAppointment(p.id, apptKindOf(k));
      return { text: "Booking cancelled" };
    });
  }

  return (
    <BetaModal
      title={`${isNew ? "Book " : ""}${APPT_LABEL[k]}`}
      sub={p.name}
      onClose={env.onClose}
      onSubmit={submit}
      error={save.error}
      busy={save.busy}
      danger={isNew ? undefined : { label: "Cancel booking", onClick: () => void cancelBooking() }}
    >
      <div style={TWO}>
        <Field label="Date">
          <input type="date" name="bd" required value={d} min={k === "sb" && cm ? add(cm, 1) : undefined} onChange={(e) => setD(e.target.value)} style={IN} />
        </Field>
        <Field label="Time"><input type="time" name="bt" value={t} onChange={(e) => setT(e.target.value)} style={IN} /></Field>
      </div>
      <div style={TWO}>
        <Field label="ID going"><select name="who" value={person} onChange={(e) => setPerson(e.target.value)} style={IN}><PersonOptions m={m} blank="Nobody" /></select></Field>
        <Field label="With"><input name="bw" value={withText} onChange={(e) => setWithText(e.target.value)} maxLength={120} style={IN} /></Field>
      </div>
      {isNew ? (
        <div style={NOTE}>{k === "sb" && cm ? `Must be after the carpentry measure (${ds(cm)}). ` : ""}It will show on the calendar for everyone.</div>
      ) : (
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
          <input type="checkbox" name="bdone" checked={done} disabled={a?.done} onChange={(e) => setDone(e.target.checked)} style={{ width: 18, height: 18, accentColor: BETA.accent }} />
          Done
        </label>
      )}
    </BetaModal>
  );
}

/* ---------- + Amendment ---------- */

function AmendForm({ env, p, k }: { env: FormEnv; p: DesignProject; k: Kind }): ReactElement {
  const { m } = env;
  const n = p.design[k].am.length + 1;
  const [startOn, setStartOn] = useState(m.today);
  const [days, setDays] = useState(String(m.amd));
  const [note, setNote] = useState("");
  const save = useSave(env);
  const due = amendDue(startOn, Number(days));

  async function submit(): Promise<void> {
    await save.run(async () => {
      const count = Number(days);
      if (!Number.isInteger(count) || count < 1 || count > 30) throw new Error("Days needed must be a whole number from 1 to 30.");
      if (!note.trim()) throw new Error("Say what the client wants changed.");
      await addAmendment(p.id, { kind: designKind(k), startOn, days: count, note: note.trim(), defaultDays: m.amd });
      return { text: `Amendment added · due ${ds(add(startOn, count))}` };
    });
  }

  return (
    <BetaModal title={`${k}D ${ord(n)} amendment`} sub={`${p.name} · by ${p.by[k]?.name ?? "nobody yet"}`} onClose={env.onClose} onSubmit={submit} error={save.error} busy={save.busy}>
      <div style={TWO}>
        <Field label="Start amendment"><input type="date" name="as" required max={m.today} value={startOn} onChange={(e) => setStartOn(e.target.value)} style={IN} /></Field>
        <Field label="Days needed"><input type="number" name="adays" min={1} max={30} required value={days} onChange={(e) => setDays(e.target.value)} style={IN} /></Field>
      </div>
      <Field label="What does the client want changed?">
        <textarea name="anote" rows={3} required maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Move tall cabinet to the left, sink 300mm towards window" style={{ ...IN, padding: "8px 10px", minHeight: 70 }} />
      </Field>
      <div style={NOTE}>New deadline: <b>{due ? ds(due) : "–"}</b></div>
    </BetaModal>
  );
}

/* ---------- Edit project dates ---------- */

function DatesForm({ env, p }: { env: FormEnv; p: DesignProject }): ReactElement {
  const { m } = env;
  const first = { s3: p.design["3"].s ?? "", s2: p.design["2"].s ?? "" };
  const [s3, setS3] = useState(first.s3);
  const [s2, setS2] = useState(first.s2);
  const save = useSave(env);

  async function submit(): Promise<void> {
    await save.run(async () => {
      await boardApi.saveDesign(p.id, {
        ...(s3 !== first.s3 ? { start3dOn: s3 || null } : {}),
        ...(s2 !== first.s2 ? { start2dOn: s2 || null } : {}),
      });
      return { text: "Saved" };
    });
  }

  return (
    <BetaModal title="Edit project dates" sub={p.name} onClose={env.onClose} onSubmit={submit} error={save.error} busy={save.busy}>
      <div style={TWO}>
        <Field label="3D start"><input type="date" name="s3" value={s3} onChange={(e) => setS3(e.target.value)} style={IN} /></Field>
        <Field label="2D start"><input type="date" name="s2" value={s2} onChange={(e) => setS2(e.target.value)} style={IN} /></Field>
      </div>
      <div style={NOTE}>
        {dateHints(m, p, s3, s2).map((line) => <div key={line}>{line}</div>)}
      </div>
    </BetaModal>
  );
}

/* ---------- the one that picks the dialog ---------- */

export function BetaDialogs({ dialog, env }: { dialog: BetaDialog | null; env: FormEnv }): ReactElement | null {
  if (!dialog) return null;
  if (dialog.t === "work") return <WorkForm key={dialog.ev?.id ?? "new"} env={env} ev={dialog.ev} day={dialog.day} />;
  const p = env.m.byId.get(dialog.projectId);
  if (!p) return null;
  if (dialog.t === "assign") return <AssignForm env={env} p={p} />;
  if (dialog.t === "book") return <BookForm env={env} p={p} k={dialog.key} />;
  if (dialog.t === "amend") return <AmendForm env={env} p={p} k={dialog.k} />;
  return <DatesForm env={env} p={p} />;
}
