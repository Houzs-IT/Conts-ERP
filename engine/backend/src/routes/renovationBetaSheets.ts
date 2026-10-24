/* Beta Drawings: 2D versions made of sheets (owner, 24 Oct 2026; migration 0149). Mounted at /api/beta beside
   renovationBeta.ts, behind the same auth gate; kept in its own file so the Drawings work does not collide with the
   other Beta routes. Every project here is scoped to the active company (404 otherwise).

   POST /projects/:id/sheet-files?fileName=   one sheet file, raw body; answers its key (nothing is listed yet)
   POST /projects/:id/design-2d-sets          a new 2D version from sheets already uploaded
   GET  /projects/:id/design-sheets           every sheet of the project, for the screens to build each version's set
   POST /projects/:id/design-sheets/remove    { name } soft-removes a sheet: all its files stay, marked removed (0153)
   POST /projects/:id/design-sheets/restore   { name } puts a removed sheet back in the set
   POST /projects/:id/design-sheets/rename    { name, newName } renames a sheet in every version it is in
   POST /projects/:id/design-3d-links         a new 3D version holding several named links (0155)
   The three sheet actions take kind "2d" (default) or "3d", and touch only the sheets or links of that kind. */

import { Hono, type Context } from "hono";
import type { Env } from "../types";
import { requirePageAccess, requirePermission } from "../middleware/auth";
import { activeCompanySql } from "../scm/lib/companyScope";
import { todayMyt } from "../scm/lib/my-time";
import { isMissingRelation, type Db } from "../services/renovation/load";
import { DESIGN_FILE_MAX, DESIGN_FILE_TYPES } from "../services/renovation/records";
import {
  cleanLinkSet, cleanSheetName, cleanSheetRename, cleanSheetSet, linkVersionName, sheetKeyPrefix, sheetKindOf, sheetVersionName,
} from "../services/renovation/betaSheets";

/** The rows of one kind (2D sheets or 3D links) of a project; binds (projectId, kind). */
const OF_KIND = `file_id IN (SELECT f.id FROM project_design_files f WHERE f.project_id = ? AND f.kind = ?)`;

type Ctx = Context<{ Bindings: Env }>;
const app = new Hono<{ Bindings: Env }>();

const db = (c: Ctx): Db => c.env.DB as unknown as Db;
const userId = (c: Ctx): number => Number(c.get("user")?.id ?? 0);
const body = async (c: Ctx): Promise<Record<string, unknown>> => (await c.req.json<Record<string, unknown>>().catch(() => ({}))) ?? {};

function parseId(x: string | undefined | null): number | null {
  const n = Number(x);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function projectCompany(c: Ctx, id: number): Promise<number | null> {
  const r = await db(c).prepare(`SELECT company_id::int AS company_id FROM projects WHERE id = ? AND project_kind = 'renovation'${activeCompanySql(c, "company_id")}`)
    .bind(id).first<{ company_id: number }>();
  return r ? Number(r.company_id) : null;
}

async function peopleMissing(c: Ctx, companyId: number, ids: number[]): Promise<boolean> {
  if (ids.length === 0) return false;
  const r = await db(c).prepare(
    `SELECT count(*)::int AS n FROM project_people WHERE company_id = ? AND id IN (SELECT (jsonb_array_elements_text(?::text::jsonb))::bigint)`,
  ).bind(companyId, JSON.stringify(ids.map(String))).first<{ n: number }>();
  return Number(r?.n ?? 0) !== ids.length;
}

app.post("/projects/:id/sheet-files", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  if ((await projectCompany(c, id)) == null) return c.json({ error: "not_found" }, 404);
  const type = (c.req.header("content-type") || "").split(";")[0]!.trim().toLowerCase();
  const ext = DESIGN_FILE_TYPES[type];
  if (!ext) return c.json({ error: "unsupported_type", message: "PDF, image, DWG or ZIP files only." }, 415);
  const buf = await c.req.arrayBuffer();
  if (!buf.byteLength) return c.json({ error: "empty", message: "The file is empty." }, 400);
  if (buf.byteLength > DESIGN_FILE_MAX) return c.json({ error: "too_large", message: "A sheet can be up to 25 MB." }, 413);
  const fileName = (c.req.query("fileName") ?? "").trim().slice(0, 200) || `sheet.${ext}`;
  const key = `${sheetKeyPrefix(id)}${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  await c.env.POD_BUCKET.put(key, buf, { httpMetadata: { contentType: type } });
  return c.json({ key, fileName, contentType: type, size: buf.byteLength }, 201);
});

app.post("/projects/:id/design-2d-sets", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  const v = cleanSheetSet(await body(c), id, todayMyt());
  if (!v.ok) return c.json({ error: v.error, message: v.message }, 400);
  const d = v.value;
  if (await peopleMissing(c, co, d.personIds)) return c.json({ error: "person_not_found", message: "Pick the people from the list." }, 400);
  for (const s of d.sheets) {
    if (!(await c.env.POD_BUCKET.head(s.key))) return c.json({ error: "file_missing", message: `${s.fileName} did not finish uploading. Upload it again.` }, 400);
  }
  let prior: { n: number } | null;
  try {
    prior = await db(c).prepare(`SELECT count(*)::int AS n FROM project_design_sheets WHERE ${OF_KIND}`).bind(id, "2d").first<{ n: number }>();
  } catch (e) {
    if (isMissingRelation(e)) return c.json({ error: "not_ready", message: "2D sheets are not switched on yet (database update 0149)." }, 503);
    throw e;
  }
  const first = d.sheets[0]!;
  const row = await db(c).prepare(
    `INSERT INTO project_design_files (project_id, company_id, kind, version, file_name, content_type, size_bytes, r2_key, person_id, uploaded_by, note, submitted_on)
     SELECT ?, ?, '2d', coalesce(max(version), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?::date FROM project_design_files WHERE project_id = ? AND kind = '2d'
     RETURNING id::int AS id, version::int AS version`,
  ).bind(id, co, sheetVersionName(Number(prior?.n ?? 0) === 0, d.sheets.length), first.contentType, first.size, first.key, d.personIds[0] ?? null, userId(c),
    d.note, d.submittedOn, id).first<{ id: number; version: number }>();
  if (!row) return c.json({ error: "not_saved" }, 500);
  const stmts = [
    db(c).prepare(
      `INSERT INTO project_design_sheets (file_id, project_id, name, file_name, content_type, size_bytes, r2_key, uploaded_by)
       SELECT ?::bigint, ?::bigint, x.name, x."fileName", x."contentType", x.size, x.key, ?::bigint
         FROM jsonb_to_recordset(?::text::jsonb) AS x(name text, "fileName" text, "contentType" text, size bigint, key text)`,
    ).bind(row.id, id, userId(c), JSON.stringify(d.sheets)),
    // A new 2D version answers every 2D amendment request still open, as an upload on the project page does
    // (afterDesignFile in renovationProject.ts); V1 never answers one.
    db(c).prepare(
      `UPDATE project_design_notes SET closed_by_file_id = ?, closed_at = now()
        WHERE project_id = ? AND kind = '2d' AND closed_by_file_id IS NULL AND ?::int > 1`,
    ).bind(row.id, id, row.version),
    db(c).prepare(`INSERT INTO project_activity (project_id, action, from_value, to_value, note, user_id, company_id) VALUES (?, 'beta_2d_sheets_uploaded', NULL, ?, ?, ?, ?)`)
      .bind(id, `2D V${row.version}`, d.sheets.map((s) => s.name).join(", ").slice(0, 500), userId(c), co),
  ];
  if (d.personIds.length) {
    stmts.push(db(c).prepare(
      `INSERT INTO project_design_file_people (file_id, person_id) SELECT ?::bigint, (x)::bigint FROM jsonb_array_elements_text(?::text::jsonb) AS x ON CONFLICT DO NOTHING`,
    ).bind(row.id, JSON.stringify(d.personIds.map(String))));
  }
  try {
    await db(c).batch!(stmts);
  } catch (e) {
    // The version row went in alone; take it back so no 2D version is left without its sheets.
    await db(c).prepare(`DELETE FROM project_design_files WHERE id = ?`).bind(row.id).run();
    throw e;
  }
  return c.json({ id: row.id, version: row.version }, 201);
});

const isMissingColumn = (e: unknown): boolean => (e as { code?: string } | null)?.code === "42703";

app.get("/projects/:id/design-sheets", requirePageAccess("projects.list"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  if ((await projectCompany(c, id)) == null) return c.json({ error: "not_found" }, 404);
  const cols = `id::int AS id, file_id::int AS "fileId", name, file_name AS "fileName", content_type AS "contentType", size_bytes::int AS size, r2_key AS key,
              uploaded_at::text AS "uploadedAt"`;
  try {
    let r: { results?: Record<string, unknown>[] } | null = null;
    let canRemove = true;
    let canLink = true;
    // Newest database first; before 0155 there are no 3D links, before 0153 no sheet can be removed.
    for (const [extra, remove, link] of [
      [`removed_at::text AS "removedAt", external_url AS url`, true, true],
      [`removed_at::text AS "removedAt", NULL::text AS url`, true, false],
      [`NULL::text AS "removedAt", NULL::text AS url`, false, false],
    ] as const) {
      try {
        r = await db(c).prepare(`SELECT ${cols}, ${extra} FROM project_design_sheets WHERE project_id = ? ORDER BY id`).bind(id).all<Record<string, unknown>>();
        canRemove = remove;
        canLink = link;
        break;
      } catch (e) {
        if (!isMissingColumn(e)) throw e;
      }
    }
    return c.json({ ready: true, canRemove, canLink, sheets: r?.results ?? [] });
  } catch (e) {
    if (isMissingRelation(e)) return c.json({ ready: false, canRemove: false, canLink: false, sheets: [] });
    throw e;
  }
});

/** The project's sheets, one per name (spelled as its newest file has it), and whether each is removed. */
async function sheetNames(c: Ctx, id: number, kind: "2d" | "3d"): Promise<Array<{ name: string; removed: boolean }>> {
  const r = await db(c).prepare(
    `SELECT DISTINCT ON (lower(name)) name, (removed_at IS NOT NULL) AS removed FROM project_design_sheets WHERE ${OF_KIND} ORDER BY lower(name), id DESC`,
  ).bind(id, kind).all<{ name: string; removed: boolean }>();
  return r.results ?? [];
}

const activity = (c: Ctx, id: number, co: number, action: string, from: string | null, to: string) =>
  db(c).prepare(`INSERT INTO project_activity (project_id, action, from_value, to_value, note, user_id, company_id) VALUES (?, ?, ?, ?, NULL, ?, ?)`)
    .bind(id, action, from, to, userId(c), co);

for (const action of ["remove", "restore"] as const) {
  app.post(`/projects/:id/design-sheets/${action}`, requirePermission("projects.write"), async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "invalid_id" }, 400);
    const co = await projectCompany(c, id);
    if (co == null) return c.json({ error: "not_found" }, 404);
    const b = await body(c);
    const kind = sheetKindOf(b.kind);
    const n = cleanSheetName(b.name);
    if (!n.ok) return c.json({ error: n.error, message: n.message }, 400);
    try {
      const sheet = (await sheetNames(c, id, kind)).find((x) => x.name.toLowerCase() === n.value.toLowerCase());
      if (!sheet) return c.json({ error: "sheet_not_found", message: `That ${kind === "3d" ? "link is not in this project's 3D" : "sheet is not in this project's 2D"} set.` }, 404);
      if (sheet.removed === (action === "remove")) return c.json({ ok: true, name: sheet.name, changed: false });
      // Every file the sheet had, in every version, so it leaves (or comes back to) every set and the PDF at once.
      const upd = action === "remove"
        ? db(c).prepare(`UPDATE project_design_sheets SET removed_at = now(), removed_by = ? WHERE ${OF_KIND} AND lower(name) = lower(?) AND removed_at IS NULL`)
          .bind(userId(c), id, kind, sheet.name)
        : db(c).prepare(`UPDATE project_design_sheets SET removed_at = NULL, removed_by = NULL WHERE ${OF_KIND} AND lower(name) = lower(?) AND removed_at IS NOT NULL`)
          .bind(id, kind, sheet.name);
      await db(c).batch!([upd, activity(c, id, co, `beta_${kind}_sheet_${action === "remove" ? "removed" : "restored"}`, null, sheet.name)]);
      return c.json({ ok: true, name: sheet.name, changed: true });
    } catch (e) {
      if (isMissingColumn(e) || isMissingRelation(e)) {
        return c.json({ error: "not_ready", message: "Removing 2D sheets is not switched on yet (database update 0153)." }, 503);
      }
      throw e;
    }
  });
}

app.post("/projects/:id/design-sheets/rename", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  const b = await body(c);
  try {
    const kind = sheetKindOf(b.kind);
    const v = cleanSheetRename(b, (await sheetNames(c, id, kind)).map((x) => x.name));
    if (!v.ok) return c.json({ error: v.error, message: v.message }, v.error === "sheet_not_found" ? 404 : 400);
    await db(c).batch!([
      db(c).prepare(`UPDATE project_design_sheets SET name = ? WHERE ${OF_KIND} AND lower(name) = lower(?)`).bind(v.value.to, id, kind, v.value.from),
      activity(c, id, co, `beta_${kind}_sheet_renamed`, v.value.from, v.value.to),
    ]);
    return c.json({ ok: true, name: v.value.to });
  } catch (e) {
    if (isMissingRelation(e)) return c.json({ error: "not_ready", message: "2D sheets are not switched on yet (database update 0149)." }, 503);
    throw e;
  }
});

app.post("/projects/:id/design-3d-links", requirePermission("projects.write"), async (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "invalid_id" }, 400);
  const co = await projectCompany(c, id);
  if (co == null) return c.json({ error: "not_found" }, 404);
  const v = cleanLinkSet(await body(c), todayMyt());
  if (!v.ok) return c.json({ error: v.error, message: v.message }, 400);
  const d = v.value;
  if (await peopleMissing(c, co, [...new Set([...d.personIds, ...(d.nextPersonId ? [d.nextPersonId] : [])])])) {
    return c.json({ error: "person_not_found", message: "Pick the people from the list." }, 400);
  }
  let prior: { n: number } | null;
  try {
    // Reads the new column first: before 0155 nothing is written, so no version is left without its links.
    prior = await db(c).prepare(`SELECT count(*)::int AS n FROM project_design_sheets WHERE ${OF_KIND} AND external_url IS NOT NULL`)
      .bind(id, "3d").first<{ n: number }>();
  } catch (e) {
    if (isMissingRelation(e) || isMissingColumn(e)) return c.json({ error: "not_ready", message: "3D link sets are not switched on yet (database update 0155)." }, 503);
    throw e;
  }
  const first = d.links[0]!;
  const row = await db(c).prepare(
    `INSERT INTO project_design_files (project_id, company_id, kind, version, file_name, external_url, person_id, uploaded_by, note, submitted_on, next_person_id)
     SELECT ?, ?, '3d', coalesce(max(version), 0) + 1, ?, ?, ?, ?, ?, ?::date, ? FROM project_design_files WHERE project_id = ? AND kind = '3d'
     RETURNING id::int AS id, version::int AS version`,
  ).bind(id, co, linkVersionName(Number(prior?.n ?? 0) === 0, d.links.length), first.url, d.personIds[0] ?? null, userId(c), d.note, d.submittedOn,
    d.nextPersonId, id).first<{ id: number; version: number }>();
  if (!row) return c.json({ error: "not_saved" }, 500);
  const stmts = [
    db(c).prepare(
      `INSERT INTO project_design_sheets (file_id, project_id, name, file_name, external_url, uploaded_by)
       SELECT ?::bigint, ?::bigint, x.name, x.name, x.url, ?::bigint FROM jsonb_to_recordset(?::text::jsonb) AS x(name text, url text)`,
    ).bind(row.id, id, userId(c), JSON.stringify(d.links)),
    db(c).prepare(`INSERT INTO project_activity (project_id, action, from_value, to_value, note, user_id, company_id) VALUES (?, 'beta_3d_links_added', NULL, ?, ?, ?, ?)`)
      .bind(id, `3D V${row.version}`, d.links.map((l) => l.name).join(", ").slice(0, 500), userId(c), co),
  ];
  if (d.personIds.length) {
    stmts.push(db(c).prepare(
      `INSERT INTO project_design_file_people (file_id, person_id) SELECT ?::bigint, (x)::bigint FROM jsonb_array_elements_text(?::text::jsonb) AS x ON CONFLICT DO NOTHING`,
    ).bind(row.id, JSON.stringify(d.personIds.map(String))));
  }
  try {
    await db(c).batch!(stmts);
  } catch (e) {
    // The version row went in alone; take it back so no 3D version is left without its links.
    await db(c).prepare(`DELETE FROM project_design_files WHERE id = ?`).bind(row.id).run();
    throw e;
  }
  return c.json({ id: row.id, version: row.version }, 201);
});

export default app;
