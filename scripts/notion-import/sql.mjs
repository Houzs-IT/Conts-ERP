// Writes idempotent SQL for the mapped Notion export. Every chunk is one transaction:
//   - inserts upsert on (company_id, source_ref) and never delete anything;
//   - an imported project or site task is refreshed only while nobody touched it in the app
//     (updated_at still equals created_at, no hand-set step / hold, no handover), and only when a value differs,
//     so a second run with the same export writes 0 rows;
//   - log-like records (key moves, site measures, design files, flow log, assignees, activity) are insert-only.
// The data travels as compact JSON payloads (short keys, refs without their "notion:" prefix, values the
// database can work out left out), one row per line, each checked against its md5 before anything is written.
import crypto from "node:crypto";

const DQ = "$notion_json$";

/* Payloads of the chunk being written. Each JSON literal is stored once in a temp table and its md5 checked
   against the value computed here before anything is written, so a chunk that was cut or altered on its way
   to the database (copied into a SQL console, for instance) fails as a whole instead of writing wrong rows. */
let payloads = null;

/** null / undefined / "" fields are dropped from the JSON (they read back as null). */
function compact(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== "") out[k] = v;
  return out;
}

function jsonLiteral(rows) {
  // one row per line, so a chunk can be read and pasted in pieces;
  // non-ASCII characters stay as they are (UTF-8): a \u escape can be turned into the character on its way to a
  // SQL console, which would change the checksum without changing the data
  const s = `[\n${rows.map((r) => JSON.stringify(compact(r))).join(",\n")}\n]`;
  if (s.includes(DQ)) throw new Error("data contains the dollar-quote tag");
  payloads.push(s);
  return `(select j from _payload where k = ${payloads.length})`;
}

function withPayloads(write) {
  payloads = [];
  try {
    const body = write();
    const md5 = (t) => crypto.createHash("md5").update(t, "utf8").digest("hex");
    const setup = `drop table if exists _payload;
create temp table _payload (k int primary key, t text not null, j jsonb) on commit drop;
insert into _payload (k, t) values
${payloads.map((p, i) => `  (${i + 1}, ${DQ}${p}${DQ})`).join(",\n")};
do $chk$
declare bad text; lines text;
begin
  select string_agg(p.k::text, ', ') into bad
    from _payload p left join (values ${payloads.map((p, i) => `(${i + 1}, '${md5(p)}')`).join(", ")}) as e(k, h) on e.k = p.k
   where e.h is null or md5(p.t) <> e.h;
  if bad is not null or (select count(*) from _payload) <> ${payloads.length} then
    -- which lines differ: the first 6 hex digits of each line's md5, in order
    select string_agg(p.k || ':' || l.i, ' ') into lines
      from _payload p
      join (values ${payloads.map((p, i) => `(${i + 1}, '${p.split("\n").map((l) => md5(l).slice(0, 6)).join("")}')`).join(",\n            ")}) as e(k, s) on e.k = p.k
      cross join lateral regexp_split_to_table(p.t, E'\\n') with ordinality as l(line, i)
     where substr(md5(l.line), 1, 6) is distinct from nullif(substr(e.s, (l.i::int - 1) * 6 + 1, 6), '');
    raise exception 'Notion import: payload % does not match its checksum (lines %); nothing was written', coalesce(bad, 'count'), coalesce(lines, '?');
  end if;
end
$chk$;
update _payload set j = t::jsonb;`;
    const marker = "set local search_path = public, extensions;\n";
    if (!body.includes(marker)) throw new Error("chunk without search_path line");
    return body.replace(marker, () => marker + setup + "\n");
  } finally {
    payloads = null;
  }
}

const short = (ref) => (ref == null ? null : String(ref).replace(/^notion:(person:)?/, ""));
const pgArray = (xs) => `{${xs.map((x) => `"${String(x).replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;
const sqlText = (s) => `'${String(s).replace(/'/g, "''")}'`;
/** SQL for a full ref from a payload ref: page ids and "h:" / "title:" refs get the "notion:" prefix back. */
const fullRef = (col) => `('notion:' || ${col})`;

/** Temp map person key -> project_people.id (by source_ref, else an existing person of the same name). */
function peopleMap(people, co) {
  const rows = people.map((p) => ({ k: short(p.ref), n: p.name }));
  return `drop table if exists _np;
create temp table _np on commit drop as
select x.k, coalesce(
         (select pp.id from public.project_people pp where pp.company_id = ${co} and pp.source_ref = 'notion:person:' || x.k),
         (select min(pp.id) from public.project_people pp where pp.company_id = ${co} and lower(pp.name) = lower(x.n))) as id
  from jsonb_to_recordset(${jsonLiteral(rows)}) as x(k text, n text);`;
}
const personId = (col) => `(select id from _np where k = ${col})`;

const statsHead = `drop table if exists _stats;
create temp table _stats (step text primary key, n bigint);`;
const statsTail = (label) => `commit;
select '${label}' as chunk, json_object_agg(step, n order by step) as counts from _stats;`;

function chunkPeopleProjects(m, co, exportDate) {
  const people = m.people.map((p) => ({ k: short(p.ref), n: p.name, r: pgArray(p.roles), x: p.notes }));
  const projects = m.projects.map((p) => ({
    r: short(p.ref), t: p.titleRef !== p.ref ? short(p.titleRef) : null, o: p.importOrder, y: p.yymm, n: p.name, b: p.building,
    u: p.unitNo, c: p.customerName, sp: p.salespersonName, s: short(p.salesPersonRef), d: short(p.designerPersonRef),
    rp: short(p.renoPicPersonRef), h: p.handoverDate, st: p.step, why: p.stepReason, hd: p.hold ? 1 : null, kh: short(p.keyHolderRef),
  }));
  const keyNote = `Key holder per the Notion "Unit Key" column at the export of ${exportDate}; the actual hand-over date was not exported.`;
  return `-- Notion import 1: people, projects, unit key holder, step and hold history (company ${co})
begin;
set local search_path = public, extensions;
${statsHead}

with ins as (
  insert into project_people (company_id, name, roles, notes, source, source_ref)
  select ${co}, x.n, x.r::text[], x.x, 'import', 'notion:person:' || x.k
    from jsonb_to_recordset(${jsonLiteral(people)}) as x(k text, n text, r text, x text)
   where not exists (select 1 from project_people pp where pp.company_id = ${co} and (pp.source_ref = 'notion:person:' || x.k or lower(pp.name) = lower(x.n)))
  on conflict do nothing
  returning 1)
insert into _stats select 'people_inserted', count(*) from ins;

${peopleMap(m.people, co)}

drop table if exists _pd;
create temp table _pd on commit drop as
select ${fullRef("x.r")} as ref, ${fullRef("coalesce(x.t, x.r)")} as title_ref, x.o as ord, x.y as yymm, x.n as name, x.b as building,
       x.u as unit_no, x.c as customer_name, x.sp as salesperson_name,
       ${personId("x.s")} as sales_id, ${personId("x.d")} as designer_id, ${personId("x.rp")} as reno_pic_id, ${personId("x.kh")} as key_holder_id,
       (x.h || 'T12:00:00+08:00')::timestamptz as handed_over_at,
       case when x.r ~ '^[0-9a-f]{32}$' then 'https://app.notion.com/p/' || x.r end as notion_url,
       x.st as step, x.why as step_reason,
       case when x.hd = 1 then 'in_defect' end as hold,
       case when x.hd = 1 then 'Imported from Notion (Reno Condition = IN DEFECT)' end as hold_note
  from jsonb_to_recordset(${jsonLiteral(projects)}) as x(r text, t text, o int, y text, n text, b text, u text, c text, sp text, s text, d text,
       rp text, h text, st text, why text, hd int, kh text);

-- A project imported before its Notion page id was known (title hash) takes the page id now.
with adopt as (
  update projects p set source_ref = d.ref
    from _pd d
   where p.company_id = ${co} and p.source = 'import' and p.source_ref = d.title_ref and d.ref <> d.title_ref
     and not exists (select 1 from projects q where q.company_id = ${co} and q.source_ref = d.ref)
  returning 1)
insert into _stats select 'projects_ref_adopted', count(*) from adopt;

-- New projects: code RN-YYMM-NNN numbered after the highest code of that month, as create.ts does. Each also gets
-- what create.ts gives a new project: its finance row, the 11 stage rows and the type's checklist (no template
-- site tasks: the project's site tasks are the ones imported from Notion).
with t as (
  select id, stage_keys, checklist_template_id from project_types where company_id = ${co} and slug = 'full_renovation' and active
),
d as (
  select pd.*, 'RN-' || pd.yymm || '-' || lpad((coalesce(
           (select max(substring(code from '^RN-[0-9]{4}-([0-9]+)$')::int) from projects where code like 'RN-' || pd.yymm || '-%'), 0)
           + row_number() over (partition by pd.yymm order by pd.ord))::text, 3, '0') as code
    from _pd pd
   where not exists (select 1 from projects p where p.company_id = ${co} and p.source_ref = pd.ref)
),
p as (
  insert into projects (code, name, stage, project_kind, project_type_id, customer_kind, customer_name, building, unit_no,
                        salesperson_name, sales_person_id, designer_person_id, reno_pic_person_id, handed_over_at, notion_url,
                        reno_stage, flow_manual_step, flow_manual_reason, flow_manual_at, hold_flag, hold_note, hold_at,
                        source, source_ref, company_id, created_at, updated_at)
  select d.code, d.name, 'draft', 'renovation', t.id, 'customer', d.customer_name, d.building, d.unit_no,
         d.salesperson_name, d.sales_id, d.designer_id, d.reno_pic_id, d.handed_over_at, d.notion_url,
         'design', d.step, d.step_reason, now(), d.hold, d.hold_note, case when d.hold is not null then now() end,
         'import', d.ref, ${co}, to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    from d cross join t
  on conflict do nothing
  returning id
),
fin as (insert into project_finance (project_id) select id from p returning project_id),
st as (
  insert into project_stages (project_id, stage_key, seq, in_type, company_id)
  select p.id, k.key, (k.ord - 1)::int, (k.key = any(t.stage_keys) or k.key in ('design', 'handover', 'closed')), ${co}
    from p cross join t
   cross join unnest('{design,key_permit,defect_check,shop_drawings,hardware,furniture,appliances,soft_furnishing,handover,warranty,closed}'::text[]) with ordinality as k(key, ord)
  returning id
),
sec as (
  insert into project_checklist_sections (project_id, name, sort_order, display_mode, company_id, stage_key)
  select p.id, ts.name, ts.sort_order, coalesce(ts.display_mode, 'list'), ${co}, ts.stage_key
    from p cross join t join project_checklist_template_sections ts on ts.template_id = t.checklist_template_id
   where ts.stage_key = any(t.stage_keys)
  returning id, project_id, stage_key, name, sort_order
),
items as (
  insert into project_checklist (project_id, seq, title, description, status, section_id, role_label, crew_visible,
                                 company_id, item_key, evidence_hint, skippable)
  select sec.project_id, ti.seq, ti.title, ti.description, 'pending', sec.id, ti.role_label, ti.crew_visible, ${co}, ti.item_key,
         ti.evidence_hint, ti.skippable
    from t
    join project_checklist_template_items ti on ti.template_id = t.checklist_template_id
    join project_checklist_template_sections ts on ts.id = ti.section_id
    join sec on sec.stage_key = ts.stage_key and sec.name = ts.name and sec.sort_order = ts.sort_order
  returning id
)
insert into _stats
select 'projects_inserted', count(*) from p
union all select 'project_finance_inserted', (select count(*) from fin)
union all select 'project_stages_inserted', (select count(*) from st)
union all select 'checklist_items_inserted', (select count(*) from items);

-- Refresh imported projects nobody has touched in the app since the import.
with upd as (
  update projects p
     set name = d.name, customer_name = d.customer_name, building = d.building, unit_no = d.unit_no,
         salesperson_name = d.salesperson_name, sales_person_id = d.sales_id, designer_person_id = d.designer_id,
         reno_pic_person_id = d.reno_pic_id, handed_over_at = d.handed_over_at, notion_url = d.notion_url,
         flow_manual_at = case when p.flow_manual_step is distinct from d.step then now() else p.flow_manual_at end,
         flow_manual_step = d.step, flow_manual_base_step = null, flow_manual_reason = d.step_reason,
         hold_at = case when p.hold_flag is distinct from d.hold then (case when d.hold is not null then now() end) else p.hold_at end,
         hold_flag = d.hold, hold_note = d.hold_note,
         updated_at = p.created_at
    from _pd d
   where p.company_id = ${co} and p.source_ref = d.ref and p.source = 'import'
     and p.updated_at is not distinct from p.created_at
     and p.flow_manual_by is null and p.hold_by is null
     and not exists (select 1 from project_flow_log l where l.project_id = p.id and l.source = 'app')
     and not exists (select 1 from project_handovers h where h.project_id = p.id)
     and (p.name, p.customer_name, p.building, p.unit_no, p.salesperson_name, p.sales_person_id, p.designer_person_id,
          p.reno_pic_person_id, p.handed_over_at, p.notion_url, p.flow_manual_step, p.flow_manual_base_step, p.flow_manual_reason,
          p.hold_flag, p.hold_note)
         is distinct from
         (d.name, d.customer_name, d.building, d.unit_no, d.salesperson_name, d.sales_id, d.designer_id,
          d.reno_pic_id, d.handed_over_at, d.notion_url, d.step, null::text, d.step_reason, d.hold, d.hold_note)
  returning 1)
insert into _stats select 'projects_updated', count(*) from upd;

-- Unit key: the holder named in the Notion "Unit Key" column, one move per project.
with ins as (
  insert into project_key_moves (project_id, company_id, moved_on, from_person_id, to_person_id, note, source, source_ref)
  select p.id, ${co}, ${sqlText(exportDate)}::date, null, d.key_holder_id, ${sqlText(keyNote)}, 'import', 'notion:key:' || d.ref
    from _pd d join projects p on p.company_id = ${co} and p.source_ref = d.ref
   where d.key_holder_id is not null
  on conflict do nothing
  returning 1)
insert into _stats select 'key_moves_inserted', count(*) from ins;

-- History of the imported step and hold flag (source 'import'); a later export with another value adds a row.
with ins as (
  insert into project_flow_log (project_id, company_id, kind, from_value, to_value, reason, source, source_ref)
  select p.id, ${co}, 'manual_step', null, d.step, d.step_reason, 'import', 'notion:flow:' || d.ref || ':' || d.step
    from _pd d join projects p on p.company_id = ${co} and p.source_ref = d.ref
  union all
  select p.id, ${co}, 'hold_set', null, d.hold, d.hold_note, 'import', 'notion:hold:' || d.ref || ':' || d.hold
    from _pd d join projects p on p.company_id = ${co} and p.source_ref = d.ref
   where d.hold is not null
  on conflict do nothing
  returning 1)
insert into _stats select 'flow_log_inserted', count(*) from ins;

insert into _stats
select 'projects_edited_in_app_skipped', count(*) from projects p join _pd d on d.ref = p.source_ref
 where p.company_id = ${co} and p.source = 'import'
   and (p.updated_at is distinct from p.created_at or p.flow_manual_by is not null or p.hold_by is not null
        or exists (select 1 from project_flow_log l where l.project_id = p.id and l.source = 'app')
        or exists (select 1 from project_handovers h where h.project_id = p.id));
insert into _stats select 'projects_present', count(*) from projects p join _pd d on d.ref = p.source_ref where p.company_id = ${co};
${statsTail("1 people+projects")}
`;
}

function chunkTasks(m, co, tasks, label) {
  const rows = tasks.map((t) => ({
    r: short(t.ref), p: short(t.project.ref), c: t.cat.code, o: t.occurrence, f: t.fulfilment === "po" ? "p" : null,
    s: t.state === "done" ? "d" : null, a: t.plannedStart, e: t.plannedEnd !== t.plannedStart ? t.plannedEnd : null,
    x: t.noteParts.subs, m: t.noteParts.markedDone ? 1 : null, n: t.noteParts.text, g: t.assigneeRefs.length ? pgArray(t.assigneeRefs.map(short)) : null,
  }));
  return `-- Notion import ${label}: site tasks (company ${co})
begin;
set local search_path = public, extensions;
${statsHead}
${peopleMap(m.people, co)}

-- Stage, task code, fix phase, label and order come from the company's task category, as manualTaskRow does.
drop table if exists _td;
create temp table _td on commit drop as
select ${fullRef("x.r")} as ref, p.id as project_id, c.stage_key as sk,
       case when c.internal_key is not null then 'INTERNAL:' || c.internal_key when c.trade_code is not null then c.trade_code else 'CAT:' || c.code end as tc,
       c.fix_phase as fx, c.label as lb, c.sort_order * 10 + x.o as sq,
       case when x.f = 'p' and c.internal_key is null then 'po' else 'internal' end as fk,
       x.c as cc, x.o as oc, case when x.s = 'd' then 'done' else 'open' end as st,
       x.a::date as ps, coalesce(x.e, x.a)::date as pe,
       'Imported from Notion.' || coalesce(' Contractor (Notion): ' || x.x || '.', '')
         || case when x.m = 1 then ' Marked done because the project is closed in Notion.' else '' end
         || coalesce(' Notion text: ' || x.n, '') as nt,
       coalesce(x.g, '{}')::text[] as asg
  from jsonb_to_recordset(${jsonLiteral(rows)}) as x(r text, p text, c text, o int, f text, s text, a text, e text, x text, m int, n text, g text)
  left join projects p on p.company_id = ${co} and p.source_ref = ${fullRef("x.p")}
  left join project_task_categories c on c.company_id = ${co} and c.code = x.c;

insert into _stats select 'tasks_without_project', count(*) from _td where project_id is null;
insert into _stats select 'tasks_without_category', count(*) from _td where tc is null;

with ins as (
  insert into project_trade_tasks (project_id, stage_key, trade_code, fix_phase, label, seq, fulfilment_kind, state, planned_start, planned_end,
                                   notes, company_id, category_code, occurrence, source, source_ref)
  select d.project_id, d.sk, d.tc, d.fx, d.lb, d.sq, d.fk, d.st, d.ps, d.pe, d.nt, ${co}, d.cc, d.oc, 'import', d.ref
    from _td d
   where d.project_id is not null and d.tc is not null
     and not exists (select 1 from project_trade_tasks t where t.company_id = ${co} and t.source_ref = d.ref)
  on conflict do nothing
  returning 1)
insert into _stats select 'tasks_inserted', count(*) from ins;

-- Refresh imported tasks nobody has touched in the app since the import (updated_at still equals created_at).
with upd as (
  update project_trade_tasks t
     set label = d.lb, seq = d.sq, state = d.st, planned_start = d.ps, planned_end = d.pe, notes = d.nt,
         fulfilment_kind = case when t.purchase_order_id is null then d.fk else t.fulfilment_kind end,
         updated_at = t.created_at
    from _td d
   where t.company_id = ${co} and t.source_ref = d.ref and t.source = 'import' and t.updated_at = t.created_at
     and t.state in ('open', 'done') and d.tc is not null
     and (t.label, t.seq, t.state, t.planned_start, t.planned_end, t.notes,
          case when t.purchase_order_id is null then t.fulfilment_kind else d.fk end)
         is distinct from (d.lb, d.sq, d.st, d.ps, d.pe, d.nt, d.fk)
  returning 1)
insert into _stats select 'tasks_updated', count(*) from upd;

with ins as (
  insert into project_trade_task_assignees (task_id, person_id, company_id)
  select t.id, np.id, ${co}
    from _td d
    join project_trade_tasks t on t.company_id = ${co} and t.source_ref = d.ref
    cross join unnest(d.asg) as a(k)
    join _np np on np.k = a.k and np.id is not null
  on conflict do nothing
  returning 1)
insert into _stats select 'task_assignees_inserted', count(*) from ins;

insert into _stats
select 'tasks_edited_in_app_skipped', count(*) from project_trade_tasks t join _td d on d.ref = t.source_ref
 where t.company_id = ${co} and t.source = 'import' and t.updated_at <> t.created_at;
insert into _stats select 'tasks_present', count(*) from project_trade_tasks t join _td d on d.ref = t.source_ref where t.company_id = ${co};
${statsTail(label)}
`;
}

function chunkMeasures(m, co, label) {
  const rows = m.siteMeasures.map((s) => ({ r: short(s.ref), p: short(s.project.ref), d: s.doneOn, w: short(s.personRef), n: s.note }));
  return `-- Notion import ${label}: site measures (company ${co})
begin;
set local search_path = public, extensions;
${statsHead}
${peopleMap(m.people, co)}

with ins as (
  insert into project_design_records (project_id, company_id, kind, done_on, person_id, note, source, source_ref)
  select p.id, ${co}, 'site_measure', x.d::date, ${personId("x.w")}, x.n, 'import', ${fullRef("x.r")}
    from jsonb_to_recordset(${jsonLiteral(rows)}) as x(r text, p text, d text, w text, n text)
    join projects p on p.company_id = ${co} and p.source_ref = ${fullRef("x.p")}
  on conflict do nothing
  returning 1)
insert into _stats select 'site_measures_inserted', count(*) from ins;
insert into _stats select 'site_measures_present', count(*) from project_design_records where company_id = ${co} and source = 'import';
${statsTail(label)}
`;
}

function chunkDesignFiles(m, co, files, label) {
  const rows = files.map((f) => ({
    r: short(f.ref), p: short(f.project.ref), k: f.kind, v: f.version, fn: f.fileName, sz: f.sizeBytes,
    // a PDF still to upload links to the Notion page holding it (its id only); a recorded link travels whole
    pg: f.notionPageId, u: f.notionPageId ? null : f.externalUrl, w: short(f.personRef), ts: f.uploadedAt, n: f.brief,
  }));
  return `-- Notion import ${label}: design files and links (company ${co})
begin;
set local search_path = public, extensions;
${statsHead}
${peopleMap(m.people, co)}

with ins as (
  insert into project_design_files (project_id, company_id, kind, version, file_name, content_type, size_bytes, external_url, person_id,
                                    uploaded_at, note, source, source_ref)
  select p.id, ${co}, x.k, x.v, x.fn, case when x.pg is not null and x.fn ilike '%.pdf' then 'application/pdf' end, x.sz,
         coalesce(x.u, 'https://app.notion.com/p/' || x.pg), ${personId("x.w")}, coalesce(x.ts::timestamptz, now()),
         'Imported from Notion (' || x.n || '). ' || case when x.pg is not null
           then 'The file is attached to the Notion page this links to and is in the export id_tasks.zip; upload to the app is pending.'
           else 'Link as recorded in Notion.' end,
         'import', ${fullRef("x.r")}
    from jsonb_to_recordset(${jsonLiteral(rows)}) as x(r text, p text, k text, v int, fn text, sz bigint, pg text, u text, w text, ts text, n text)
    join projects p on p.company_id = ${co} and p.source_ref = ${fullRef("x.p")}
  on conflict do nothing
  returning 1)
insert into _stats select 'design_files_inserted', count(*) from ins;
insert into _stats select 'design_files_present', count(*) from project_design_files where company_id = ${co} and source = 'import';
${statsTail(label)}
`;
}

function chunkActivity(m, co, activity, label) {
  const rows = activity.map((a) => ({ p: short(a.project.ref), n: a.note }));
  return `-- Notion import ${label}: "Imported from Notion" activity notes (company ${co}). A note is added only when it differs
-- from the project's latest import note, so a re-run with the same export adds nothing.
begin;
set local search_path = public, extensions;
${statsHead}
with ins as (
  insert into project_activity (project_id, action, from_value, note, company_id)
  select p.id, 'notion_import', 'notion', x.n, ${co}
    from jsonb_to_recordset(${jsonLiteral(rows)}) as x(p text, n text)
    join projects p on p.company_id = ${co} and p.source_ref = ${fullRef("x.p")}
   where x.n is distinct from (select a.note from project_activity a where a.project_id = p.id and a.action = 'notion_import'
                                order by a.id desc limit 1)
  returning 1)
insert into _stats select 'activity_notes_inserted', count(*) from ins;
${statsTail(label)}
`;
}

const groupsOf = (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const letter = (i) => String.fromCharCode(97 + i);

/** -> [{ name, sql }] in apply order. Chunks stay small (about 30-50 KB) so each can be pasted into a SQL console. */
export function buildSql(m, { companyId = 1, maxTasks = 200, maxFiles = 100, maxNotes = 35 } = {}) {
  const co = Number(companyId);
  if (!Number.isInteger(co) || co <= 0) throw new Error("companyId must be a positive integer");
  const exportDate = m.report?.exportDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(exportDate))) throw new Error("export date missing");
  const out = [{ name: "01_people_projects.sql", sql: withPayloads(() => chunkPeopleProjects(m, co, exportDate)) }];
  groupsOf(m.tasks, maxTasks).forEach((g, i) => {
    out.push({ name: `02${letter(i)}_tasks.sql`, sql: withPayloads(() => chunkTasks(m, co, g, `2${letter(i)} tasks`)) });
  });
  out.push({ name: "03a_site_measures.sql", sql: withPayloads(() => chunkMeasures(m, co, "3a site measures")) });
  groupsOf(m.designFiles, maxFiles).forEach((g, i) => {
    out.push({ name: `03${letter(i + 1)}_design_files.sql`, sql: withPayloads(() => chunkDesignFiles(m, co, g, `3${letter(i + 1)} design files`)) });
  });
  groupsOf(m.activity, maxNotes).forEach((g, i) => {
    out.push({ name: `04${letter(i)}_activity.sql`, sql: withPayloads(() => chunkActivity(m, co, g, `4${letter(i)} activity`)) });
  });
  return out;
}
