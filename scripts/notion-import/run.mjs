#!/usr/bin/env node
// Notion renovation records -> idempotent SQL for the Conts ERP engine tables (public.projects and the
// simplified-project records of migrations 0083-0086). Reads the Notion "Markdown & CSV" exports, writes
// SQL chunks plus a dry-run report into a folder OUTSIDE the repository. It never connects to a database:
// apply the chunks in name order (psql, or the Supabase SQL tool), staging first.
//
//   node scripts/notion-import/run.mjs --export <dir with project.zip, reno_tasks.zip, id_tasks.zip> \
//        [--out <dir>] [--company 1] [--export-date YYYY-MM-DD]
//
// --out defaults to <export>/sql. The export date (default: the export folder's name when it is a date)
// stamps the unit-key moves ("holder at export") and the activity notes.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listZip, readZipEntry } from "./zip.mjs";
import { parseCsv } from "./parse.mjs";
import { mapExport } from "./map.mjs";
import { buildSql } from "./sql.mjs";
import { reportText } from "./report.mjs";

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.includes("=") ? a.slice(2).split(/=(.*)/s) : [a.slice(2), argv[++i]];
      out[k] = v;
    }
  }
  return out;
}

/** The "_all" CSV of a Notion export zip (the full database, not the current view), plus the sizes of its other files. */
export function readExportZip(zipPath) {
  const entries = listZip(zipPath);
  const csvs = entries.filter((e) => /\.csv$/i.test(e.name));
  const csv = csvs.find((e) => /_all\.csv$/i.test(e.name)) ?? csvs[0];
  if (!csv) throw new Error(`no CSV in ${zipPath}`);
  const rows = parseCsv(readZipEntry(zipPath, csv).toString("utf8"));
  const files = new Map(entries.filter((e) => !/\.csv$/i.test(e.name)).map((e) => [path.posix.basename(e.name), e.size]));
  return { rows, files, csvName: csv.name };
}

function main() {
  const a = args(process.argv.slice(2));
  if (!a.export) {
    console.error("usage: node scripts/notion-import/run.mjs --export <dir> [--out <dir>] [--company 1] [--export-date YYYY-MM-DD]");
    process.exit(2);
  }
  const exportDir = path.resolve(a.export);
  const outDir = path.resolve(a.out ?? path.join(exportDir, "sql"));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const rel = path.relative(repoRoot, outDir);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    console.error(`refusing to write into the repository (${outDir}): the export holds customer data`);
    process.exit(2);
  }
  const folderDate = /^\d{4}-\d{2}-\d{2}$/.test(path.basename(exportDir)) ? path.basename(exportDir) : null;
  const exportDate = a["export-date"] ?? folderDate ?? new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exportDate)) { console.error("--export-date must be YYYY-MM-DD"); process.exit(2); }

  const project = readExportZip(path.join(exportDir, "project.zip"));
  const reno = readExportZip(path.join(exportDir, "reno_tasks.zip"));
  const id = readExportZip(path.join(exportDir, "id_tasks.zip"));
  const zipFiles = new Map([...project.files, ...id.files]);

  const mapped = mapExport({ projects: project.rows, renoTasks: reno.rows, idTasks: id.rows, exportDate, zipFiles });
  const chunks = buildSql(mapped, { companyId: a.company ?? 1 });

  fs.mkdirSync(outDir, { recursive: true });
  // chunks of an earlier run (their count can change); nothing else in the folder is touched
  for (const f of fs.readdirSync(outDir)) if (/^\d\d[a-z]?_[a-z_]+\.sql$/.test(f)) fs.rmSync(path.join(outDir, f));
  for (const c of chunks) fs.writeFileSync(path.join(outDir, c.name), c.sql, "utf8");
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(mapped.report, null, 2), "utf8");
  fs.writeFileSync(path.join(outDir, "report.txt"), reportText(mapped.report, chunks), "utf8");
  console.log(reportText(mapped.report, chunks));
  console.log(`\nWrote ${chunks.length} SQL chunks + report to ${outDir}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
