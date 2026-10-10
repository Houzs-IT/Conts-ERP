// Shared runner for the standards checks (docs/UI-STANDARDS.md). Each check:
//  1. self-tests its matcher on a planted bad sample (must be caught) and a good sample (must pass),
//     so a broken regex that matches nothing cannot report a clean codebase;
//  2. scans the real files and prints every violation as path:line;
//  3. honours a short allow-list, where every entry carries its reason.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every file under `dir` (relative to the repo root) whose name matches `ext`, as forward-slash relative paths. */
export function walk(dir, ext = /\.(ts|tsx)$/) {
  const out = [];
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  const visit = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') visit(p); }
      else if (ext.test(e.name)) out.push(path.relative(ROOT, p).split(path.sep).join('/'));
    }
  };
  visit(abs);
  return out.sort();
}

export const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

/** Blanks out comments (keeping line numbers) so a rule about code is not tripped by prose about it. */
export function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, (m, a) => a);
}

/** Line hits for any of `patterns` in `text`. Each pattern: { re, msg }. */
export function lineHits(text, patterns) {
  const hits = [];
  text.split('\n').forEach((line, i) => {
    for (const { re, msg } of patterns) {
      const r = new RegExp(re.source, re.flags.replace('g', ''));
      const m = r.exec(line);
      if (m) hits.push({ line: i + 1, msg: typeof msg === 'function' ? msg(m) : msg, text: line.trim().slice(0, 160) });
    }
  });
  return hits;
}

/**
 * def: { name, rule, files: () => string[], scan: (text, rel) => hits[], allow?: { [rel]: reason },
 *        selfTest: { bad: [{ path, text }], good: [{ path, text }] } }
 * Returns the number of violations (self-test failure counts as one and is reported loudly).
 */
export function runCheck(def) {
  const problems = [];
  for (const s of def.selfTest.bad) {
    if (def.scan(s.text, s.path).length === 0) problems.push(`self-test: the planted bad sample "${s.path}" was NOT caught`);
  }
  for (const s of def.selfTest.good) {
    const h = def.scan(s.text, s.path);
    if (h.length) problems.push(`self-test: the good sample "${s.path}" was flagged: ${h[0].msg}`);
  }
  if (problems.length) {
    console.log(`FAIL ${def.name}: matcher is broken`);
    problems.forEach(p => console.log('   ' + p));
    return 1;
  }
  const allow = def.allow ?? {};
  for (const [k, reason] of Object.entries(allow)) if (!reason || reason.length < 10) problems.push(`allow-list entry ${k} has no reason`);
  const files = def.files();
  if (files.length === 0) problems.push('scanned no files: the file list is wrong');
  let n = problems.length;
  const lines = [...problems.map(p => '   ' + p)];
  for (const rel of files) {
    if (allow[rel]) continue;
    const hits = def.scan(read(rel), rel);
    for (const h of hits) { n++; lines.push(`   ${rel}${h.line ? ':' + h.line : ''}  ${h.msg}${h.text ? `\n      ${h.text}` : ''}`); }
  }
  console.log(`${n ? 'FAIL' : 'ok  '} ${def.name}: ${n ? `${n} violation${n === 1 ? '' : 's'}` : `${files.length} files clean`}${n ? ` (${def.rule})` : ''}`);
  if (n && !process.env.CHECK_QUIET) lines.forEach(l => console.log(l));
  return n;
}

/** Lets each check file run on its own: `node scripts/checks/no-confirm.mjs`. */
export function runIfMain(metaUrl, def) {
  if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(metaUrl)) process.exit(runCheck(def) ? 1 : 0);
}

/** src/ files a check applies to: the app's own code, not the design-token sources. */
export const srcFiles = () => walk('src');
