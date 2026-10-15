/* The Timeline of a renovation project (owner, 15 Oct 2026), mounted before /:id in routes/renovation.ts:
     GET  /:id/timeline                      every entry, newest first (services/renovation/timeline.ts)
     POST /:id/timeline/notes                add a note { type, note }
     POST /timeline/notes/:noteId/archive    hide a note (kept in the table)
   The System entries need nothing new; the hand-written notes need migration 0118, and until it is applied the
   GET answers notesReady: false and adding a note is refused with 409 not_ready. Scoped to the active company. */

import { Hono, type Context } from "hono";
import type { Env } from "../types";
import { requirePageAccess, requirePermission } from "../middleware/auth";
import { activeCompanySql } from "../scm/lib/companyScope";
import type { Db } from "../services/renovation/load";
import { cleanTimelineNote, readProjectTimeline, timelineNotesReady } from "../services/renovation/timeline";
import { docFlowColumnsReady } from "../scm/routes/renovation-doc-flow";

type Ctx = Context<{ Bindings: Env }>;
const app = new Hono<{ Bindings: Env }>();
const db = (c: Ctx) => c.env.DB as unknown as Db;
const userId = (c: Ctx): number => Number((c.get("user") as { id?: number } | undefined)?.id ?? 0);
const NOT_READY = { error: "not_ready", message: "Notes on the timeline are not switched on yet (migration 0118)." };

function parseId(x: string | undefined): number | null {
  const n = Number(x);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function projectCompany(c: Ctx, id: number): Promise<number | null> {
  const r = await db(c).prepare(`SELECT company_id::int AS company_id FROM projects WHERE id = ? AND project_kind = 'renovation'${activeCompanySql(c)}`)
    .bind(id).first<{ company_id: number }>();
  return r ? Number(r.company_id) : null;
}

app.get("/:id/timeline", requirePageAccess("projects.list"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  try {
    const co = await projectCompany(c, id);
    if (co == null) return c.json({ error: "not_found" }, 404);
    const [notesReady, docsReady] = await Promise.all([timelineNotesReady(db(c)), docFlowColumnsReady(db(c)).catch(() => false)]);
    const entries = await readProjectTimeline(db(c), id, co, { notesReady, docsReady });
    return c.json({ projectId: id, notesReady, entries });
  } catch (e) {
    console.error("[renovation] timeline read failed", e);
    return c.json({ error: "renovation_read_failed", message: "The project's timeline could not be read. Try again." }, 409);
  }
});

app.post("/:id/timeline/notes", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  const v = cleanTimelineNote(await c.req.json<Record<string, unknown>>().catch(() => ({})));
  if (!v.ok) return c.json(v, 400);
  if (!(await timelineNotesReady(db(c)))) return c.json(NOT_READY, 409);
  const row = await db(c).prepare(
    `INSERT INTO project_timeline_notes (project_id, company_id, note_type, note, created_by) VALUES (?, ?, ?, ?, ?) RETURNING id::int AS id`,
  ).bind(id, co, v.value.type, v.value.note, userId(c) || null).first<{ id: number }>();
  return c.json({ id: row?.id }, 201);
});

app.post("/timeline/notes/:noteId/archive", requirePermission("projects.write"), async (c) => {
  const noteId = parseId(c.req.param("noteId"));
  if (!noteId) return c.json({ error: "invalid_id" }, 400);
  if (!(await timelineNotesReady(db(c)))) return c.json(NOT_READY, 409);
  const n = await db(c).prepare(
    `SELECT n.id::int AS id, n.archived_at IS NOT NULL AS archived FROM project_timeline_notes n JOIN projects p ON p.id = n.project_id
      WHERE n.id = ?${activeCompanySql(c, "p.company_id")}`,
  ).bind(noteId).first<{ id: number; archived: boolean }>();
  if (!n) return c.json({ error: "not_found" }, 404);
  if (n.archived) return c.json({ ok: true, unchanged: true });
  await db(c).prepare(`UPDATE project_timeline_notes SET archived_at = now(), archived_by = ? WHERE id = ?`).bind(userId(c) || null, noteId).run();
  return c.json({ ok: true });
});

export default app;
