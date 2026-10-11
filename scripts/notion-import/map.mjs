// Maps the three Notion exports (Project, Renovation Task, ID Task rows) onto the simplified renovation
// project model (docs/superpowers/specs/2026-10-11-renovation-simplified-project.md). Pure: rows in,
// entities + report out. The SQL is written by sql.mjs.
import {
  col, normTitle, parseCreatedTime, parseDate, parseDateRange, parseMoneySen, parseRelation, parseTitle,
  splitFiles, splitList, stableHash, yesNo, yymmOf,
} from "./parse.mjs";

/* Same rows as TASK_CATEGORIES in engine/backend/src/scm/shared/renovation-stages.ts and migration 0084
   (the parity test compares them). Only the fields the importer needs. */
export const TASK_CATEGORIES = [
  ["PRE_RENO_WORKS", "PRE-RENO WORKS & ITEM DELIVERY", "hardware", null, "single", "pre_reno_delivery", 10],
  ["PROTECTION", "PROTECTION", "hardware", "PROTECTION", "single", null, 20],
  ["WIRING_HACKING", "WIRING & HACKING", "hardware", "ELECTRICAL", "first", null, 30],
  ["DEMOLISH", "DEMOLISH / DISMANTLE", "hardware", "HACKING", "single", null, 40],
  ["REMOVING_OLD_SPC", "REMOVING OLD SPC", "hardware", "HACKING", "single", null, 45],
  ["PLUMBING", "PLUMBING WORK", "hardware", "PLUMBING", "single", null, 50],
  ["WATERPROOFING", "WATERPROOFING", "hardware", "WATERPROOFING", "single", null, 55],
  ["FLOOR_LEVELING", "FLOOR LEVELING & WALL BUILDING", "hardware", "MASONRY_TILING", "single", null, 60],
  ["TILES", "TILES INSTALLATION", "hardware", "MASONRY_TILING", "single", null, 65],
  ["LIGHTING_FAN", "LIGHTING & FAN INSTALLATION", "hardware", "ELECTRICAL", "second", null, 70],
  ["PLASTER_CEILING", "PLASTER CEILING", "hardware", "PLASTER_CEILING", "single", null, 80],
  ["PAINTING", "PAINTING", "hardware", "PAINTING", "single", null, 90],
  ["SPC_FLOORING", "SPC FLOORING", "hardware", "FLOORING", "single", null, 95],
  ["FEATURE_WALL", "FEATURE WALL", "hardware", "FEATURE_WALL", "single", null, 100],
  ["WINDOW", "WINDOW", "hardware", "ALUMINIUM_GLASS", "single", null, 110],
  ["PARTITION", "PARTITION", "hardware", "PARTITION", "single", null, 120],
  ["QC", "QC", "hardware", null, "single", "qc", 125],
  ["TEXTURED_PAINTING", "TEXTURED PAINTING", "hardware", "TEXTURED_PAINTING", "single", null, 130],
  ["CARPENTRY", "CARPENTRY", "furniture", null, "single", null, 140],
  ["GRILL", "GRILL", "hardware", "GRILL", "single", null, 150],
  ["SLIDING_DOOR", "SLIDING DOOR INSTALLATION", "hardware", "ALUMINIUM_GLASS", "single", null, 155],
  ["AIRCON_INSTALL", "AIR CON INSTALLATION", "hardware", "AIRCON_INSTALL", "single", null, 160],
  ["AIRCON_RELOCATION", "AIR CON RELOCATION", "hardware", "AIRCON_INSTALL", "single", null, 165],
  ["POST_RENO_CLEANING", "POST RENO CLEANING", "handover", null, "single", "post_reno_cleaning", 170],
  ["DOOR", "DOOR INSTALLATION", "hardware", "DOOR", "single", null, 175],
  ["HIDDEN_DOOR", "HIDDEN DOOR", "hardware", "DOOR", "single", null, 180],
  ["FURNITURE_DELIVERY", "FURNITURE DELIVERY", "furniture", null, "single", null, 190],
  ["CURTAIN", "CURTAIN INSTALLATION", "soft_furnishing", null, "single", null, 195],
  ["FURNITURE_INSTALLATION", "FURNITURE INSTALLATION", "furniture", null, "single", null, 200],
  ["ELECTRICAL_APPLIANCES_DELIVERY", "ELECTRICAL APPLIANCES DELIVERY", "appliances", null, "single", null, 205],
  ["TOUCH_UP", "TOUCH UP", "handover", null, "single", "touch_up", 210],
  ["HANDOVER_QC", "HANDOVER QC", "handover", null, "single", null, 220],
  ["KITCHEN_TOP", "KITCHEN TOP INSTALLATION", "furniture", null, "single", null, 230],
  ["SET_UP_CLEANING", "SET UP CLEANING", "handover", null, "single", "set_up_cleaning", 240],
  ["JOINT_HANDOVER_INSPECTION", "JOINT HANDOVER INSPECTION", "handover", null, "single", "joint_handover_inspection", 250],
  ["SERVICE", "SERVICE", "warranty", null, "single", null, 260],
].map(([code, label, stage, trade, fix, internalKey, sort]) => ({ code, label, stage, trade, fix, internalKey, sort }));

/** Same as taskCodeOfCategory in renovation-stages.ts. */
export function taskCodeOf(cat) {
  if (cat.internalKey) return `INTERNAL:${cat.internalKey}`;
  if (cat.trade) return cat.trade;
  return `CAT:${cat.code}`;
}

const CATEGORY_BY_LABEL = new Map(TASK_CATEGORIES.map((c) => [normTitle(c.label), c]));

/* The owner's people list (11 Oct 2026). `aliases` are the spellings seen in the Notion cells. */
export const PEOPLE = [
  { key: "chai-mengkeat", name: "Chai Mengkeat", roles: ["sales", "boss"], aliases: ["Chai Mengkeat"] },
  { key: "michell-lo", name: "Michell Lo Siaw Maan", roles: ["sales"], aliases: ["Michell Lo Siaw Maan"] },
  { key: "tang-tara", name: "Tang Tara", roles: ["sales"], aliases: ["Tang Tara"] },
  { key: "chloe-tan", name: "Chloe Tan", roles: ["sales"], aliases: ["Chloe Tan"] },
  { key: "jia-xin", name: "JIA XIN", roles: ["designer"], aliases: ["JIA XIN"] },
  { key: "ying-tzy", name: "YING TZY", roles: ["designer"], aliases: ["YING TZY"] },
  { key: "yi-xuan", name: "YI XUAN", roles: ["designer"], aliases: ["YI XUAN"] },
  { key: "joonjie-ho", name: "JoonJie Ho", roles: ["designer"], aliases: ["JoonJie Ho"] },
  { key: "alex", name: "Alex", roles: ["reno_pic"], aliases: ["Alex"] },
  { key: "foong", name: "Foong", roles: ["admin"], aliases: ["Foong"] },
  { key: "crew-zainal", name: "ZAINAL", roles: ["site_crew"], aliases: ["INHOUSE - ZAINAL"], notes: "In-house crew (Notion: INHOUSE - ZAINAL)" },
  { key: "crew-jahangril", name: "JAHANGRIL", roles: ["site_crew"], aliases: ["INHOUSE - JAHANGRIL"], notes: "In-house crew (Notion: INHOUSE - JAHANGRIL)" },
  { key: "crew-monir", name: "MONIR", roles: ["site_crew"], aliases: ["INHOUSE - MONIR"], notes: "In-house crew (Notion: INHOUSE - MONIR)" },
  { key: "crew-sey", name: "SEY", roles: ["site_crew"], aliases: ["INHOUSE - SEY"], notes: "In-house crew (Notion: INHOUSE - SEY)" },
  { key: "crew-atun", name: "ATUN TEAM", roles: ["site_crew"], aliases: ["INHOUSE ATUN TEAM", "INHOUSE - ATUN TEAM"], notes: "In-house crew (Notion: INHOUSE ATUN TEAM)" },
].map((p) => ({ ...p, ref: `notion:person:${p.key}` }));

/* Subcontractor names in the Notion Contractor list: kept as text on the task, never made suppliers. */
export const SUBCONTRACTORS = ["YILLON", "IDRESS", "KHALIQ", "LITTLE BUILDER", "SUNNY", "ELEGANZ- TIM", "ELEGANZ-TIM", "KIM SENG", "YJ", "BABU", "OUTSOURCE", "HOUZS"];

const personKey = (s) => normTitle(s).replace(/\s*-\s*/g, " - ");
const PERSON_BY_ALIAS = new Map(PEOPLE.flatMap((p) => p.aliases.map((a) => [personKey(a), p])));
export const personOf = (name) => PERSON_BY_ALIAS.get(personKey(name)) ?? null;
const isSub = (name) => SUBCONTRACTORS.some((s) => personKey(s) === personKey(name));

export const STEP_LABEL = { design: "Design", renovation: "Renovation", handover: "Handover", closed: "Closed" };

/** Notion status -> step of the 6-step flow (owner rule 11 Oct 2026). */
export function stepOf({ projectDone, handoverDate, reno }) {
  if (projectDone) return "closed";
  if (handoverDate) return "handover";
  if (reno === "In Progress") return "renovation";
  return "design";
}

function idTaskKind(title) {
  const head = normTitle((/^(.+?)\s*-/.exec(String(title)) ?? [null, title])[1]);
  if (head === "SITE MEASURE" || head === "SITE MEASUREMENT") return "site_measure";
  if (head === "2D DESIGN") return "2d";
  if (head === "3D DESIGN") return "3d";
  if (head === "ORDER LIST") return "order_list";
  return null;
}

function linkLabel(url) {
  const u = String(url);
  if (/drive\.google\.com\/drive\/folders/i.test(u)) return "Google Drive folder";
  if (/drive\.google\.com\/file/i.test(u)) return "Google Drive file";
  if (/docs\.google\.com\/spreadsheets/i.test(u)) return "Google Sheet";
  if (/coohom\.com/i.test(u)) return "Coohom 3D panorama";
  try { return new URL(u).hostname; } catch { return "Link"; }
}

const notionUrl = (id) => (id ? `https://app.notion.com/p/${id}` : null);

/**
 * @param {{ projects: object[], renoTasks: object[], idTasks: object[], exportDate: string, zipFiles?: Map<string, number> }} input
 *   zipFiles: file name -> size in bytes of the PDFs inside the exports (for design file sizes).
 */
export function mapExport({ projects, renoTasks, idTasks, exportDate, zipFiles = new Map() }) {
  const report = {
    exportDate,
    input: { projects: projects.length, renoTasks: renoTasks.length, idTasks: idTasks.length },
    skipped: { renoTasks: [], idTasks: [] },
    parseFailures: [],
    unmappedNames: {},
    conflicts: [],
    taskRefFallbacks: 0,
    drawingOnly: [],
    pendingFiles: { so: [], design: [] },
    subcontractorUse: {},
    occurrenceSharedTrade: [],
  };
  const unmapped = (where, name) => {
    const k = `${where}: ${name}`;
    report.unmappedNames[k] = (report.unmappedNames[k] ?? 0) + 1;
  };

  /* Project page ids are not a column of their own row: they come from the relation cells of the task
     exports, which link back to the project page. */
  const projectIdByTitle = new Map();
  for (const r of [...renoTasks, ...idTasks]) {
    for (const x of parseRelation(col(r, "Project 🔥"))) {
      if (x.id) projectIdByTitle.set(normTitle(x.title), x.id);
    }
  }

  const outProjects = [];
  const projectByPageId = new Map();
  const projectByTitle = new Map();
  for (const r of projects) {
    const name = String(col(r, "SO Number")).replace(/\s+/g, " ").trim();
    const nt = normTitle(name);
    const pageId = projectIdByTitle.get(nt) ?? null;
    const titleRef = `notion:title:${stableHash("project", nt)}`;
    const ref = pageId ? `notion:${pageId}` : titleRef;
    const { unitNo, customerName } = parseTitle(name);
    const soDateRaw = col(r, "SO Date");
    const soDate = parseDate(soDateRaw);
    if (soDateRaw && !soDate) report.parseFailures.push({ entity: "project", name, field: "SO Date", value: soDateRaw });
    const hoRaw = col(r, "Handover Date");
    const handoverDate = parseDate(hoRaw);
    if (hoRaw && !handoverDate) report.parseFailures.push({ entity: "project", name, field: "Handover Date", value: hoRaw });
    const reno = col(r, "Reno Condition").trim();
    const projectDone = yesNo(col(r, "Project Done"));
    const sales = splitList(col(r, "Sales Person"));
    const salesPeople = sales.map((s) => { const p = personOf(s); if (!p) unmapped("Sales Person", s); return p; }).filter(Boolean);
    const keyHolder = col(r, "Unit Key").trim();
    const keyPerson = keyHolder ? personOf(keyHolder) : null;
    if (keyHolder && !keyPerson) unmapped("Unit Key", keyHolder);
    const step = stepOf({ projectDone, handoverDate, reno });
    const p = {
      ref, titleRef, pageId, name, nt,
      building: col(r, "Building Name").trim() || null,
      unitNo, customerName,
      salespersonName: sales.join(", ") || null,
      salesPersonRef: salesPeople[0]?.ref ?? null,
      designerPersonRef: null,
      renoPicPersonRef: reno === "DRAWING ONLY" ? null : PEOPLE.find((x) => x.key === "alex").ref,
      handoverDate,
      handedOverAt: handoverDate ? `${handoverDate}T12:00:00+08:00` : null,
      notionUrl: notionUrl(pageId),
      soDate,
      step,
      stepReason: `Imported from Notion: Reno Condition "${reno || "(empty)"}", Project Done ${projectDone ? "Yes" : "No"}${handoverDate ? `, Handover Date ${handoverDate}` : ""}`,
      hold: reno === "IN DEFECT" ? "in_defect" : null,
      holdNote: reno === "IN DEFECT" ? "Imported from Notion (Reno Condition = IN DEFECT)" : null,
      keyHolderRef: keyPerson?.ref ?? null,
      facts: {
        soDate: soDateRaw || null,
        soFiles: splitFiles(col(r, "SO")).map((f) => f.value),
        idCondition: col(r, "ID Condition").trim() || null,
        renoCondition: reno || null,
        furnitureCondition: col(r, "Furniture Condition").trim() || null,
        renoItemCondition: col(r, "Reno Item Condition").trim() || null,
        paymentCondition: col(r, "Payment Condition").trim() || null,
        projectDone,
        vo: yesNo(col(r, "VO")),
        secondPayment: col(r, "2nd Payment").trim() || null,
        secondPaymentSen: parseMoneySen(col(r, "2nd Payment")),
        secondPaymentDate: parseDate(col(r, "2nd Payment Date")) ?? (col(r, "2nd Payment Date").trim() || null),
        done2dDate: parseDate(col(r, "Done 2D Date")) ?? (col(r, "Done 2D Date").trim() || null),
        startDate: parseDate(col(r, "Start Date")),
        endDate: parseDate(col(r, "End Date")),
        total: col(r, "TOTAL").trim() || null,
        status: col(r, "Status").trim() || null,
        sales,
      },
      renoRelation: parseRelation(col(r, "Renovation Timeline 🔥")),
      idRelation: parseRelation(col(r, "ID Task🔥")),
      orderLists: [],
      designNotes: [],
      firstTaskDate: null,
    };
    if (p.facts.soFiles.length) report.pendingFiles.so.push({ project: name, files: p.facts.soFiles });
    if (reno === "DRAWING ONLY") report.drawingOnly.push(name);
    if (projectDone && reno && reno !== "Done" && reno !== "DRAWING ONLY") report.conflicts.push({ project: name, issue: `Project Done = Yes but Reno Condition = ${reno}`, imported: "Closed" });
    if (!projectDone && reno === "Done") report.conflicts.push({ project: name, issue: "Reno Condition = Done but Project Done = No", imported: STEP_LABEL[step] });
    if (!projectDone && handoverDate) report.conflicts.push({ project: name, issue: `Handover Date ${handoverDate} but Project Done = No`, imported: "Handover" });
    if (reno === "IN DEFECT") report.conflicts.push({ project: name, issue: `Reno Condition = IN DEFECT (imported as the In defect hold flag on step ${STEP_LABEL[step]})`, imported: STEP_LABEL[step] });
    if (projectByTitle.has(nt)) report.parseFailures.push({ entity: "project", name, field: "SO Number", value: "duplicate title" });
    outProjects.push(p);
    projectByTitle.set(nt, p);
    if (pageId) projectByPageId.set(pageId, p);
  }
  const projectOfRow = (cell) => {
    const rel = parseRelation(cell)[0];
    if (!rel) return null;
    return (rel.id && projectByPageId.get(rel.id)) || projectByTitle.get(normTitle(rel.title)) || null;
  };

  /* ---- Renovation tasks -> project_trade_tasks ---- */
  const tasks = [];
  renoTasks.forEach((r, i) => {
    const rowNo = i + 2; // CSV line (header is line 1)
    const project = projectOfRow(col(r, "Project 🔥"));
    const catRaw = col(r, "Category").trim();
    const dateRaw = col(r, "Date");
    const contractors = splitList(col(r, "Contractor"));
    const brief = { row: rowNo, category: catRaw || null, date: dateRaw || null, contractor: contractors.join(", ") || null, done: col(r, "Done") || null };
    if (!project) { report.skipped.renoTasks.push({ ...brief, reason: parseRelation(col(r, "Project 🔥")).length ? "project not in the Project export" : "no project linked in Notion" }); return; }
    const cat = CATEGORY_BY_LABEL.get(normTitle(catRaw));
    if (!cat) { report.skipped.renoTasks.push({ ...brief, project: project.name, reason: catRaw ? `unknown category "${catRaw}"` : "no category in Notion" }); return; }
    const range = parseDateRange(dateRaw);
    if (!range.ok) report.parseFailures.push({ entity: "renovation task", row: rowNo, field: "Date", value: dateRaw });
    const crew = [];
    const subs = [];
    for (const c of contractors) {
      const person = personOf(c);
      if (person && person.roles.includes("site_crew")) crew.push(person);
      else if (isSub(c)) { subs.push(c); report.subcontractorUse[c] = (report.subcontractorUse[c] ?? 0) + 1; }
      else { subs.push(c); unmapped("Contractor", c); }
    }
    const code = taskCodeOf(cat);
    const fulfilment = code.startsWith("INTERNAL:") || crew.length || !subs.length ? "internal" : "po";
    const done = yesNo(col(r, "Done")) || project.step === "closed";
    const text = col(r, "Text").trim();
    const notes = [
      "Imported from Notion.",
      subs.length ? `Contractor (Notion): ${subs.join(", ")}.` : null,
      done && !yesNo(col(r, "Done")) ? "Marked done because the project is closed in Notion." : null,
      text ? `Notion text: ${text}` : null,
    ].filter(Boolean).join(" ");
    tasks.push({
      rowNo, project, cat, code, fix: cat.fix, fulfilment,
      state: done ? "done" : "open",
      plannedStart: range.start, plannedEnd: range.end,
      notes,
      // the parts of notes, so the SQL can rebuild the same text from a short payload
      noteParts: { subs: subs.join(", ") || null, markedDone: done && !yesNo(col(r, "Done")), text: text || null },
      assigneeRefs: [...new Set(crew.map((p) => p.ref))],
      ref: null,
    });
    if (range.start && (!project.firstTaskDate || range.start < project.firstTaskDate)) project.firstTaskDate = range.start;
  });

  // Own page id of a task: its entry in the project's "Renovation Timeline" relation ("CATEGORY - @Project").
  const byProjectCat = new Map();
  for (const t of tasks) {
    const k = `${t.project.ref}|${t.cat.code}`;
    if (!byProjectCat.has(k)) byProjectCat.set(k, []);
    byProjectCat.get(k).push(t);
  }
  for (const [k, list] of byProjectCat) {
    const project = list[0].project;
    const ids = project.renoRelation
      .filter((x) => x.id && CATEGORY_BY_LABEL.get(normTitle(x.title.split(/\s+-\s+@?/)[0]))?.code === list[0].cat.code)
      .map((x) => x.id);
    if (list.length === 1 && ids.length === 1) list[0].ref = `notion:${ids[0]}`;
    else {
      list.forEach((t, n) => {
        t.ref = `notion:h:${stableHash("reno-task", project.ref, t.cat.code, t.plannedStart, t.plannedEnd, n)}`;
        report.taskRefFallbacks++;
      });
    }
    void k;
  }

  // Occurrence: per project and task code (trade + fix phase), the same rule as manualTaskRow in the app, so
  // the unique index (project_id, trade_code, fix_phase, occurrence) holds; ordered by planned start, then CSV row.
  const byCode = new Map();
  for (const t of tasks) {
    const k = `${t.project.ref}|${t.code}|${t.fix}`;
    if (!byCode.has(k)) byCode.set(k, []);
    byCode.get(k).push(t);
  }
  for (const list of byCode.values()) {
    list.sort((a, b) => (a.plannedStart ?? "9999") .localeCompare(b.plannedStart ?? "9999") || a.rowNo - b.rowNo);
    list.forEach((t, n) => { t.occurrence = n + 1; t.seq = t.cat.sort * 10 + t.occurrence; });
    const cats = new Set(list.map((t) => t.cat.code));
    if (cats.size > 1) report.occurrenceSharedTrade.push({ project: list[0].project.name, taskCode: list[0].code, categories: [...cats] });
  }

  /* ---- ID tasks -> site measures, design files, order-list notes ---- */
  const siteMeasures = [];
  const designFiles = [];
  const designerCount = new Map();
  const versions = new Map();
  const idRows = idTasks.map((r, i) => ({ r, rowNo: i + 2, created: parseCreatedTime(col(r, "Created time")) }));
  idRows.sort((a, b) => (a.created ?? "").localeCompare(b.created ?? "") || a.rowNo - b.rowNo);
  for (const { r, rowNo, created } of idRows) {
    const title = String(col(r, "Task")).replace(/\s+/g, " ").trim();
    const project = projectOfRow(col(r, "Project 🔥"));
    const kind = idTaskKind(title);
    const brief = { row: rowNo, task: title || "(untitled)" };
    if (!project) { report.skipped.idTasks.push({ ...brief, reason: "no project linked in Notion" }); continue; }
    if (!kind) { report.skipped.idTasks.push({ ...brief, project: project.name, reason: "not a Site Measure / 2D / 3D / Order List task" }); continue; }
    const rel = project.idRelation.find((x) => normTitle(x.title) === normTitle(title));
    const pageId = rel?.id ?? null;
    const taskRef = pageId ? `notion:${pageId}` : `notion:h:${stableHash("id-task", project.ref, normTitle(title), col(r, "Created time"))}`;
    if (!pageId) report.taskRefFallbacks++;
    const pics = splitList(col(r, "PIC"));
    const picPeople = pics.map((n) => { const p = personOf(n); if (!p) unmapped("ID Task PIC", n); return p; }).filter(Boolean);
    const done = yesNo(col(r, "Done"));
    const end = parseDate(col(r, "End Date"));
    const start = parseDate(col(r, "Start Date"));
    if (col(r, "End Date") && !end) report.parseFailures.push({ entity: "ID task", row: rowNo, field: "End Date", value: col(r, "End Date") });
    const files = splitFiles(col(r, "Files"));
    const notionNote = col(r, "Notes").trim();
    const picText = pics.length ? pics.join(", ") : "none";
    const state = `${done ? "done" : "not done"}${end ? `, end ${end}` : ""}; PIC ${picText}`;
    if (kind === "site_measure") {
      if (done || end || start) {
        siteMeasures.push({
          ref: taskRef, project, doneOn: end ?? start ?? null, personRef: picPeople[0]?.ref ?? null,
          note: [`Imported from Notion: ${title}`, `Done ${done ? "Yes" : "No"}`, `PIC ${picText}`, end || start ? null : "date not recorded in Notion", notionNote ? `Notion notes: ${notionNote}` : null].filter(Boolean).join("; "),
        });
      } else project.designNotes.push(`Site measure not done yet in Notion (${state}).`);
      continue;
    }
    if (kind === "order_list") {
      project.orderLists.push(`Order list: ${state}${files.length ? `; ${files.map((f) => (f.isUrl ? f.value : `${f.value} (file in export)`)).join(", ")}` : ""}${notionNote ? `; Notion notes: ${notionNote}` : ""}`);
      continue;
    }
    for (const p of picPeople) if (p.roles.includes("designer")) designerCount.set(`${project.ref}|${p.ref}`, (designerCount.get(`${project.ref}|${p.ref}`) ?? 0) + 1);
    if (!files.length) { project.designNotes.push(`${kind.toUpperCase()} design: ${state}; no file attached in Notion.`); continue; }
    files.forEach((f) => {
      const vk = `${project.ref}|${kind}`;
      const version = (versions.get(vk) ?? 0) + 1;
      versions.set(vk, version);
      const fileRef = `${taskRef}:f:${stableHash(f.value)}`;
      const base = { ref: fileRef, project, kind, version, personRef: picPeople[0]?.ref ?? null, uploadedAt: created, brief: `${title}; ${state}`, notionPageId: null };
      if (f.isUrl) {
        designFiles.push({ ...base, fileName: linkLabel(f.value), contentType: null, sizeBytes: null, externalUrl: f.value,
          note: `Imported from Notion (${title}; ${state}). Link as recorded in Notion.` });
      } else {
        const url = notionUrl(pageId) ?? project.notionUrl;
        report.pendingFiles.design.push({ project: project.name, task: title, file: f.value, inExport: zipFiles.has(f.value) });
        if (!url) { report.parseFailures.push({ entity: "design file", row: rowNo, field: "Files", value: `${f.value}: no Notion page link to point at` }); return; }
        designFiles.push({ ...base, notionPageId: pageId ?? project.pageId, fileName: f.value, contentType: /\.pdf$/i.test(f.value) ? "application/pdf" : null,
          sizeBytes: zipFiles.get(f.value) ?? null, externalUrl: url,
          note: `Imported from Notion (${title}; ${state}). The file is attached to the Notion page this links to and is in the export id_tasks.zip; upload to the app is pending.` });
      }
    });
  }
  for (const p of outProjects) {
    let best = null;
    for (const person of PEOPLE) {
      const n = designerCount.get(`${p.ref}|${person.ref}`) ?? 0;
      if (n > 0 && (!best || n > best.n)) best = { ref: person.ref, n };
    }
    p.designerPersonRef = best?.ref ?? null;
  }

  /* ---- codes: RN-YYMM-NNN like create.ts; YYMM from the SO date (else first site task, else the export date) ---- */
  for (const p of outProjects) p.yymm = yymmOf(p.soDate ?? p.firstTaskDate ?? exportDate);
  outProjects.sort((a, b) => a.yymm.localeCompare(b.yymm) || (a.soDate ?? "").localeCompare(b.soDate ?? "") || a.nt.localeCompare(b.nt));
  outProjects.forEach((p, i) => { p.importOrder = i + 1; });

  /* ---- key holder, flow log, activity notes ---- */
  const keyMoves = outProjects.filter((p) => p.keyHolderRef).map((p) => ({
    ref: `notion:key:${p.ref}`, project: p, movedOn: exportDate, toPersonRef: p.keyHolderRef,
    note: `Key holder per the Notion "Unit Key" column at the export of ${exportDate}; the actual hand-over date was not exported.`,
  }));
  const flowLog = [];
  for (const p of outProjects) {
    flowLog.push({ ref: `notion:flow:${p.ref}:${p.step}`, project: p, kind: "manual_step", fromValue: null, toValue: p.step, reason: p.stepReason });
    if (p.hold) flowLog.push({ ref: `notion:hold:${p.ref}:${p.hold}`, project: p, kind: "hold_set", fromValue: null, toValue: p.hold, reason: p.holdNote });
  }
  const activity = outProjects.map((p) => ({ project: p, note: activityNote(p, exportDate) }));

  report.output = {
    people: PEOPLE.length,
    projects: outProjects.length,
    projectsWithPageId: outProjects.filter((p) => p.pageId).length,
    steps: countBy(outProjects, (p) => p.step),
    inDefect: outProjects.filter((p) => p.hold).length,
    tasks: tasks.length,
    tasksDone: tasks.filter((t) => t.state === "done").length,
    taskAssignees: tasks.reduce((n, t) => n + t.assigneeRefs.length, 0),
    siteMeasures: siteMeasures.length,
    designFiles: designFiles.length,
    designFilesPendingUpload: designFiles.filter((f) => !/^https?:\/\/(?!app\.notion\.com)/.test(f.externalUrl)).length,
    orderListNotes: outProjects.reduce((n, p) => n + p.orderLists.length, 0),
    keyMoves: keyMoves.length,
    flowLog: flowLog.length,
    activityNotes: activity.length,
  };
  return { people: PEOPLE, projects: outProjects, tasks, siteMeasures, designFiles, keyMoves, flowLog, activity, report };
}

function countBy(list, f) {
  const m = {};
  for (const x of list) m[f(x)] = (m[f(x)] ?? 0) + 1;
  return m;
}

/** The "Imported from Notion" activity note: the facts the app has no field for (no SO is fabricated). */
export function activityNote(p, exportDate) {
  const f = p.facts;
  const lines = [
    `Imported from Notion (export ${exportDate}).`,
    `SO number (Notion title): ${p.name}`,
    f.soDate ? `SO date: ${p.soDate ?? f.soDate}` : "SO date: not recorded",
    f.soFiles.length ? `SO file(s): ${f.soFiles.join(", ")} (in the Notion export project.zip; upload to the app pending)` : "SO file: none attached in Notion",
    `Payment condition: ${f.paymentCondition ?? "-"}`,
    `Furniture condition: ${f.furnitureCondition ?? "-"}`,
    `Reno item condition: ${f.renoItemCondition ?? "-"}`,
    `ID condition: ${f.idCondition ?? "-"}`,
    `Reno condition: ${f.renoCondition ?? "-"}`,
    `Project done: ${f.projectDone ? "Yes" : "No"}`,
    `VO: ${f.vo ? "Yes" : "No"}`,
    f.secondPayment ? `2nd payment: ${f.secondPayment}` : null,
    f.secondPaymentDate ? `2nd payment date: ${f.secondPaymentDate}` : null,
    f.done2dDate ? `Done 2D date: ${f.done2dDate}` : null,
    f.startDate || f.endDate ? `Design start / end: ${f.startDate ?? "-"} / ${f.endDate ?? "-"}` : null,
    f.total ? `TOTAL: ${f.total}` : null,
    p.handoverDate ? `Handover date: ${p.handoverDate}` : null,
    f.sales.length > 1 ? `Sales persons: ${f.sales.join(", ")}` : null,
    f.renoCondition === "DRAWING ONLY" ? "Drawing-only job in Notion: the app has no design-only project type yet, so it is a full renovation project here." : null,
    ...p.orderLists,
    ...p.designNotes,
  ];
  return lines.filter(Boolean).join("\n");
}
