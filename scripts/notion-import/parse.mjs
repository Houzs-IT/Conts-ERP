// Parsers for Notion "Markdown & CSV" export cells. Pure functions, no I/O.
import crypto from "node:crypto";

/** RFC 4180 CSV (quoted fields, doubled quotes, CRLF or LF) -> array of objects keyed by header. */
export function parseCsv(text) {
  const src = String(text).replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const header = (rows.shift() ?? []).map((h) => h.trim());
  return rows
    .filter((r) => r.length > 1 || r[0] !== "")
    .map((r) => Object.fromEntries(header.map((h, j) => [h, r[j] ?? ""])));
}

/** Column lookup tolerant of the emoji / trailing spaces Notion puts in headers ("Project 🔥", "TOTAL "). */
export function col(row, name) {
  if (name in row) return row[name];
  const want = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const k of Object.keys(row)) if (k.toLowerCase().replace(/[^a-z0-9]/g, "") === want) return row[k];
  return "";
}

/** Notion page ids are 32 hex characters at the end of the page URL slug. */
export function pageIdOf(url) {
  const m = /([0-9a-f]{32})(?:[?#)]|$)/.exec(String(url ?? ""));
  return m ? m[1] : null;
}

/** A relation cell: "Title (https://app.notion.com/p/Slug-<id>?pvs=21), Title 2 (...)" -> [{ title, id }]. */
export function parseRelation(cell) {
  const s = String(cell ?? "");
  const out = [];
  const re = /\s*(.*?)\s*\((https?:\/\/[^\s)]*notion[^\s)]*)\)\s*(?:,|$)/gy;
  let i = 0;
  while (i < s.length) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) break;
    out.push({ title: m[1].trim(), id: pageIdOf(m[2]) });
    if (re.lastIndex === i) break;
    i = re.lastIndex;
  }
  return out;
}

/** People / multi-select cell: "A, B" -> ["A", "B"]. */
export function splitList(cell) {
  return String(cell ?? "").split(",").map((x) => x.trim()).filter(Boolean);
}

/** Files cell: comma separated file names and URLs. A comma inside a URL query is kept with its URL. */
export function splitFiles(cell) {
  const parts = String(cell ?? "").split(/,\s+/).map((x) => x.trim()).filter(Boolean);
  return parts.map((p) => ({ value: p, isUrl: /^https?:\/\//i.test(p) }));
}

/** Title normal form for matching: no tick marks, single spaces, upper case, curly quotes straightened. */
export function normTitle(s) {
  return String(s ?? "")
    .replace(/✅/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const pad = (n) => String(n).padStart(2, "0");

function validYmd(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** One Notion date: "31/01/2026" (dd/mm/yyyy) or "October 25, 2025" (optionally with a time). -> "YYYY-MM-DD" | null. */
export function parseDate(s) {
  const t = String(s ?? "").trim();
  if (!t) return null;
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return validYmd(+m[3], +m[2], +m[1]);
  m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?$/i.exec(t);
  if (m && MONTHS[m[1].toLowerCase()]) return validYmd(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  return null;
}

/** A date or range cell "26/09/2025 → 30/09/2025" -> { start, end, ok }. A single date is start = end. */
export function parseDateRange(s) {
  const t = String(s ?? "").trim();
  if (!t) return { start: null, end: null, ok: true };
  const parts = t.split(/\s*(?:→|->)\s*/);
  const start = parseDate(parts[0]);
  const end = parts.length > 1 ? parseDate(parts[1]) : start;
  if (!start || !end) return { start: null, end: null, ok: false };
  return end < start ? { start: end, end: start, ok: true } : { start, end, ok: true };
}

/** Notion "Created time" ("September 12, 2025 12:48 PM", Malaysia time) -> ISO timestamp with +08:00. */
export function parseCreatedTime(s) {
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(s ?? "").trim());
  if (!m) return null;
  const day = validYmd(+m[3], MONTHS[m[1].toLowerCase()] ?? 0, +m[2]);
  if (!day) return null;
  let h = +m[4] % 12;
  if (m[6].toUpperCase() === "PM") h += 12;
  return `${day}T${pad(h)}:${m[5]}:00+08:00`;
}

/** "MYR 36,756.32" / "RM16,706.00" / "8000" -> sen (integer) | null. */
export function parseMoneySen(s) {
  const t = String(s ?? "").replace(/\b(MYR|RM)\b/gi, "").replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}

export const yesNo = (s) => String(s ?? "").trim().toLowerCase() === "yes";

const HONORIFIC = /\b(MR|MS|MRS|MDM|MISS|DR|DATO|DATIN)\b\.?/;
const UNIT = /^(?:[A-Z]{1,2}\d{0,2}[A-Z]?-?)?\d{1,3}[A-Z]?(?:-\d{1,3}[A-Z]?){1,2}$|^NO\.\s?\d+[A-Z]?$/;

/** "BARON C-20-08 MR ALBERT" -> { unitNo: "C-20-08", customerName: "MR ALBERT" }. Customer = from the first
    honorific on, else what follows the unit; brackets around it are dropped. Text is kept as the title has it. */
export function parseTitle(title) {
  const t = String(title ?? "").replace(/\s+/g, " ").trim().replace(/^SO\s*-\s*/i, "");
  const tokens = t.split(" ");
  let unitIdx = -1;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i].replace(/[(),]/g, "");
    if (UNIT.test(tok.toUpperCase())) { unitIdx = i; break; }
    if (/^NO\.$/i.test(tok) && tokens[i + 1] && /^\d+[A-Z]?,?$/i.test(tokens[i + 1])) { unitIdx = i; tokens.splice(i, 2, `${tok}${tokens[i + 1].replace(/,$/, "")}`); break; }
  }
  const unitNo = unitIdx >= 0 ? tokens[unitIdx].replace(/[(),]/g, "") : null;
  const upper = t.toUpperCase();
  const h = HONORIFIC.exec(upper);
  let customer = null;
  if (h) customer = t.slice(h.index);
  else if (unitIdx >= 0 && unitIdx < tokens.length - 1) customer = tokens.slice(unitIdx + 1).join(" ");
  if (customer) {
    const opens = () => (customer.match(/\(/g) ?? []).length;
    const closes = () => (customer.match(/\)/g) ?? []).length;
    customer = customer.replace(/^[\s,]+/, "").replace(/[\s,]+$/, "");
    // a bracket left over from "( MR NG )" once the name was cut out of it
    while (closes() > opens() && /\)\s*$/.test(customer)) customer = customer.replace(/\s*\)\s*$/, "");
    while (opens() > closes() && /^\s*\(/.test(customer)) customer = customer.replace(/^\s*\(\s*/, "");
    customer = customer.trim() || null;
  }
  return { unitNo, customerName: customer };
}

/** Short stable hash used when a row has no Notion page id in the export. */
export function stableHash(...parts) {
  return crypto.createHash("sha1").update(parts.map((p) => String(p ?? "")).join("␟")).digest("hex").slice(0, 16);
}

/** YYMM of a YYYY-MM-DD date. */
export const yymmOf = (ymd) => `${ymd.slice(2, 4)}${ymd.slice(5, 7)}`;
