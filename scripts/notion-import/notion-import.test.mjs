// node --test scripts/notion-import/
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  parseCsv, parseRelation, parseDate, parseDateRange, parseCreatedTime, parseMoneySen, parseTitle, splitFiles, col, pageIdOf,
} from "./parse.mjs";
import { TASK_CATEGORIES, taskCodeOf, stepOf, mapExport, personOf } from "./map.mjs";
import { buildSql } from "./sql.mjs";
import { listZip, readZipEntry } from "./zip.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");

test("parseCsv: BOM, quotes, embedded commas, newlines and doubled quotes", () => {
  const rows = parseCsv('﻿A,B,"C "\r\n1,"x, y","say ""hi""\nthere"\r\n2,,\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { A: "1", B: "x, y", C: 'say "hi"\nthere' });
  assert.equal(col(rows[1], "C"), "");
  assert.equal(col({ "Project 🔥": "p" }, "Project 🔥"), "p");
  assert.equal(col({ "TOTAL ": "9" }, "TOTAL"), "9");
});

test("parseRelation: titles and page ids from URLs", () => {
  const cell = "Order List - X ✅ (https://app.notion.com/p/Order-List-X-33d7ce8e74e180478efdeef4e0b7fb66?pvs=21), "
    + "PRE-RENO WORKS & ITEM DELIVERY - @THE FORESTA 19-05 MR KENNY   (https://app.notion.com/p/PRE-RENO-39f7ce8e74e180adb332f03135ba2402?pvs=21)";
  const r = parseRelation(cell);
  assert.equal(r.length, 2);
  assert.equal(r[0].id, "33d7ce8e74e180478efdeef4e0b7fb66");
  assert.equal(r[1].title, "PRE-RENO WORKS & ITEM DELIVERY - @THE FORESTA 19-05 MR KENNY");
  assert.deepEqual(parseRelation(""), []);
  assert.equal(pageIdOf("https://app.notion.com/p/2767ce8e74e18077897de9e7f249b6b6"), "2767ce8e74e18077897de9e7f249b6b6");
});

test("dates, ranges, created time and money", () => {
  assert.equal(parseDate("31/01/2026"), "2026-01-31");
  assert.equal(parseDate("October 25, 2025"), "2025-10-25");
  assert.equal(parseDate("June 24, 2026"), "2026-06-24");
  assert.equal(parseDate("31/02/2026"), null);
  assert.equal(parseDate("garbage"), null);
  assert.deepEqual(parseDateRange("26/09/2025 → 30/09/2025"), { start: "2025-09-26", end: "2025-09-30", ok: true });
  assert.deepEqual(parseDateRange("24/07/2025"), { start: "2025-07-24", end: "2025-07-24", ok: true });
  assert.deepEqual(parseDateRange(""), { start: null, end: null, ok: true });
  assert.equal(parseDateRange("soon").ok, false);
  assert.equal(parseCreatedTime("September 12, 2025 12:48 PM"), "2025-09-12T12:48:00+08:00");
  assert.equal(parseCreatedTime("September 12, 2025 12:05 AM"), "2025-09-12T00:05:00+08:00");
  assert.equal(parseMoneySen("MYR 36,756.32"), 3675632);
  assert.equal(parseMoneySen("8000"), 800000);
  assert.equal(parseMoneySen("DONE RENOVATION"), null);
});

test("parseTitle: unit and customer as the title has them", () => {
  assert.deepEqual(parseTitle("BARON C-20-08 MR ALBERT"), { unitNo: "C-20-08", customerName: "MR ALBERT" });
  assert.deepEqual(parseTitle("ALTRIS C13-3A"), { unitNo: "C13-3A", customerName: null });
  assert.deepEqual(parseTitle("SO - CARRES PENANG ( MR NG )"), { unitNo: null, customerName: "MR NG" });
  assert.deepEqual(parseTitle("HILLPARK D52-08 MR TERENCE (KRIS)"), { unitNo: "D52-08", customerName: "MR TERENCE (KRIS)" });
  assert.deepEqual(parseTitle("CANDELA @ CHERAS NO.46 MR ANDY & MS JAMIE"), { unitNo: "NO.46", customerName: "MR ANDY & MS JAMIE" });
  assert.deepEqual(parseTitle("AVA KIARA BAY B-23A-12 MR NG FAMILY"), { unitNo: "B-23A-12", customerName: "MR NG FAMILY" });
  assert.deepEqual(parseTitle("THE FORESTA 19-05 MR KENNY "), { unitNo: "19-05", customerName: "MR KENNY" });
  assert.deepEqual(parseTitle("ICON CITY T2-18-02 MR LOW"), { unitNo: "T2-18-02", customerName: "MR LOW" });
  assert.deepEqual(parseTitle("SKYLINE PUDU SHOWROOM"), { unitNo: null, customerName: null });
  assert.deepEqual(parseTitle("SO - NO.72 , JALAN AMAN ELEMEN 8 ( ELEMEN RESIDENCE ) MR ZHU "), { unitNo: "NO.72", customerName: "MR ZHU" });
});

test("splitFiles keeps URLs whole and flags file names", () => {
  const f = splitFiles("https://drive.google.com/drive/folders/1Xw, ALTAR_SUBANG.pdf");
  assert.deepEqual(f, [{ value: "https://drive.google.com/drive/folders/1Xw", isUrl: true }, { value: "ALTAR_SUBANG.pdf", isUrl: false }]);
});

test("task categories match renovation-stages.ts and migration 0084", () => {
  const ts = fs.readFileSync(path.join(repo, "engine/backend/src/scm/shared/renovation-stages.ts"), "utf8");
  const fromTs = [...ts.matchAll(/\{ code: '([A-Z_]+)', label: '([^']+)', stage: '([a-z_]+)', trade: (null|'[A-Z_]+'), fix: '([a-z]+)', internalKey: (null|'[a-z_]+'), tradeDefault: (?:true|false), sort: (\d+)/g)]
    .map((m) => ({ code: m[1], label: m[2], stage: m[3], trade: m[4] === "null" ? null : m[4].slice(1, -1), fix: m[5], internalKey: m[6] === "null" ? null : m[6].slice(1, -1), sort: Number(m[7]) }));
  assert.equal(fromTs.length, TASK_CATEGORIES.length);
  assert.deepEqual(TASK_CATEGORIES, fromTs);
  const mig = fs.readFileSync(path.join(repo, "migrations-pg/0084_renovation_task_categories_crew.sql"), "utf8");
  for (const c of TASK_CATEGORIES) assert.ok(mig.includes(`('${c.code}', '${c.label}', '${c.stage}'`), `0084 has ${c.code}`);
  assert.equal(taskCodeOf(TASK_CATEGORIES.find((c) => c.code === "QC")), "INTERNAL:qc");
  assert.equal(taskCodeOf(TASK_CATEGORIES.find((c) => c.code === "CARPENTRY")), "CAT:CARPENTRY");
  assert.equal(taskCodeOf(TASK_CATEGORIES.find((c) => c.code === "PAINTING")), "PAINTING");
});

test("stepOf: owner's mapping", () => {
  assert.equal(stepOf({ projectDone: true, handoverDate: null, reno: "In Progress" }), "closed");
  assert.equal(stepOf({ projectDone: false, handoverDate: "2026-08-24", reno: "Done" }), "handover");
  assert.equal(stepOf({ projectDone: false, handoverDate: null, reno: "In Progress" }), "renovation");
  assert.equal(stepOf({ projectDone: false, handoverDate: null, reno: "IN DEFECT" }), "design");
  assert.equal(stepOf({ projectDone: false, handoverDate: null, reno: "" }), "design");
});

test("people aliases", () => {
  assert.equal(personOf("INHOUSE - ZAINAL").name, "ZAINAL");
  assert.equal(personOf("INHOUSE ATUN TEAM").name, "ATUN TEAM");
  assert.equal(personOf("jia xin").name, "JIA XIN");
  assert.equal(personOf("YILLON"), null);
});

const PID = "2767ce8e74e18077897de9e7f249b6b6";
const PID2 = "3497ce8e74e180c0bd36fae47f3efe6a";
const url = (slug, id) => `https://app.notion.com/p/${slug}-${id}?pvs=21`;
function fixture() {
  const projects = [
    {
      "SO Number": "ALTRIS C13-3A", "Building Name": "ALTRIS", "SO Date": "06/05/2025", "Project Done": "Yes", "Reno Condition": "In Progress",
      "Handover Date": "February 24, 2026", "Sales Person": "Chai Mengkeat, Tang Tara", "Unit Key": "Alex", VO: "Yes", SO: "SO_A.pdf, SO_B.pdf",
      "2nd Payment": "MYR 1,000.00", "Payment Condition": "Done Payment",
      "Renovation Timeline 🔥": `PAINTING - @ALTRIS C13-3A (${url("PAINTING", "a".repeat(32))}), CARPENTRY - @ALTRIS C13-3A (${url("CARPENTRY", "b".repeat(32))}), CARPENTRY - @ALTRIS C13-3A (${url("CARPENTRY", "c".repeat(32))})`,
      "ID Task🔥": `2D Design - ALTRIS ✅ (${url("2D", "d".repeat(32))}), Site Measure - ALTRIS ✅ (${url("SM", "e".repeat(32))})`,
    },
    { "SO Number": "ASTER HILL A-01-06 MR AIDEN ", "Building Name": "ASTER HILL", "SO Date": "23/03/2026", "Project Done": "No", "Reno Condition": "IN DEFECT", "Unit Key": "JIA XIN", "Sales Person": "Michell Lo Siaw Maan" },
    { "SO Number": "QUAVE A-27-16 MR DARREN", "Building Name": "QUAVER", "SO Date": "09/10/2026", "Project Done": "No", "Reno Condition": "In Progress", "Sales Person": "" },
  ];
  const proj = `ALTRIS C13-3A (${url("ALTRIS-C13-3A", PID)})`;
  const renoTasks = [
    { Task: "x", Category: "CARPENTRY", Contractor: "YILLON", Date: "20/10/2025 → 22/10/2025", Done: "No", "Project 🔥": proj, Text: "" },
    { Task: "x", Category: "PAINTING", Contractor: "INHOUSE - JAHANGRIL, INHOUSE - ZAINAL", Date: "10/10/2025", Done: "No", "Project 🔥": proj, Text: "TBC" },
    { Task: "x", Category: "CARPENTRY", Contractor: "", Date: "01/10/2025", Done: "Yes", "Project 🔥": proj, Text: "" },
    { Task: "", Category: "", Contractor: "", Date: "", Done: "No", "Project 🔥": "", Text: "" },
    { Task: "", Category: "", Contractor: "", Date: "", Done: "No", "Project 🔥": proj, Text: "" },
    { Task: "x", Category: "PAINTING", Contractor: "", Date: "", Done: "No", "Project 🔥": `QUAVE A-27-16 MR DARREN (${url("Q", PID2)})`, Text: "" },
  ];
  const idTasks = [
    { Task: "2D Design - ALTRIS ✅", "Created time": "September 29, 2025 11:20 AM", Done: "Yes", Files: "https://drive.google.com/drive/folders/1Xw, ALTAR_SUBANG.pdf", PIC: "JoonJie Ho", "Project 🔥": proj, "End Date": "" },
    { Task: "Site Measure - ALTRIS ✅", "Created time": "September 29, 2025 11:20 AM", Done: "Yes", Files: "", PIC: "JIA XIN", "Project 🔥": proj, "End Date": "September 30, 2025" },
    { Task: "Order List - ALTRIS", "Created time": "September 29, 2025 11:20 AM", Done: "No", Files: "https://docs.google.com/spreadsheets/d/1k", PIC: "", "Project 🔥": proj, "End Date": "" },
    { Task: "3D Design - ORPHAN", "Created time": "", Done: "No", Files: "", PIC: "Sia Josiah", "Project 🔥": "", "End Date": "" },
  ];
  return { projects, renoTasks, idTasks, exportDate: "2026-10-11", zipFiles: new Map([["ALTAR_SUBANG.pdf", 1234]]) };
}

test("mapExport: projects, steps, hold, people links, key holder", () => {
  const m = mapExport(fixture());
  assert.equal(m.projects.length, 3);
  const altris = m.projects.find((p) => p.name === "ALTRIS C13-3A");
  assert.equal(altris.ref, `notion:${PID}`);
  assert.equal(altris.notionUrl, `https://app.notion.com/p/${PID}`);
  assert.equal(altris.step, "closed");
  assert.equal(altris.salesPersonRef, "notion:person:chai-mengkeat");
  assert.equal(altris.designerPersonRef, "notion:person:joonjie-ho");
  assert.equal(altris.handedOverAt, "2026-02-24T12:00:00+08:00");
  const aster = m.projects.find((p) => p.name.startsWith("ASTER"));
  assert.match(aster.ref, /^notion:title:[0-9a-f]{16}$/);
  assert.equal(aster.hold, "in_defect");
  assert.equal(aster.step, "design");
  assert.equal(m.keyMoves.length, 2);
  assert.ok(m.report.conflicts.some((c) => c.project === "ALTRIS C13-3A" && /Project Done = Yes/.test(c.issue)));
  assert.deepEqual(m.projects.map((p) => p.yymm), ["2505", "2603", "2610"]);
  const note = m.activity.find((a) => a.project === altris).note;
  assert.match(note, /SO file\(s\): SO_A.pdf, SO_B.pdf/);
  assert.match(note, /2nd payment: MYR 1,000.00/);
  assert.match(note, /Sales persons: Chai Mengkeat, Tang Tara/);
  assert.match(note, /Order list: not done/);
});

test("mapExport: site tasks, occurrence, done on closed projects, crew and subcontractor text, skips", () => {
  const m = mapExport(fixture());
  assert.equal(m.tasks.length, 4);
  const altrisTasks = m.tasks.filter((t) => t.project.name === "ALTRIS C13-3A");
  const carp = altrisTasks.filter((t) => t.cat.code === "CARPENTRY").sort((a, b) => a.occurrence - b.occurrence);
  assert.deepEqual(carp.map((t) => [t.plannedStart, t.occurrence]), [["2025-10-01", 1], ["2025-10-20", 2]]);
  assert.ok(carp.every((t) => t.ref.startsWith("notion:h:")), "two tasks of one category share a title: hashed refs");
  assert.ok(altrisTasks.every((t) => t.state === "done"), "closed project: every task done");
  const paint = altrisTasks.find((t) => t.cat.code === "PAINTING");
  assert.equal(paint.ref, `notion:${"a".repeat(32)}`);
  assert.deepEqual(paint.assigneeRefs, ["notion:person:crew-jahangril", "notion:person:crew-zainal"]);
  assert.equal(paint.fulfilment, "internal");
  assert.match(paint.notes, /Notion text: TBC/);
  assert.equal(carp[1].fulfilment, "po");
  assert.match(carp[1].notes, /Contractor \(Notion\): YILLON/);
  const quave = m.tasks.find((t) => t.project.name.startsWith("QUAVE"));
  assert.equal(quave.state, "open");
  assert.equal(m.report.skipped.renoTasks.length, 2);
});

test("mapExport: design records and files, pending PDFs point at the Notion page", () => {
  const m = mapExport(fixture());
  assert.equal(m.siteMeasures.length, 1);
  assert.equal(m.siteMeasures[0].doneOn, "2025-09-30");
  assert.equal(m.siteMeasures[0].personRef, "notion:person:jia-xin");
  assert.equal(m.designFiles.length, 2);
  const pdf = m.designFiles.find((f) => f.fileName === "ALTAR_SUBANG.pdf");
  assert.equal(pdf.externalUrl, `https://app.notion.com/p/${"d".repeat(32)}`);
  assert.equal(pdf.sizeBytes, 1234);
  assert.equal(pdf.kind, "2d");
  assert.match(pdf.note, /upload to the app is pending/);
  assert.deepEqual(m.designFiles.map((f) => f.version).sort(), [1, 2]);
  assert.equal(m.report.skipped.idTasks.length, 1);
});

test("buildSql: deterministic, upsert-only, refuses unsafe input", () => {
  const a = buildSql(mapExport(fixture()));
  const b = buildSql(mapExport(fixture()));
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((c) => c.name), ["01_people_projects.sql", "02a_tasks.sql", "03a_site_measures.sql", "03b_design_files.sql", "04a_activity.sql"]);
  for (const c of a) {
    assert.match(c.sql, /^-- Notion import/);
    assert.match(c.sql, /\nbegin;\n/);
    assert.match(c.sql, /\ncommit;\n/);
    assert.doesNotMatch(c.sql, /\bdelete\s+from\b|\bdrop\s+table\s+(?!if exists _)|\btruncate\b/i);
  }
  assert.match(a[0].sql, /p\.updated_at is not distinct from p\.created_at/);
  assert.match(a[1].sql, /t\.updated_at = t\.created_at/);
  assert.throws(() => buildSql(mapExport(fixture()), { companyId: "1; drop" }));
});

test("buildSql: every payload carries its md5", () => {
  for (const c of buildSql(mapExport(fixture()))) {
    const payloads = [...c.sql.matchAll(/\((\d+), \$notion_json\$([\s\S]*?)\$notion_json\$\)/g)].map((m) => [Number(m[1]), m[2]]);
    const sums = new Map([...c.sql.matchAll(/\((\d+), '([0-9a-f]{32})'\)/g)].map((m) => [Number(m[1]), m[2]]));
    assert.ok(payloads.length >= 1);
    for (const [k, text] of payloads) {
      assert.equal(crypto.createHash("md5").update(text).digest("hex"), sums.get(k), `${c.name} payload ${k}`);
      JSON.parse(text);
    }
  }
  assert.match(buildSql(mapExport(fixture()))[0].sql, /MR AIDEN/);
});

test("zip reader: stored and deflated entries", () => {
  const files = [["a_all.csv", Buffer.from("X,Y\n1,2\n"), 8], ["b.pdf", Buffer.from("%PDF-1.4 hello hello hello"), 0]];
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, data, method] of files) {
    const body = method === 8 ? zlib.deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name);
    const crc = zlib.crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, body);
    central.push(ch, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "notion-zip-"));
  const zp = path.join(dir, "t.zip");
  fs.writeFileSync(zp, Buffer.concat([...locals, cd, eocd]));
  const entries = listZip(zp);
  assert.deepEqual(entries.map((e) => [e.name, e.size]), [["a_all.csv", 8], ["b.pdf", 26]]);
  assert.equal(readZipEntry(zp, entries[0]).toString(), "X,Y\n1,2\n");
  assert.equal(readZipEntry(zp, entries[1]).toString(), "%PDF-1.4 hello hello hello");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("task notes rebuilt by the SQL from their parts equal the mapped notes", () => {
  const rebuild = (p) => "Imported from Notion." + (p.subs ? ` Contractor (Notion): ${p.subs}.` : "")
    + (p.markedDone ? " Marked done because the project is closed in Notion." : "") + (p.text ? ` Notion text: ${p.text}` : "");
  const m = mapExport(fixture());
  for (const t of m.tasks) assert.equal(rebuild(t.noteParts), t.notes);
  const sql = buildSql(m)[1].sql;
  assert.match(sql, /' Contractor \(Notion\): ' \|\| x\.x \|\| '\.'/);
  assert.match(sql, /' Marked done because the project is closed in Notion\.'/);
  assert.match(sql, /' Notion text: ' \|\| x\.n/);
});
