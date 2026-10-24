/* The Beta Home and Calendar forms as dialogs, copied from the mockup's workForm, assignForm, bookForm and
   amendForm (app.js). They save through the board routes (renovationBetaBoardApi.ts); a failed save stays on the
   screen with its message. "Edit project dates" is the data-backed part of the mockup's projForm: the 3D and 2D
   start dates. Sent and approved come from Drawings, the handover date from the project page. */

import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { errorText } from "../projects/renovation/renovationModel";
import { peopleOptions, personLabel, usePeople } from "../projects/renovation/PersonSelect";
import type { Person } from "../projects/renovation/simpleApi";
import {
  add, amendDue, APPT_LABEL, apptKindOf, apptWho, apptWithDefault, bookIssue, dateHints, designKind, ds, EVENT_TYPES, initials, isEventType, ord,
  personInfo, type ApptKey, type BoardModel, type CalEvent, type DesignProject, type Kind, type Viewing,
} from "./renovationBetaBoard";
import {
  addAmendment, assignPeople, boardApi, type EventBody,
} from "./renovationBetaBoardApi";
import { BETA } from "./renovationBetaTheme";
import { MediaPicker } from "./BetaMedia";
import { uploadMeasureFile } from "./renovationBetaMediaApi";
import { simpleApi } from "../projects/renovation/simpleApi";

export type BetaDialog =
  | { t: "work"; ev: CalEvent | null; day: string }
  | { t: "assign"; projectId: number; role?: AssignRole }
  | { t: "measured"; projectId: number }
  | { t: "book"; projectId: number; key: ApptKey }
  | { t: "amend"; projectId: number; k: Kind }
  | { t: "dates"; projectId: number };

/** The header card the Assign dialog was opened from: that part opens ready to change. */
export type AssignRole = "lead" | "3" | "2" | "site";

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
    // Focus the dialog, not its first field: a field focused on open draws a box the owner read as a fault.
    box.current?.focus();
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
        tabIndex={-1}
        onSubmit={submit}
        style={{ outline: "none", maxWidth: 520, margin: "0 auto", background: BETA.surface, borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", gap: 12, color: BETA.ink }}
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

/* Every person picker here uses the project page's people rule (projects/renovation/PersonSelect.tsx): people linked to
   an active user account, labelled "Name · Position · Department", and the current pick kept even when it is no longer
   offered. Until that list arrives the board's own copy of it stands in. */
function useFormPeople(m: BoardModel): Person[] {
  const q = usePeople();
  if (q.data?.data) return q.data.data;
  return m.everyone.map((x) => ({
    id: x.id, name: x.name, roles: [], active: true, user_id: null, phone: null, notes: null, source: "board",
    position: x.position, department: x.department, offered: x.offered,
  }));
}

const noLongerListed = (p: Person): string => (p.offered === false || !p.active ? " (no longer listed)" : "");

function PersonOptions({ all, current, blank, skip = [] }: { all: readonly Person[]; current: readonly number[]; blank?: string; skip?: readonly number[] }): ReactElement {
  return (
    <>
      {blank != null && <option value="">{blank}</option>}
      {peopleOptions(all, undefined, current).filter((x) => !skip.includes(x.id)).map((x) => (
        <option key={x.id} value={x.id}>{personLabel(x)}{noLongerListed(x)}</option>
      ))}
    </>
  );
}

const AVATAR = (size: number): CSSProperties => ({
  flex: "none", width: size, height: size, borderRadius: size / 2, background: BETA.ink, color: "#FFFFFF", fontSize: size > 28 ? 12 : 10, fontWeight: 700,
  display: "inline-flex", alignItems: "center", justifyContent: "center",
});
const LIST: CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 };
const ROLE: CSSProperties = { fontSize: 11, color: BETA.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" };

/** One picked person: initials circle, name, and "Position · Department" from the account. */
function PersonCard({ person, name, role, tint, onRemove }: {
  person: Pick<Person, "position" | "department" | "offered" | "active"> | undefined; name: string; role?: string; tint?: boolean; onRemove?: () => void;
}): ReactElement {
  const info = personInfo(person ? { position: person.position ?? null, department: person.department ?? null } : undefined);
  return (
    <li style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 6px 6px 8px", minHeight: 48, borderRadius: 10, border: `1px solid ${tint ? "#A9D2CC" : BETA.line}`, background: tint ? "#E4F1EF" : BETA.surface, minWidth: 0 }}>
      <span aria-hidden="true" style={AVATAR(32)}>{initials(name)}</span>
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25, minWidth: 0, flex: 1 }}>
        {role && <span style={ROLE}>{role}</span>}
        <span style={{ fontSize: 14, fontWeight: 700, color: BETA.ink, overflowWrap: "anywhere" }}>{name}{person && (person.offered === false || !person.active) ? " (no longer listed)" : ""}</span>
        {info && <span style={{ fontSize: 12, color: BETA.muted, overflowWrap: "anywhere" }}>{info}</span>}
      </span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${name}`}
          style={{ flex: "none", width: 36, height: 36, border: 0, borderRadius: 8, background: "transparent", color: BETA.muted, fontSize: 20, lineHeight: 1, cursor: "pointer" }}>
          ×
        </button>
      )}
    </li>
  );
}

/** One person: a select of the offered people, and the pick shown as a card under it. */
function PersonPick({ label, name, all, value, onChange, blank, required, reveal }: {
  label: string; name: string; all: readonly Person[]; value: number | null; onChange: (id: number | null) => void; blank: string; required?: boolean; reveal?: boolean;
}): ReactElement {
  const ref = useRef<HTMLSelectElement>(null);
  useEffect(() => { if (reveal) ref.current?.scrollIntoView({ block: "nearest" }); }, [reveal]);
  const picked = value == null ? undefined : all.find((x) => x.id === value);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <Field label={label}>
        <select ref={ref} name={name} required={required} value={value ?? ""} onChange={(e) => onChange(num(e.target.value))} style={IN}>
          <PersonOptions all={all} current={value == null ? [] : [value]} blank={blank} />
        </select>
      </Field>
      {value != null && <ul style={LIST}><PersonCard person={picked} name={picked?.name ?? `Person ${value}`} /></ul>}
    </div>
  );
}

/** Several people: the picks as cards with a remove button, in the order picked, and a "Choose people" list with a
    search box and a tick box per person, so several can be ticked at once. Done keeps the ticks, Cancel drops them. */
function PeoplePick({ label, name, all, value, onChange, known, startOpen = false }: {
  label: string; name: string; all: readonly Person[]; value: number[]; onChange: (ids: number[]) => void; known: ReadonlyMap<number, string>; startOpen?: boolean;
}): ReactElement {
  const byId = new Map(all.map((x) => [x.id, x] as const));
  const [open, setOpen] = useState(startOpen);
  const [draft, setDraft] = useState<number[]>(value);
  const [find, setFind] = useState("");
  const listId = useId();
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) search.current?.focus(); }, [open]);

  const options = peopleOptions(all, undefined, value);
  const needle = find.trim().toLowerCase();
  const shown = needle ? options.filter((x) => personLabel(x).toLowerCase().includes(needle)) : options;

  function start(): void {
    setDraft(value);
    setFind("");
    setOpen(true);
  }
  function toggle(id: number): void {
    setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));
  }
  function done(): void {
    onChange(draft);
    setOpen(false);
  }
  function keys(e: KeyboardEvent<HTMLDivElement>): void {
    // Escape closes this list, not the whole dialog; Enter in the search box must not save the form.
    if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
    if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.type === "search") e.preventDefault();
  }

  return (
    <div role="group" aria-label={label} style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, gridColumn: open ? "1 / -1" : undefined }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, minHeight: 30 }}>
        <span style={{ fontSize: 12, color: BETA.muted }}>{label}</span>
        {!open && (
          <button type="button" name={name} onClick={start} aria-expanded={false} aria-controls={listId}
            style={{ minHeight: 30, padding: "0 10px", border: `1px solid ${BETA.accent}`, borderRadius: 8, background: BETA.surface, color: BETA.accentInk, font: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            {value.length ? "Change people" : "Choose people"}
          </button>
        )}
      </div>
      {open && (
        <div id={listId} onKeyDown={keys} style={{ border: `1px solid ${BETA.accent}`, borderRadius: 10, background: BETA.surface, boxShadow: "0 6px 20px rgba(23,32,31,.12)", overflow: "hidden" }}>
          <div style={{ padding: 8, borderBottom: `1px solid ${BETA.line}` }}>
            <input ref={search} type="search" aria-label={`Search people for ${label}`} placeholder="Search name, position or department" value={find} onChange={(e) => setFind(e.target.value)} style={{ ...IN, minHeight: 36 }} />
          </div>
          <ul aria-label={`People for ${label}`} style={{ listStyle: "none", margin: 0, padding: 4, maxHeight: 260, overflowY: "auto" }}>
            {shown.length === 0 && <li style={{ padding: "10px 8px", fontSize: 13, color: BETA.muted }}>{options.length ? "Nobody matches." : "No people yet."}</li>}
            {shown.map((x) => {
              const on = draft.includes(x.id);
              const info = personInfo({ position: x.position ?? null, department: x.department ?? null });
              return (
                <li key={x.id}>
                  <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", minHeight: 44, borderRadius: 8, cursor: "pointer", background: on ? "#E4F1EF" : undefined }}>
                    <input type="checkbox" checked={on} onChange={() => toggle(x.id)} aria-label={personLabel(x)} style={{ flex: "none", width: 18, height: 18, margin: 0, accentColor: BETA.accent }} />
                    <span aria-hidden="true" style={AVATAR(28)}>{initials(x.name)}</span>
                    <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25, minWidth: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: BETA.ink, overflowWrap: "anywhere" }}>{x.name}{noLongerListed(x)}</span>
                      {info && <span style={{ fontSize: 12, color: BETA.muted, overflowWrap: "anywhere" }}>{info}</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: 8, borderTop: `1px solid ${BETA.line}`, background: "#FAFBFB" }}>
            <span style={{ fontSize: 12, color: BETA.muted }}>{draft.length} picked</span>
            <span style={{ display: "flex", gap: 6 }}>
              <button type="button" onClick={() => setOpen(false)} style={{ ...FOOT_BTN, minHeight: 34, fontSize: 13 }}>Cancel</button>
              <button type="button" onClick={done} style={{ ...FOOT_BTN, minHeight: 34, fontSize: 13, background: BETA.accent, borderColor: BETA.accent, color: "#FFFFFF" }}>Done</button>
            </span>
          </div>
        </div>
      )}
      {value.length > 0 ? (
        /* Compact chips that wrap, so ten people take two lines, not ten rows (owner, 24 Oct 2026). */
        <ul aria-label={`${label} picked`} style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {value.map((id) => {
            const who = byId.get(id)?.name ?? known.get(id) ?? `Person ${id}`;
            const info = personInfo(byId.get(id) ? { position: byId.get(id)?.position ?? null, department: byId.get(id)?.department ?? null } : undefined);
            return (
              <li key={id} title={info || who} style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%", minHeight: 32, padding: "2px 2px 2px 3px", borderRadius: 16, border: `1px solid ${BETA.line}`, background: BETA.surface }}>
                <span aria-hidden="true" style={AVATAR(24)}>{initials(who)}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: BETA.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{who}</span>
                <button type="button" onClick={() => onChange(value.filter((x) => x !== id))} aria-label={`Remove ${who}`}
                  style={{ flex: "none", width: 26, height: 26, border: 0, borderRadius: 13, background: "transparent", color: BETA.muted, fontSize: 16, lineHeight: 1, cursor: "pointer" }}>×</button>
              </li>
            );
          })}
        </ul>
      ) : <div style={{ fontSize: 13, color: BETA.muted }}>Nobody yet.</div>}
    </div>
  );
}

/** The tick-box people picker of the Assign dialog, with its own people list, for any form that picks several people
    (the Drawings uploads' "drawn by", the site measure's "measured by"). */
export function BetaPeoplePicker({ label, value, onChange, name = "people" }: { label: string; value: number[]; onChange: (ids: number[]) => void; name?: string }): ReactElement {
  const q = usePeople();
  const all = q.data?.data ?? [];
  const known = new Map(all.map((x) => [x.id, x.name] as const));
  return <PeoplePick label={label} name={name} all={all} value={value} onChange={onChange} known={known} />;
}

/** Two columns that fall to one on a phone. */
const PICK_GRID: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, alignItems: "start" };

const num = (v: string): number | null => (v === "" ? null : Number(v));

/* ---------- Add work / Edit work ---------- */

function WorkForm({ env, ev, day }: { env: FormEnv; ev: CalEvent | null; day: string }): ReactElement {
  const { m, who } = env;
  const all = useFormPeople(m);
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
          <select name="who" value={person} onChange={(e) => setPerson(e.target.value)} style={IN}><PersonOptions all={all} current={person ? [Number(person)] : []} blank="Nobody" /></select>
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

function AssignForm({ env, p, role }: { env: FormEnv; p: DesignProject; role?: AssignRole }): ReactElement {
  const { m } = env;
  const all = useFormPeople(m);
  const [lead, setLead] = useState<number | null>(p.lead?.id ?? m.mePersonId ?? null);
  const [w3, setW3] = useState<number[]>(p.team["3"].map((x) => x.id));
  const [w2, setW2] = useState<number[]>(p.team["2"].map((x) => x.id));
  const [site, setSite] = useState<number | null>(p.site?.id ?? null);
  const save = useSave(env);
  // Names already on the project, so a person no longer listed keeps theirs.
  const known = new Map([...m.everyone, ...p.team["3"], ...p.team["2"]].map((x) => [x.id, x.name] as const));

  async function submit(): Promise<void> {
    await save.run(async () => {
      if (lead == null) throw new Error("Choose the design lead.");
      if (w3.length === 0 || w2.length === 0) throw new Error("Choose who does the 3D and who does the 2D.");
      await assignPeople(p.id, {
        ...(lead !== (p.lead?.id ?? null) ? { designerPersonId: lead } : {}),
        ...(site !== (p.site?.id ?? null) ? { picPersonId: site } : {}),
        person3dIds: w3,
        person2dIds: w2,
      });
      const names = (ids: readonly number[]): string => ids.map((id) => all.find((x) => x.id === id)?.name ?? known.get(id) ?? "").filter(Boolean).join(", ");
      return { text: `Assigned · 3D ${names(w3)} · 2D ${names(w2)}${site != null ? ` · Site ${names([site])}` : ""}` };
    });
  }

  return (
    <BetaModal title="Assign" sub={p.name} onClose={env.onClose} onSubmit={submit} error={save.error} busy={save.busy}>
      <PersonPick label="Design lead" name="lead" all={all} value={lead} onChange={setLead} blank="Choose..." required reveal={role === "lead"} />
      <div style={PICK_GRID}>
        <PeoplePick label="3D by" name="who3" all={all} value={w3} onChange={setW3} known={known} startOpen={role === "3"} />
        <PeoplePick label="2D by" name="who2" all={all} value={w2} onChange={setW2} known={known} startOpen={role === "2"} />
      </div>
      <PersonPick label="Site PIC (handover lead)" name="site" all={all} value={site} onChange={setSite} blank="Not chosen" reveal={role === "site"} />
      <div style={NOTE}>Every role can be changed here, the design lead too. Pick one or more people for the 3D and for the 2D. They see it in their own Calendar right away. Only people who can edit projects can change this.</div>
    </BetaModal>
  );
}

/* ---------- Book time / appointment ---------- */

function BookForm({ env, p, k }: { env: FormEnv; p: DesignProject; k: ApptKey }): ReactElement {
  const { m } = env;
  const all = useFormPeople(m);
  const a = p.appts[k];
  const isNew = !a?.d;
  const [d, setD] = useState(a?.d ?? "");
  const [t, setT] = useState(a?.t ?? "");
  const [person, setPerson] = useState<string>(String(a ? apptWho(p, a)?.id ?? "" : p.lead?.id ?? ""));
  const [withText, setWithText] = useState(a?.with || apptWithDefault(p, k));
  const [done, setDone] = useState(a?.done ?? false);
  const save = useSave(env);
  const cm = p.appts.cm?.d;
  // Ticking Done on a site measure records the measure: who measured is required, notes and photos are asked for.
  const recordsMeasure = k === "msr" && done && !p.measuredOn;
  const measure = useMeasureFields(all, person ? [Number(person)] : p.lead ? [p.lead.id] : []);

  async function submit(): Promise<void> {
    await save.run(async () => {
      const issue = bookIssue(p, k, d);
      if (issue) throw new Error(issue);
      if (recordsMeasure) measure.check(d);
      await boardApi.saveAppointment(p.id, apptKindOf(k), { onDate: d, atTime: t || null, personId: num(person), withText: withText.trim() || null });
      if (recordsMeasure) {
        const n = await measure.save(p.id, d);
        if (!a?.done) await boardApi.appointmentDone(p.id, apptKindOf(k));
        return { text: `Site measure recorded ${ds(d)}${n ? ` · ${n} ${n === 1 ? "file" : "files"}` : ""}` };
      }
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
        <Field label="ID going"><select name="who" value={person} onChange={(e) => setPerson(e.target.value)} style={IN}><PersonOptions all={all} current={person ? [Number(person)] : []} blank="Nobody" /></select></Field>
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
      {recordsMeasure && measure.fields(env.m)}
    </BetaModal>
  );
}

/* ---------- Site measure done ---------- */

/** Who measured (required), notes and photos (optional, asked for), as the site measure's Done asks them. */
function useMeasureFields(all: readonly Person[], firstPeople: number[]): {
  check: (on: string) => void; save: (projectId: number, on: string) => Promise<number>; fields: (m: BoardModel) => ReactElement;
} {
  const [people, setPeople] = useState<number[]>(firstPeople);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const check = (on: string): void => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) throw new Error("Give the day it was measured.");
    if (people.length === 0) throw new Error("Choose who measured.");
  };
  async function save(projectId: number, on: string): Promise<number> {
    check(on);
    const r = await simpleApi.addSiteMeasure(projectId, { doneOn: on, personIds: people, note: note.trim() || null });
    for (const f of files) await uploadMeasureFile(projectId, r.id, f);
    return files.length;
  }
  const fields = (m: BoardModel): ReactElement => {
    const known = new Map(m.everyone.map((x) => [x.id, x.name] as const));
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12, borderRadius: 10, border: `1px solid ${BETA.line}`, background: "#FAFBFB" }}>
        <PeoplePick label="Measured by (required)" name="measuredBy" all={all} value={people} onChange={setPeople} known={known} />
        <Field label="Notes (optional): sizes, things to watch">
          <textarea name="measureNote" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. living 5.2 m x 4.1 m, kitchen wall to hack, ceiling 2.9 m" style={{ ...IN, minHeight: 72, padding: "8px 10px", resize: "vertical" }} />
        </Field>
        <MediaPicker files={files} onChange={setFiles} label="Site photos or videos" onError={setFileError} />
        {fileError && <div role="alert" style={{ fontSize: 13, color: "#A12622" }}>{fileError}</div>}
      </div>
    );
  };
  return { check, save, fields };
}

function MeasureForm({ env, p }: { env: FormEnv; p: DesignProject }): ReactElement {
  const all = useFormPeople(env.m);
  const a = p.appts.msr;
  const [on, setOn] = useState(a?.d && a.d <= env.m.today ? a.d : env.m.today);
  const measure = useMeasureFields(all, a?.who ? [a.who.id] : p.lead ? [p.lead.id] : []);
  const save = useSave(env);
  async function submit(): Promise<void> {
    await save.run(async () => {
      const n = await measure.save(p.id, on);
      if (a?.d && !a.done) await boardApi.appointmentDone(p.id, apptKindOf("msr"));
      return { text: `Site measure recorded ${ds(on)}${n ? ` · ${n} ${n === 1 ? "file" : "files"}` : ""}` };
    });
  }
  return (
    <BetaModal title="Site measure done" sub={p.name} onClose={env.onClose} onSubmit={submit} error={save.error} busy={save.busy}>
      <Field label="Measured on (required)">
        <input type="date" name="measuredOn" required value={on} max={env.m.today} onChange={(e) => setOn(e.target.value)} style={IN} />
      </Field>
      {measure.fields(env.m)}
      <div style={NOTE}>The measure is what the project page and the 3D wait for. Photos and notes help the designer, so add them while you are on site.</div>
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
    if (s3 === first.s3 && s2 === first.s2) { env.onClose(); return; }
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
  if (dialog.t === "assign") return <AssignForm env={env} p={p} role={dialog.role} />;
  if (dialog.t === "measured") return <MeasureForm env={env} p={p} />;
  if (dialog.t === "book") return <BookForm env={env} p={p} k={dialog.key} />;
  if (dialog.t === "amend") return <AmendForm env={env} p={p} k={dialog.k} />;
  return <DatesForm env={env} p={p} />;
}
