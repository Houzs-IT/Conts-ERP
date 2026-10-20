#!/usr/bin/env node
// Uploads the design PDFs an import left pending (a design file row that still links to its Notion page) into the
// engine's R2 bucket, then points that row at the uploaded copy. The PDFs come from the Notion export zips.
// Dry run unless --apply. It names the database and bucket before doing anything and refuses a pair that does not
// belong together (staging database with the staging bucket, production with production).
//
//   DATABASE_URL=... node scripts/notion-import/upload-files.mjs --export <dir with the export zips> --bucket <name> [--apply]
//   node scripts/notion-import/upload-files.mjs --export <dir> --bucket <name> --env-file=<file with DATABASE_URL="..."> [--apply]
//
// Uploads go through `npx wrangler r2 object put --remote` on the Conts ERP Cloudflare account (pinned below), so wrangler
// must be signed in with access to that account (`npx wrangler login`, or CLOUDFLARE_API_TOKEN set in your own terminal).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { listZip, readZipEntry } from "./zip.mjs";

const BUCKET_OF = { ecgyrmblqfxvbfjlqkdq: "theconts-scm-staging", cweomoenhsjvsxfsmiiw: "theconts-scm" };
// The Conts ERP Cloudflare account (same id as the engine deploy workflows). Pinned, so a wrangler signed in to
// another account (Houzs's, on a shared machine) fails instead of writing there.
const CONTS_ACCOUNT_ID = "3a9ff01edda85702f9e2649fb340f1cc";
const MAX_BYTES = 25 * 1024 * 1024; // DESIGN_FILE_MAX in the engine

/** File names as Notion writes them in the CSV and as the zip stores them compare equal: "A B.pdf" vs "A_B.pdf",
    "A%20B%EF%BC%88x).pdf" (escaped, full-width bracket) vs "A B（x).pdf". */
export function fileKey(name) {
  let s = path.posix.basename(String(name));
  try { s = decodeURIComponent(s); } catch { /* a bare % stays as it is */ }
  return s.normalize("NFKC").toLowerCase().replace(/[\s_]+/g, "_");
}

/** basename key -> { zip, entry }, from every zip in the folder; a name found twice is left out (ambiguous). */
export function exportFiles(dir) {
  const seen = new Map();
  const twice = new Set();
  for (const f of fs.readdirSync(dir).filter((n) => /\.zip$/i.test(n))) {
    for (const e of listZip(path.join(dir, f))) {
      if (!/\.pdf$/i.test(e.name)) continue;
      const k = fileKey(e.name);
      if (seen.has(k) && seen.get(k).entry.size !== e.size) twice.add(k);
      seen.set(k, { zip: path.join(dir, f), entry: e });
    }
  }
  for (const k of twice) seen.delete(k);
  return { files: seen, ambiguous: [...twice] };
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    if (a.includes("=")) { const [k, v] = a.slice(2).split(/=(.*)/s); out[k] = v; }
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}

async function main() {
  const a = args(process.argv.slice(2));
  if (!a.export || !a.bucket) {
    console.error("usage: node scripts/notion-import/upload-files.mjs --export <dir> --bucket <name> [--env-file=<file>] [--apply]");
    process.exit(2);
  }
  const vars = a["env-file"] ? fs.readFileSync(a["env-file"], "utf8") : "";
  const url = process.env.DATABASE_URL ?? vars.match(/^DATABASE_URL="([^"]+)"/m)?.[1];
  if (!url) { console.error("DATABASE_URL not set. Nothing was uploaded."); process.exit(2); }
  const ref = url.match(/postgres\.([a-z0-9]{20})\b/)?.[1] ?? url.match(/db\.([a-z0-9]{20})\.supabase\.co/)?.[1] ?? null;
  if (!ref || BUCKET_OF[ref] !== a.bucket) {
    console.error(`Database ${ref ?? "(unknown)"} does not go with bucket ${a.bucket}. Nothing was uploaded.`);
    process.exit(2);
  }
  console.log(`Target database: ${ref}, bucket: ${a.bucket}${a.apply ? "" : "  (dry run)"}`);

  const { files, ambiguous } = exportFiles(path.resolve(a.export));
  const sql = postgres(url, { max: 1, prepare: false, ssl: "require" });
  try {
    const rows = await sql`
      select f.id::int as id, f.project_id::int as project_id, f.kind, f.file_name
        from public.project_design_files f
       where f.source = 'import' and f.r2_key is null and f.external_url like 'https://app.notion.com/p/%'
       order by f.id`;
    const plan = rows.map((r) => ({ ...r, found: files.get(fileKey(r.file_name)) ?? null }));
    const missing = plan.filter((p) => !p.found);
    const tooBig = plan.filter((p) => p.found && p.found.entry.size > MAX_BYTES);
    const todo = plan.filter((p) => p.found && p.found.entry.size <= MAX_BYTES);
    console.log(`Pending design files: ${rows.length}; in the export: ${todo.length}; not in the export: ${missing.length}; over 25 MB: ${tooBig.length}`);
    for (const p of missing) console.log(`  not in export: #${p.id} ${p.file_name}`);
    for (const p of tooBig) console.log(`  over 25 MB: #${p.id} ${p.file_name}`);
    if (ambiguous.length) console.log(`  names found twice with different sizes (left out): ${ambiguous.join(", ")}`);
    if (!a.apply) { console.log("Dry run: nothing uploaded. Add --apply to upload."); return; }

    const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "notion-pdf-"));
    const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "engine", "backend");
    let done = 0;
    try {
      for (const p of todo) {
        const buf = readZipEntry(p.found.zip, p.found.entry);
        const key = `renovation/${p.project_id}/design-${p.kind}-notion-${p.id}.pdf`;
        const file = path.join(tmp, `${p.id}.pdf`);
        fs.writeFileSync(file, buf);
        const put = spawnSync("npx", ["wrangler", "r2", "object", "put", `${a.bucket}/${key}`, "--file", file, "--content-type", "application/pdf", "--remote"],
          { cwd: backend, shell: process.platform === "win32", encoding: "utf8", env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: CONTS_ACCOUNT_ID } });
        if (put.status !== 0) {
          console.error(`  upload failed: #${p.id} ${p.file_name}\n${(put.stderr || put.stdout || "").slice(-400)}`);
          // the same failure for every file (not signed in to the Conts account): stop after the first
          if (done === 0) { console.error("Stopped at the first failure. Nothing was changed in the database."); break; }
          continue;
        }
        // only a row that is still pending; the note stops saying the upload is pending
        const upd = await sql`
          update public.project_design_files
             set r2_key = ${key}, size_bytes = ${buf.length}, content_type = 'application/pdf', external_url = null,
                 note = replace(note, 'upload to the app is pending.', ${`uploaded to the app on ${today}.`})
           where id = ${p.id} and r2_key is null`;
        if (upd.count === 1) done++;
        console.log(`  ${upd.count === 1 ? "uploaded" : "uploaded, row already changed"}: #${p.id} ${p.file_name} -> ${key}`);
        fs.rmSync(file, { force: true });
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    console.log(`Uploaded and linked ${done} of ${todo.length}.`);
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
