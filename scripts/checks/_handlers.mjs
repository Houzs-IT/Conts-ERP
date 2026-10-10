// Helpers for the two server checks: find what a handler file exports and what the _lib functions it calls do.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, read } from './_lib.mjs';

export const handlerFiles = () => {
  const out = [];
  const visit = (d) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const rel = `${d}/${e.name}`;
      if (e.isDirectory()) visit(rel);
      else if (/\.ts$/.test(e.name) && e.name !== '_middleware.ts') out.push(rel);
    }
  };
  visit('functions/api');
  return out.sort();
};

/** The onRequest* names a file exports (onRequest, onRequestGet, onRequestPost ...). */
export const exportedHandlers = (text) => [...text.matchAll(/export\s+(?:const|async\s+function|function)\s+(onRequest\w*)/g)].map(m => m[1]);
export const MUTATING = new Set(['onRequestPost', 'onRequestPut', 'onRequestPatch', 'onRequestDelete']);

/** Imported names and the files they come from, resolved to repo-relative .ts paths. */
export function imports(text, rel) {
  const out = [];
  for (const m of text.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
    const file = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[2])) + '.ts';
    for (const part of m[1].split(',')) {
      const [orig, alias] = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/);
      if (orig) out.push({ name: alias ?? orig, orig, file });
    }
  }
  return out;
}

/** The body of a top-level function or const arrow in `text`, up to the next top-level declaration. */
export function bodyOf(text, name) {
  const re = new RegExp(`^(?:export\\s+)?(?:async\\s+)?(?:function\\s+${name}\\b|const\\s+${name}\\b)`, 'm');
  const m = re.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const end = rest.search(/\n(?:export\s|async\s+function\s|function\s|const\s|let\s|type\s|interface\s)/);
  return end < 0 ? rest : rest.slice(0, end);
}

const cache = new Map();
/**
 * True when calling `name` (imported into `rel`) reaches a call matching `re`, following other functions of the same
 * file and imports one level at a time (depth-limited). This is how a handler that hands its work to a _lib function
 * is credited with that function's requireSession / audit.
 */
export function reaches(rel, name, re, depth = 3) {
  const key = `${rel}#${name}#${re.source}#${depth}`;
  if (cache.has(key)) return cache.get(key);
  cache.set(key, false);
  let ok = false;
  const imp = imports(fs.existsSync(path.join(ROOT, rel)) ? read(rel) : '', rel).find(i => i.name === name);
  if (imp && fs.existsSync(path.join(ROOT, imp.file))) ok = defines(imp.file, imp.orig, re, depth);
  cache.set(key, ok);
  return ok;
}

function defines(file, name, re, depth) {
  const text = read(file);
  const body = bodyOf(text, name);
  if (body === null) {
    // Re-exported (export { x } from './y'), follow it.
    return depth > 0 && reaches(file, name, re, depth - 1);
  }
  if (re.test(body)) return true;
  if (depth <= 0) return false;
  for (const call of new Set([...body.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)].map(m => m[1]))) {
    if (call === name) continue;
    if (bodyOf(text, call) !== null && defines(file, call, re, depth - 1)) return true;
    if (reaches(file, call, re, depth - 1)) return true;
  }
  return false;
}

/** True when the handler text itself, or a function it calls, reaches `re`. */
export function handlerReaches(text, rel, re) {
  if (re.test(text)) return true;
  const local = new Set(imports(text, rel).map(i => i.name));
  for (const call of new Set([...text.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)].map(m => m[1]))) {
    if (local.has(call) && reaches(rel, call, re)) return true;
    if (bodyOf(text, call) !== null && !/^onRequest/.test(call) && re.test(bodyOf(text, call))) return true;
  }
  // A handler that re-exports another file's handler (`import { onRequestGet as x } from '../pdf'`).
  for (const i of imports(text, rel)) {
    if (/^onRequest/.test(i.orig) && fs.existsSync(path.join(ROOT, i.file)) && handlerReaches(read(i.file), i.file, re)) return true;
  }
  return false;
}
