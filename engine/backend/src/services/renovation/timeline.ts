/* The Timeline of a renovation project (owner, 15 Oct 2026): the same card as a service case's timeline.
   "System" entries are read from the history the project already keeps, nothing is copied:
     project_activity        created, SO linked / unlinked, customer info, team, key edits, site tasks, handover ...
     project_flow_log        manual step moves, back to following the data, hold set / cleared
     project_key_moves       each key pass
     project_design_records  each Onsite visit
     project_design_files    each 3D / 2D submission (by version)
     project_design_notes    3D notes and 2D amendment requests
     the project's POs, GRs and DOs (the same sets as the Procurement details hub, services/renovation/documents.ts)
     projects                created (when no activity row says so), handed over, completed (end_date / closed_at)
   Notes people add by hand live in project_timeline_notes (migration 0118), typed Customer / Design / Supplier /
   Site / Sales. Newest first. */

import { FLOW_STEP_DEFAULT_LABEL, HOLD_FLAG_LABEL, isFlowStepKey } from "../../scm/shared/renovation-stages";
import { projectDocSql } from "./documents";
import { isMissingRelation, type Db } from "./load";

export const TIMELINE_NOTE_TYPES = ["customer", "design", "supplier", "site", "sales"] as const;
export type TimelineNoteType = (typeof TIMELINE_NOTE_TYPES)[number];
export type TimelineCategory = "system" | TimelineNoteType;
export const TIMELINE_NOTE_MAX = 2000;

export interface TimelineEntry {
  /** unique across sources, e.g. "act:12", "note:3" */
  id: string;
  /** ISO time the entry sorts by */
  at: string;
  /** true when only the day is known (imported records, records dated another day than they were typed) */
  dateOnly: boolean;
  category: TimelineCategory;
  /** what happened, short; null for a hand-written note (its text is the headline) */
  title: string | null;
  body: string | null;
  by: string | null;
  /** the hand-written note's id, for archiving */
  noteId?: number;
}

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));

export function cleanTimelineNote(b: Record<string, unknown>): { ok: true; value: { type: TimelineNoteType; note: string } } | { ok: false; error: string; message: string } {
  const type = String(b.type ?? "").trim().toLowerCase();
  if (!(TIMELINE_NOTE_TYPES as readonly string[]).includes(type)) return { ok: false, error: "type_invalid", message: "Pick the note type." };
  const note = String(b.note ?? "").trim();
  if (!note) return { ok: false, error: "note_required", message: "Write the note first." };
  if (note.length > TIMELINE_NOTE_MAX) return { ok: false, error: "note_too_long", message: `A note can be up to ${TIMELINE_NOTE_MAX} characters.` };
  return { ok: true, value: { type: type as TimelineNoteType, note } };
}

/** Postgres text timestamps come as "2026-10-15T03:04:05Z", "2026-10-15 03:04:05" (UTC) or with an offset. */
export function isoOf(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const t = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s) ? `${s.replace(" ", "T")}Z` : s.replace(" ", "T");
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const mytDay = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600e3).toISOString().slice(0, 10);

/** A record with a business date (key moved on, visit done on, submitted on): it sorts at the moment it was
    typed when that was the same day, otherwise at noon of its date and shows the date only. */
export function datedAt(day: unknown, recordedAt: unknown): { at: string; dateOnly: boolean } | null {
  const rec = isoOf(recordedAt);
  const d = str(day)?.slice(0, 10) ?? null;
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return rec ? { at: rec, dateOnly: false } : null;
  if (rec && mytDay(rec) === d) return { at: rec, dateOnly: false };
  return { at: `${d}T04:00:00.000Z`, dateOnly: true };
}

const stepLabel = (labels: Record<string, string>, k: unknown) => {
  const key = String(k ?? "");
  return labels[key] ?? (isFlowStepKey(key) ? FLOW_STEP_DEFAULT_LABEL[key] : key || "-");
};
const humanize = (s: string) => {
  const t = s.replace(/_/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const arrow = (from: unknown, to: unknown) => `${str(from) ?? "-"} to ${str(to) ?? "-"}`;
const HOLD_LABEL: Readonly<Record<string, string | undefined>> = HOLD_FLAG_LABEL;
const TEAM: Record<string, string> = { sales_changed: "Sales person", designer_changed: "Designer", reno_pic_changed: "Project PIC" };

/** One project_activity row as words. */
export function activityText(a: Row): { title: string; body: string | null } {
  const action = String(a.action ?? "");
  const from = str(a.from_value);
  const to = str(a.to_value);
  const note = str(a.note);
  switch (action) {
    case "created": return { title: "Project created", body: to };
    case "so_linked": return { title: `Sales order ${to ?? ""} linked`.replace("  ", " "), body: null };
    case "so_unlinked": return { title: `Sales order ${from ?? ""} unlinked`.replace("  ", " "), body: null };
    case "customer_info_saved": return { title: "Customer information edited", body: note };
    case "customer_info_from_so": return { title: `Customer information filled from ${to ?? "the sales order"}`, body: null };
    case "attending_changed": return { title: "Attending changed", body: arrow(from, to) };
    case "key_move_edited": return { title: "Key pass edited", body: arrow(from, to) };
    case "key_move_deleted": return { title: "Key pass deleted", body: from };
    case "design_version_edited": return { title: `Design ${(to ?? "").toUpperCase()} edited`.trim(), body: null };
    case "design_file_attached": return { title: `Design ${(to ?? "").toUpperCase()} file uploaded`.trim(), body: null };
    case "onsite_edited": return { title: "Onsite visit edited", body: to ? `Date ${to}` : null };
    case "procurement_dates": return { title: `Procurement dates changed${note ? ` (${note})` : ""}`, body: to };
    case "task_added": return { title: "Site task added", body: to };
    case "task_fulfilment": return { title: `Site task now ${to === "po" ? "by purchase order" : "by in-house crew"}`, body: note };
    case "task_done": return { title: "Site task done", body: [from, note].filter(Boolean).join(": ") || null };
    case "task_skipped": return { title: "Site task skipped", body: [from, note].filter(Boolean).join(": ") || null };
    case "handover_signed": return { title: "Handover signed", body: to ? `Signed by ${to}` : null };
    case "archived": return { title: "Project archived", body: null };
    case "restored": return { title: "Project restored", body: null };
    case "note": return { title: "Note", body: note };
    /* The importer writes from_value 'notion' as its source, not a value that changed ("notion to -" on screen). */
    case "notion_import": return { title: "Notion import", body: note };
    case "beta_defect_reported": return { title: "Defect reported", body: [to, note].filter(Boolean).join(" · ") || null };
    case "beta_defect_fixed": return { title: "Defect fixed, waiting for check", body: to };
    case "beta_defect_redo": return { title: "Defect sent back to fix", body: [to, note].filter(Boolean).join(" · ") || null };
    case "beta_defect_closed": return { title: "Defect closed", body: to };
    case "beta_defect_changed": return { title: "Defect changed", body: [to, note].filter(Boolean).join(" · ") || null };
    case "beta_drawing_sent": return { title: `${to ?? "Drawing"} sent to the customer`, body: note };
    case "beta_drawing_approved": return { title: `${to ?? "Drawing"} approved${from ? ` by ${from}` : ""}`, body: note };
    case "beta_drawing_approval_removed": return { title: "Approval removed", body: to };
    case "beta_reminder": return { title: "Reminder sent", body: [to ? humanize(to) : null, note].filter(Boolean).join(": ") || null };
    case "beta_design_changed": return { title: "Design dates changed", body: note };
    case "beta_note_days": return { title: "Amendment time changed", body: to ? `${from ? `${from}: ` : ""}${to} days` : null };
    case "beta_appointment_booked": return { title: `${humanize(to ?? "appointment")} booked`, body: note };
    case "beta_appointment_done": return { title: `${humanize(to ?? "appointment")} done`, body: note };
    case "beta_appointment_removed": return { title: `${humanize(to ?? "appointment")} removed`, body: note };
    case "beta_event_added": return { title: "Calendar entry added", body: [to ? humanize(to) : null, note].filter(Boolean).join(" · ") || null };
    case "beta_event_changed": return { title: "Calendar entry changed", body: [to ? humanize(to) : null, note].filter(Boolean).join(" · ") || null };
    case "beta_event_removed": return { title: "Calendar entry removed", body: [to ? humanize(to) : null, note].filter(Boolean).join(" · ") || null };
    case "sla_changed": return { title: `${note ?? "SLA"} changed`, body: arrow(from, to) };
  }
  if (TEAM[action]) return { title: `${TEAM[action]} changed`, body: arrow(from, to) };
  const parts = [from || to ? arrow(from, to) : null, note].filter(Boolean);
  return { title: humanize(action), body: parts.length ? parts.join(" · ") : null };
}

/** One project_flow_log row as words. */
export function flowLogText(l: Row, labels: Record<string, string>): { title: string; body: string | null } {
  const reason = str(l.reason);
  switch (String(l.kind)) {
    case "manual_step": return { title: `Step changed to ${stepLabel(labels, l.to_value)}`, body: [`From ${stepLabel(labels, l.from_value)}`, reason].filter(Boolean).join(" · ") };
    case "follow_data": return { title: `Step follows the project data again: ${stepLabel(labels, l.to_value)}`, body: null };
    case "hold_set": return { title: `Flag set: ${HOLD_LABEL[String(l.to_value)] ?? str(l.to_value) ?? ""}`, body: reason };
    case "hold_cleared": return { title: `Flag cleared: ${HOLD_LABEL[String(l.from_value)] ?? str(l.from_value) ?? ""}`, body: reason };
    default: return { title: humanize(String(l.kind ?? "")), body: reason };
  }
}

/** Newest first; a tie keeps the later-made row first. */
export function sortTimeline(entries: TimelineEntry[]): TimelineEntry[] {
  return [...entries].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

const TS = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

async function all(db: Db, sql: string, ...args: unknown[]): Promise<Row[]> {
  return (await db.prepare(sql).bind(...args).all<Row>()).results ?? [];
}

export async function timelineNotesReady(db: Db): Promise<boolean> {
  const r = await db.prepare(`SELECT to_regclass('public.project_timeline_notes') IS NOT NULL AS ready`).bind().first<{ ready: boolean }>();
  return r?.ready === true;
}

/** Every entry of one project. `docsReady`: migration 0116 is applied (the project's POs / DOs carry project_id). */
export async function readProjectTimeline(db: Db, projectId: number, companyId: number, opts: { docsReady: boolean; notesReady: boolean }): Promise<TimelineEntry[]> {
  const out: TimelineEntry[] = [];
  const push = (e: Omit<TimelineEntry, "at" | "dateOnly"> & { when: { at: string; dateOnly: boolean } | null }) => {
    if (!e.when) return;
    const { when, ...rest } = e;
    out.push({ ...rest, at: when.at, dateOnly: when.dateOnly });
  };
  const sys = (id: string, when: { at: string; dateOnly: boolean } | null, t: { title: string; body: string | null }, by: unknown) =>
    push({ id, when, category: "system", title: t.title, body: t.body, by: str(by) });

  const [project, acts, flow, labelsRows, keys, visits, files, dnotes, notes, docs] = await Promise.all([
    db.prepare(`SELECT created_at, ${TS("closed_at")} AS closed_at, ${TS("handed_over_at")} AS handed_over_at, end_date FROM projects WHERE id = ?`).bind(projectId).first<Row>(),
    all(db, `SELECT a.id::int AS id, a.action, a.from_value, a.to_value, a.note, a.created_at, u.name AS user_name
               FROM project_activity a LEFT JOIN users u ON u.id = a.user_id
              WHERE a.project_id = ? AND a.archived_at IS NULL ORDER BY a.id DESC LIMIT 1000`, projectId),
    all(db, `SELECT l.id::int AS id, l.kind, l.from_value, l.to_value, l.reason, ${TS("l.at")} AS at, coalesce(u.name, pp.name) AS by_name
               FROM project_flow_log l LEFT JOIN users u ON u.id = l.user_id LEFT JOIN project_people pp ON pp.id = l.person_id
              WHERE l.project_id = ? ORDER BY l.at DESC LIMIT 500`, projectId),
    all(db, `SELECT step_key, label FROM project_flow_steps WHERE company_id = ?`, companyId),
    all(db, `SELECT km.id::int AS id, km.moved_on::text AS moved_on, ${TS("km.created_at")} AS created_at, fp.name AS from_name, tp.name AS to_name,
                    km.note, u.name AS by_name
               FROM project_key_moves km LEFT JOIN project_people fp ON fp.id = km.from_person_id
               LEFT JOIN project_people tp ON tp.id = km.to_person_id LEFT JOIN users u ON u.id = km.recorded_by
              WHERE km.project_id = ? LIMIT 500`, projectId),
    all(db, `SELECT r.id::int AS id, r.done_on::text AS done_on, ${TS("r.created_at")} AS created_at, r.note, u.name AS by_name,
                    (SELECT string_agg(x.name, ', ' ORDER BY lower(x.name)) FROM project_design_record_people rp JOIN project_people x ON x.id = rp.person_id
                      WHERE rp.record_id = r.id) AS people
               FROM project_design_records r LEFT JOIN users u ON u.id = r.recorded_by
              WHERE r.project_id = ? LIMIT 500`, projectId),
    all(db, `SELECT f.id::int AS id, f.kind, f.version, f.file_name, f.external_url IS NOT NULL AS is_link, f.submitted_on::text AS submitted_on,
                    ${TS("f.uploaded_at")} AS uploaded_at, f.note, u.name AS by_name,
                    (SELECT string_agg(x.name, ', ' ORDER BY lower(x.name)) FROM project_design_file_people fp JOIN project_people x ON x.id = fp.person_id
                      WHERE fp.file_id = f.id) AS people
               FROM project_design_files f LEFT JOIN users u ON u.id = f.uploaded_by
              WHERE f.project_id = ? LIMIT 500`, projectId),
    all(db, `SELECT n.id::int AS id, n.kind, n.noted_on::text AS noted_on, ${TS("n.created_at")} AS created_at, n.note,
                    coalesce(pp.name, n.requested_by_text) AS requested_by, u.name AS by_name
               FROM project_design_notes n LEFT JOIN project_people pp ON pp.id = n.requested_by_person_id LEFT JOIN users u ON u.id = n.created_by
              WHERE n.project_id = ? LIMIT 500`, projectId),
    opts.notesReady
      ? all(db, `SELECT n.id::int AS id, n.note_type, n.note, ${TS("n.created_at")} AS created_at, u.name AS by_name
                   FROM project_timeline_notes n LEFT JOIN users u ON u.id = n.created_by
                  WHERE n.project_id = ? AND n.archived_at IS NULL ORDER BY n.created_at DESC LIMIT 1000`, projectId)
      : Promise.resolve([] as Row[]),
    opts.docsReady ? readDocEvents(db, projectId, companyId) : Promise.resolve([] as Row[]),
  ]);

  const labels: Record<string, string> = {};
  for (const r of labelsRows) labels[String(r.step_key)] = String(r.label);

  let createdLogged = false;
  let handoverLogged = false;
  for (const a of acts) {
    if (a.action === "created") createdLogged = true;
    if (a.action === "handover_signed") handoverLogged = true;
    const when = isoOf(a.created_at);
    sys(`act:${String(a.id)}`, when ? { at: when, dateOnly: false } : null, activityText(a), a.user_name);
  }
  if (!createdLogged && project) {
    const when = isoOf(project.created_at);
    sys("project:created", when ? { at: when, dateOnly: false } : null, { title: "Project created", body: null }, null);
  }
  if (!handoverLogged && project?.handed_over_at) sys("project:handover", { at: String(project.handed_over_at), dateOnly: false }, { title: "Handed over", body: null }, null);
  /* Completed = the project reached Closed: its end_date (filled by the engine since migration 0117), else closed_at. */
  if (project && (project.end_date || project.closed_at)) {
    sys("project:closed", datedAt(project.end_date, project.closed_at), { title: "Project completed", body: null }, null);
  }

  for (const l of flow) sys(`flow:${String(l.id)}`, { at: String(l.at), dateOnly: false }, flowLogText(l, labels), l.by_name);

  for (const k of keys) {
    sys(`key:${String(k.id)}`, datedAt(k.moved_on, k.created_at),
      { title: `Key passed: ${str(k.from_name) ?? "-"} to ${str(k.to_name) ?? "-"}`, body: str(k.note) }, k.by_name);
  }
  for (const v of visits) {
    sys(`onsite:${String(v.id)}`, datedAt(v.done_on, v.created_at),
      { title: "Design onsite visit", body: [str(v.people) ? `PIC: ${String(v.people)}` : null, str(v.note)].filter(Boolean).join(" · ") || null }, v.by_name);
  }
  for (const f of files) {
    const kind = String(f.kind) === "other" ? "Design file" : String(f.kind).toUpperCase();
    sys(`design:${String(f.id)}`, datedAt(f.submitted_on, f.uploaded_at),
      { title: `${kind} v${String(f.version)} submitted${f.is_link === true ? " (link)" : ""}`,
        body: [str(f.people) ? `PIC: ${String(f.people)}` : null, str(f.note)].filter(Boolean).join(" · ") || null }, f.by_name);
  }
  for (const n of dnotes) {
    const is2d = String(n.kind) === "2d";
    sys(`dnote:${String(n.id)}`, datedAt(n.noted_on, n.created_at),
      { title: is2d ? "2D amendment requested" : "3D note", body: [str(n.requested_by) ? `By ${String(n.requested_by)}` : null, str(n.note)].filter(Boolean).join(" · ") || null },
      n.by_name);
  }
  for (const d of docs) {
    const kind = String(d.kind);
    const title = kind === "po" ? `Purchase order ${String(d.no)} created` : kind === "gr" ? `Goods receipt ${String(d.no)} created` : `Delivery order ${String(d.no)} created`;
    sys(`${kind}:${String(d.id)}`, d.created_at ? { at: String(d.created_at), dateOnly: false } : null, { title, body: str(d.detail) }, d.by_name);
  }
  for (const n of notes) {
    push({ id: `note:${String(n.id)}`, when: { at: String(n.created_at), dateOnly: false }, category: n.note_type as TimelineNoteType,
      title: null, body: str(n.note), by: str(n.by_name), noteId: Number(n.id) });
  }
  return sortTimeline(out);
}

/** The project's POs, GRs and DOs, one row each: kind, id, number, created_at, a short detail and who made it. */
async function readDocEvents(db: Db, projectId: number, companyId: number): Promise<Row[]> {
  const q = projectDocSql(
    `SELECT 'po' AS kind, po.id::text AS id, po.po_number AS no, ${TS("po.created_at")} AS created_at,
            concat_ws(' · ', sup.name, nullif(concat_ws(' / ', po.category_group, po.sub_category), '')) AS detail, st.name AS by_name
       FROM scm.purchase_orders po LEFT JOIN scm.suppliers sup ON sup.id = po.supplier_id LEFT JOIN scm.staff st ON st.id = po.created_by
      WHERE po.id IN (__POS__)
     UNION ALL
     SELECT 'gr', g.id::text, g.grn_number, ${TS("g.created_at")},
            concat_ws(' · ', sup.name, CASE WHEN g.received_at_site THEN 'received on site' END), st.name
       FROM scm.grns g LEFT JOIN scm.suppliers sup ON sup.id = g.supplier_id LEFT JOIN scm.staff st ON st.id = g.created_by
      WHERE g.id IN (__GRS__)
     UNION ALL
     SELECT 'do', d.id::text, d.do_number, ${TS("d.created_at")}, d.so_doc_no, st.name
       FROM scm.delivery_orders d LEFT JOIN scm.staff st ON st.id = d.created_by
      WHERE d.id IN (__DOS__)`,
    projectId, companyId,
  );
  try {
    return (await db.prepare(q.text).bind(...q.args).all<Row>()).results ?? [];
  } catch (e) {
    if (isMissingRelation(e)) return [];
    throw e;
  }
}
