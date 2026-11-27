/**
 * AI Connector round 4d (owner, 26 Nov 2026, "加 全部一起做"): the morning brief email (D1), urgent alerts (D2), and the
 * weekly data gaps list inside the Monday brief (D4, the data_gaps tool that already exists). PURE: no database, no
 * network. mcpProactiveRun.ts reads AS THE PERSON (their own short-lived connector token, the same readValue path as a
 * question from Claude) and hands the replies here; mcpProactiveStore.ts keeps the opt-ins, the debounce ledger and
 * the send log.
 *
 *   D1  isBriefDue / pickTickWork   whose brief is due on this tick (opt-in time, Malaysia time, 15-minute ticks)
 *       buildBriefEmail             clean English HTML + plain text: each daily_brief section with its count and
 *                                   top 5, every line a link into the ERP; Monday adds the data gaps
 *   D2  computeAlerts               check-in within 3 hours with the unit not ready or no cleaner, maintenance newly
 *                                   overdue by more than N days, arrears newly past 30 days above a value (finance only)
 *       alertsToSend                the debounce: a key is never sent twice in a day, nor again inside its window
 *       buildAlertEmail             one email per tick with every new alert
 *
 * Every threshold lives in PROACTIVE_CONFIG (the AI Connector page shows it read-only). Money is integer sen; RM only
 * appears in words.
 */

type Obj = Record<string, unknown>;

/** The ONE place the thresholds live. Shown read-only on System > AI Connector. */
export const PROACTIVE_CONFIG = {
  /** Brief time offered by default (Malaysia time). Times are on the half hour; the check runs every 15 minutes. */
  briefDefaultTime: '08:00',
  /** A brief not sent within this many hours of its time (the check was down) is skipped for the day. */
  briefLateCutoffHours: 4,
  /** At most this many briefs are built on one tick; the rest go on the next tick. */
  maxBriefsPerTick: 10,
  /** The tick stops starting new people after this long (the rest wait for the next tick). */
  tickBudgetMs: 20_000,
  alerts: {
    /** A check-in alerts when the guest arrives within this many minutes and the unit is not ready or has no cleaner. */
    checkInWithinMinutes: 180,
    /** A maintenance job alerts once it is MORE than this many days past its due date. */
    maintenanceOverdueDays: 3,
    /** Money owed alerts once it is MORE than this many days old (guests: since check-in; invoices: past the due date). */
    arrearsDays: 30,
    /** ... and only from this amount (sen; RM 1,000). */
    arrearsMinSen: 100_000,
    /** "Newly" = at most this many days past the line (so a missed day still alerts once, and never again later). */
    newlyWindowDays: 2,
    /** Alerts are checked between these Malaysia hours (from inclusive, to exclusive). */
    hoursMyt: { from: 7, to: 20 },
    /** At most this many alert lines per email (the rest are counted). */
    maxLinesPerEmail: 10,
    /** At most this many people are checked on one tick (least recently checked first). */
    maxPeoplePerTick: 15,
    /** A person's alerts are not re-checked within this many minutes. */
    minGapMinutes: 25,
  },
} as const;

type AlertCfg = typeof PROACTIVE_CONFIG.alerts;
const alertCfg = (cfg: Partial<AlertCfg> = {}): AlertCfg => ({ ...PROACTIVE_CONFIG.alerts, ...cfg });

export type BriefDays = 'weekdays' | 'daily';
export interface Subscription { userId: string; briefEnabled: boolean; briefTime: string; briefDays: BriefDays; alertsEnabled: boolean }

/** Off by default: nobody gets an email until they turn it on themselves. */
export const DEFAULT_SUBSCRIPTION: Omit<Subscription, 'userId'> = {
  briefEnabled: false, briefTime: PROACTIVE_CONFIG.briefDefaultTime, briefDays: 'weekdays', alertsEnabled: false,
};

/* ---------- time (Malaysia, UTC+8, no daylight saving) ---------- */

export interface MytNow { day: string; hhmm: string; minutes: number; weekday: number }

/** Malaysia wall-clock parts. weekday: 0 = Sunday ... 6 = Saturday. */
export function mytNow(now: Date = new Date()): MytNow {
  const m = new Date(now.getTime() + 8 * 3600_000);
  const hh = m.getUTCHours(), mm = m.getUTCMinutes();
  return { day: m.toISOString().slice(0, 10), hhmm: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, minutes: hh * 60 + mm, weekday: m.getUTCDay() };
}

export function plusDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const dayDiff = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const ymd = (v: unknown): string => { const s = String(v ?? '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; };
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') as Obj[] : []);
const enc = encodeURIComponent;

/** The rows of a list reply, whatever its wrapper ({ data }, { rows }, { items }, { results } or a bare array). */
function rowsOf(body: unknown): Obj[] {
  if (Array.isArray(body)) return arr(body);
  const b = obj(body);
  for (const k of ['data', 'rows', 'items', 'results', 'issues', 'reservations']) {
    if (Array.isArray(b[k])) return arr(b[k]);
    if (b[k] && typeof b[k] === 'object') { const inner = rowsOf(b[k]); if (inner.length) return inner; }
  }
  return [];
}

/* ---------- opt-in (D1 / D2) ---------- */

const TIME_RE = /^([01]\d|2[0-3]):(00|30)$/;

/** The settings form -> a subscription, or the reason it is refused. Unknown keys are ignored. */
export function parseSubscriptionInput(body: unknown, userId: string): { ok: true; value: Subscription } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Send the settings as an object.' };
  const b = body as Obj;
  const bool = (k: string, dflt: boolean): boolean | null => (b[k] === undefined ? dflt : typeof b[k] === 'boolean' ? b[k] as boolean : null);
  const briefEnabled = bool('briefEnabled', DEFAULT_SUBSCRIPTION.briefEnabled);
  const alertsEnabled = bool('alertsEnabled', DEFAULT_SUBSCRIPTION.alertsEnabled);
  if (briefEnabled === null) return { ok: false, error: 'briefEnabled must be true or false.' };
  if (alertsEnabled === null) return { ok: false, error: 'alertsEnabled must be true or false.' };
  const briefTime = b.briefTime === undefined ? DEFAULT_SUBSCRIPTION.briefTime : str(b.briefTime);
  if (!TIME_RE.test(briefTime)) return { ok: false, error: 'Pick a time on the hour or half hour (Malaysia time), for example 08:00 or 07:30.' };
  const briefDays = b.briefDays === undefined ? DEFAULT_SUBSCRIPTION.briefDays : str(b.briefDays);
  if (briefDays !== 'weekdays' && briefDays !== 'daily') return { ok: false, error: 'Days must be weekdays or daily.' };
  return { ok: true, value: { userId, briefEnabled, briefTime, briefDays, alertsEnabled } };
}

/** A database row -> a subscription (snake_case or camelCase keys; integers or booleans). */
export function subscriptionFromRow(r: Obj): Subscription {
  const flag = (...k: string[]) => { for (const x of k) if (r[x] !== undefined && r[x] !== null) return r[x] === true || Number(r[x]) === 1; return false; };
  const time = str(r.brief_time ?? r.briefTime);
  return {
    userId: str(r.user_id ?? r.userId),
    briefEnabled: flag('brief_enabled', 'briefEnabled'),
    briefTime: TIME_RE.test(time) ? time : PROACTIVE_CONFIG.briefDefaultTime,
    briefDays: str(r.brief_days ?? r.briefDays) === 'daily' ? 'daily' : 'weekdays',
    alertsEnabled: flag('alerts_enabled', 'alertsEnabled'),
  };
}

/** Is the brief due on this tick? On, a day it is wanted, at or past its time but within briefLateCutoffHours. "Already
 *  sent today" is the store's job (one claimed key per person per day), not this function's. */
export function isBriefDue(sub: Subscription, now: MytNow, cutoffHours: number = PROACTIVE_CONFIG.briefLateCutoffHours): boolean {
  if (!sub.briefEnabled) return false;
  if (sub.briefDays === 'weekdays' && (now.weekday === 0 || now.weekday === 6)) return false;
  const m = TIME_RE.exec(sub.briefTime);
  if (!m) return false;
  const at = Number(m[1]) * 60 + Number(m[2]);
  return now.minutes >= at && now.minutes < at + cutoffHours * 60;
}

export function inAlertHours(now: MytNow, hours: { from: number; to: number } = PROACTIVE_CONFIG.alerts.hoursMyt): boolean {
  const h = Math.floor(now.minutes / 60);
  return h >= hours.from && h < hours.to;
}

/** Monday's brief carries the data gaps list (D4). */
export const isMonday = (now: MytNow): boolean => now.weekday === 1;

/** Who one tick serves: briefs due and not yet sent today (capped), and alert checks in working hours, least recently
 *  checked first, none checked in the last minGapMinutes (capped). Bounded per tick by construction. */
export function pickTickWork<T extends Subscription & { lastAlertCheckAt: string }>(subs: T[], now: MytNow, briefedToday: Set<string>, nowMs: number = Date.now()): { briefs: T[]; alerts: T[] } {
  const a = PROACTIVE_CONFIG.alerts;
  const briefs = subs.filter(s => isBriefDue(s, now) && !briefedToday.has(s.userId)).slice(0, PROACTIVE_CONFIG.maxBriefsPerTick);
  const alerts = inAlertHours(now)
    ? subs.filter(s => s.alertsEnabled)
      .filter(s => !s.lastAlertCheckAt || nowMs - Date.parse(s.lastAlertCheckAt) >= a.minGapMinutes * 60_000)
      .sort((x, y) => (x.lastAlertCheckAt || '').localeCompare(y.lastAlertCheckAt || ''))
      .slice(0, a.maxPeoplePerTick)
    : [];
  return { briefs, alerts };
}

/* ---------- alerts (D2) ---------- */

export type AlertKind = 'checkin' | 'maintenance' | 'arrears';
export interface Alert { key: string; kind: AlertKind; title: string; detail: string; link: string }

const rmWords = (sen: number) => `RM ${(Math.round(sen) / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A money figure only when the person was shown it: a hidden (removed / null) figure never passes a threshold. */
const visibleSen = (r: Obj, key: string): number | null => (key in r && r[key] !== null && r[key] !== undefined && Number.isFinite(Number(r[key])) ? Number(r[key]) : null);

/** The minutes until the guest arrives on a Dashboard "Check-in at risk" row: `minutesLeft` (structured, added for
 *  this round) or, from an older deploy, the "Due in N min" label. Null when it is not a check-in risk row. */
function minutesLeft(e: Obj): number | null {
  if (typeof e.minutesLeft === 'number' && Number.isFinite(e.minutesLeft)) return e.minutesLeft;
  const m = /^Due in (\d+) min$/.exec(str(e.slaLabel));
  return m ? Number(m[1]) : null;
}

export interface AlertInputs {
  today: string;
  origin: string;
  /** GET /api/dashboard/exceptions as the person (null = no access). Its "Check-in at risk" rows. */
  exceptions: unknown;
  /** GET /api/maintenance/issues?view=open as the person. */
  maintenance: unknown;
  /** Whether the person's Finance level is above No access (gateFor.level('finance')). False: no arrears alert at all. */
  canSeeFinance: boolean;
  /** GET /api/reservations?view=all&todo=unpaid as the person (guests owing, oldest first). */
  guestsOwing: unknown;
  /** GET /api/sales-invoices as the person. */
  invoices: unknown;
  cfg?: Partial<AlertCfg>;
}

/**
 * Today's alert candidates from the person's own reads. Nothing here widens what they see: a read they may not make
 * arrives as null and yields nothing, a money figure the ERP hid from them never counts as "above the threshold", and
 * arrears are only looked at for someone whose Finance level is above No access.
 */
export function computeAlerts(x: AlertInputs): Alert[] {
  const cfg = alertCfg(x.cfg);
  const out: Alert[] = [];
  /** Days past `date` when that is MORE than `line` days and at most `line + newlyWindowDays`; else 0. */
  const newlyPast = (date: string, line: number) => {
    if (!date) return 0;
    const late = dayDiff(date, x.today);
    return late > line && late <= line + cfg.newlyWindowDays ? late : 0;
  };

  // 1. Check-in within 3 hours, the unit not ready or nobody assigned (the Dashboard's "Check-in at risk").
  for (const e of arr(obj(x.exceptions).exceptions)) {
    if (!str(e.id).startsWith('risk-')) continue;
    const mins = minutesLeft(e);
    if (mins === null || mins <= 0 || mins > cfg.checkInWithinMinutes) continue;
    const ready = e.readiness === undefined ? false : str(e.readiness) === 'ready';
    const assigned = e.assigned === undefined ? !/no cleaner assigned/.test(str(e.detail)) : e.assigned === true;
    if (ready && assigned) continue;
    const taskId = str(obj(e.action).taskId) || str(e.id).slice(5);
    const why = [ready ? '' : `unit ${str(e.readiness).replace(/_/g, ' ') || 'not ready'}`, assigned ? '' : 'no cleaner assigned'].filter(Boolean).join(', ');
    out.push({
      key: `checkin:${taskId}`, kind: 'checkin',
      title: `Check-in at risk: ${str(e.unitLabel) || 'a unit'}`,
      detail: `guest arrives ${str(e.nextGuestAt) || `in ${mins} min`} · ${why}`,
      link: `${x.origin}/operations/cleaning?task=${enc(taskId)}`,
    });
  }

  // 2. Maintenance newly overdue by more than maintenanceOverdueDays.
  for (const r of rowsOf(x.maintenance)) {
    if (str(r.state) === 'resolved') continue;
    const late = newlyPast(ymd(r.dueOn), cfg.maintenanceOverdueDays);
    if (!late) continue;
    out.push({
      key: `maintenance:${str(r.id)}`, kind: 'maintenance',
      title: `Maintenance ${late} days overdue: ${str(r.title) || '(no title)'}`,
      detail: [`${str(r.propertyName)} ${str(r.unitNumber)}`.trim(), `due ${ymd(r.dueOn)}`, str(r.state).replace(/_/g, ' ')].filter(Boolean).join(' · '),
      link: `${x.origin}/operations/maintenance?id=${enc(str(r.id))}`,
    });
  }

  // 3. Arrears newly past 30 days above the value, for finance only.
  if (x.canSeeFinance) {
    for (const r of rowsOf(x.guestsOwing)) {
      const sen = visibleSen(r, 'outstanding');
      const late = newlyPast(ymd(r.checkIn), cfg.arrearsDays);
      if (!late || sen === null || sen < cfg.arrearsMinSen) continue;
      out.push({
        key: `arrears:res:${str(r.id)}`, kind: 'arrears',
        title: `Guest owes ${rmWords(sen)}: ${str(r.guestName) || str(r.externalRef) || 'a reservation'}`,
        detail: [`${str(r.propertyName)} ${str(r.unitNumber)}`.trim(), `checked in ${ymd(r.checkIn)} (${late} days ago)`, str(r.externalRef)].filter(Boolean).join(' · '),
        link: `${x.origin}/reservations/bookings?view=all&open=${enc(str(r.id))}`,
      });
    }
    for (const r of rowsOf(x.invoices)) {
      if (['PAID', 'CANCELLED'].includes(str(r.status))) continue;
      const sen = visibleSen(r, 'outstandingSen');
      const late = newlyPast(ymd(r.dueDate), cfg.arrearsDays);
      if (!late || sen === null || sen < cfg.arrearsMinSen) continue;
      out.push({
        key: `arrears:si:${str(r.id) || str(r.invoiceNumber)}`, kind: 'arrears',
        title: `Invoice ${str(r.invoiceNumber)} owes ${rmWords(sen)}: ${str(r.customerName) || '(no customer)'}`,
        detail: `due ${ymd(r.dueDate)} (${late} days overdue)`,
        link: `${x.origin}/sales/invoices`,
      });
    }
  }
  return out;
}

/** How far back a key counts as "already sent": a check-in once a day; a newly overdue job or debt once in its window. */
export function debounceDays(kind: AlertKind, cfg: Partial<AlertCfg> = {}): number {
  return kind === 'checkin' ? 1 : alertCfg(cfg).newlyWindowDays;
}

/** The debounce. `sent` = key -> the latest day it was sent to this person. A key sent today is always dropped (at most
 *  one email per key per person per day); a key sent within its window is dropped too. Duplicates collapse. */
export function alertsToSend(alerts: Alert[], sent: Map<string, string>, today: string, cfg: Partial<AlertCfg> = {}): Alert[] {
  const seen = new Set<string>();
  return alerts.filter(a => {
    if (seen.has(a.key)) return false;
    seen.add(a.key);
    const last = sent.get(a.key);
    return !last || dayDiff(last, today) >= Math.max(1, debounceDays(a.kind, cfg));
  });
}

/** The earliest day the debounce must look back to. */
export const debounceSince = (today: string, cfg: Partial<AlertCfg> = {}): string => plusDays(today, -Math.max(1, alertCfg(cfg).newlyWindowDays));

/* ---------- email HTML ---------- */

export function escapeHtml(s: unknown): string {
  return str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Only http(s) links are rendered as links; anything else becomes plain text. */
export const safeLink = (v: unknown): string => { const s = str(v); return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : ''; };

interface Section { title: string; count: number; note?: string; lines: { text: string; link: string }[]; more: number }

const FONT = 'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif';
// Email clients ignore the app's theme, so the email carries its own fixed colours (The Conts' ink and accent).
const C = { page: '#F5F5F3', card: '#FFFFFF', line: '#E6E6E1', ink: '#1F1F1C', muted: '#5F5F5A', accent: '#2F5D50', warnBg: '#FBF1DF', warnInk: '#7A5212', okBg: '#E8F3EC', okInk: '#1E6B3F' };

function sectionHtml(s: Section): string {
  const items = s.lines.map(l => {
    const href = safeLink(l.link);
    const t = escapeHtml(l.text);
    return `<li style="margin:0 0 6px 0">${href ? `<a href="${escapeHtml(href)}" style="color:${C.accent};text-decoration:underline">${t}</a>` : t}</li>`;
  }).join('');
  const more = s.more > 0 ? `<p style="margin:4px 0 0 0;color:${C.muted};font-size:13px">...and ${s.more} more.</p>` : '';
  const note = s.note ? `<p style="margin:2px 0 6px 0;color:${C.muted};font-size:12px">${escapeHtml(s.note)}</p>` : '';
  return `<tr><td style="padding:14px 20px;border-top:1px solid ${C.line}">
<h3 style="margin:0 0 4px 0;font-size:15px;color:${C.ink}">${escapeHtml(s.title)} <span style="display:inline-block;min-width:22px;padding:1px 8px;border-radius:10px;background:${s.count ? C.warnBg : C.okBg};color:${s.count ? C.warnInk : C.okInk};font-size:13px;text-align:center">${s.count}</span></h3>
${note}${s.lines.length ? `<ul style="margin:6px 0 0 18px;padding:0;font-size:14px;color:${C.ink}">${items}</ul>` : ''}${more}
</td></tr>`;
}

function shell(title: string, introHtml: string, body: string, footer: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;padding:0;background:${C.page}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};${FONT}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:${C.card};border:1px solid ${C.line};border-radius:12px;${FONT}">
<tr><td style="padding:20px 20px 8px 20px"><h2 style="margin:0;font-size:19px;color:${C.ink}">${escapeHtml(title)}</h2><p style="margin:6px 0 0 0;font-size:14px;color:${C.muted}">${introHtml}</p></td></tr>
${body}
<tr><td style="padding:16px 20px;border-top:1px solid ${C.line};font-size:12px;color:${C.muted}">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

function footerHtml(settingsUrl: string, unsubscribeUrl: string, why: string): string {
  const s = safeLink(settingsUrl), u = safeLink(unsubscribeUrl);
  return `${escapeHtml(why)} It shows only what your own ERP access lets you see.<br>${s ? `<a href="${escapeHtml(s)}" style="color:${C.accent}">Change the time or what you get</a> · ` : ''}${u ? `<a href="${escapeHtml(u)}" style="color:${C.accent}">Unsubscribe</a>` : ''}`;
}

function sectionsText(sections: Section[]): string {
  return sections.map(s => [`${s.title}: ${s.count}`, ...s.lines.map(l => `  - ${l.text}${safeLink(l.link) ? ` <${safeLink(l.link)}>` : ''}`), ...(s.more > 0 ? [`  ...and ${s.more} more.`] : [])].join('\n')).join('\n\n');
}

/** One daily_brief line in words: "title · detail · due". */
const briefLine = (l: Obj): string => [str(l.title), str(l.detail), str(l.due)].filter(Boolean).join(' · ');

/** daily_brief's sections (an array of { section, count, top, more }) as email sections. */
function briefSections(brief: Obj): Section[] {
  return arr(brief.sections).map(s => {
    const top = arr(s.top);
    const count = num(s.count);
    return { title: str(s.section) || 'Section', count, lines: top.slice(0, 5).map(l => ({ text: briefLine(l), link: str(l.link ?? l.url) })), more: Math.max(0, count - Math.min(top.length, 5)) };
  });
}

/** data_gaps' gaps (an array of { gap, count, examples, link }) as email sections; the examples link to the gap's page. */
function gapSections(gaps: Obj | null | undefined): Section[] {
  return arr(obj(gaps).gaps).map(g => {
    const ex = Array.isArray(g.examples) ? (g.examples as unknown[]).map(str).filter(Boolean) : [];
    const count = num(g.count);
    return { title: str(g.gap) || 'Gap', count, lines: ex.slice(0, 5).map(t => ({ text: t, link: str(g.link) })), more: Math.max(0, count - Math.min(ex.length, 5)) };
  }).filter(s => s.count > 0);
}

export interface BriefEmailInputs {
  /** daily_brief's answer, as the person. */
  brief: Obj;
  /** data_gaps' answer: Monday, the test brief, or a preview that asks for it. */
  gaps?: Obj | null;
  name: string;
  date: string;
  settingsUrl: string;
  unsubscribeUrl: string;
  test?: boolean;
}

/** D1: the morning brief email. Clean English HTML + a plain-text part. */
export function buildBriefEmail(x: BriefEmailInputs): { subject: string; html: string; text: string; items: number } {
  const sections = briefSections(x.brief);
  const items = sections.reduce((t, s) => t + s.count, 0);
  const notes = [x.brief.noAccess, x.brief.notCovered, x.brief.mailCenter].map(str).filter(Boolean);
  if (Array.isArray(x.brief.couldNotRead) && x.brief.couldNotRead.length) notes.push(`Could not be read just now: ${(x.brief.couldNotRead as unknown[]).map(str).join(', ')}.`);
  const gaps = x.gaps ? gapSections(x.gaps) : [];
  const first = (x.name || '').trim().split(/\s+/)[0] || 'there';
  const dayWords = new Date(`${x.date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const s = items === 1 ? '' : 's';
  const subject = `${x.test ? '[Test] ' : ''}Your Conts morning brief: ${items} item${s} · ${x.date}`;
  const intro = `Good morning, ${escapeHtml(first)}. ${escapeHtml(dayWords)}: ${items ? `<b>${items}</b> item${s} need${items === 1 ? 's' : ''} a look.` : 'nothing needs a look today.'}`;
  let body = sections.length ? sections.map(sectionHtml).join('\n')
    : `<tr><td style="padding:14px 20px;border-top:1px solid ${C.line};font-size:14px;color:${C.muted}">Nothing overdue or due in the next 3 days, and nothing waiting for you.</td></tr>`;
  if (notes.length) body += `\n<tr><td style="padding:10px 20px;border-top:1px solid ${C.line};font-size:12px;color:${C.muted}">${notes.map(escapeHtml).join('<br>')}</td></tr>`;
  if (x.gaps) {
    body += `\n<tr><td style="padding:18px 20px 4px 20px;border-top:2px solid ${C.line}"><h2 style="margin:0;font-size:17px;color:${C.ink}">Data gaps to fill</h2><p style="margin:4px 0 0 0;font-size:13px;color:${C.muted}">Records missing something the ERP needs to work out money or plan work.</p></td></tr>\n`
      + (gaps.length ? gaps.map(sectionHtml).join('\n') : `<tr><td style="padding:10px 20px;font-size:14px;color:${C.muted}">Nothing missing in the lists you can open.</td></tr>`);
  }
  const why = x.test ? 'A test brief you asked for on System > AI Connector.' : 'You get this because you turned on the morning brief on System > AI Connector.';
  const html = shell(`${x.test ? '[Test] ' : ''}Morning brief`, intro, body, footerHtml(x.settingsUrl, x.unsubscribeUrl, why));
  const text = [
    `Good morning, ${first}. ${dayWords}: ${items} item${s} need${items === 1 ? 's' : ''} a look.`, '',
    sections.length ? sectionsText(sections) : 'Nothing overdue or due in the next 3 days, and nothing waiting for you.',
    notes.length ? `\n${notes.join('\n')}` : '',
    x.gaps ? `\nDATA GAPS TO FILL\n\n${gaps.length ? sectionsText(gaps) : 'Nothing missing in the lists you can open.'}` : '',
    '', `Change the time or what you get: ${safeLink(x.settingsUrl)}`, `Unsubscribe: ${safeLink(x.unsubscribeUrl)}`,
  ].join('\n');
  return { subject, html, text, items };
}

const ALERT_TITLES: Record<AlertKind, string> = {
  checkin: 'Check-ins at risk (next 3 hours)',
  maintenance: 'Maintenance newly overdue',
  arrears: 'Money owed newly past 30 days',
};

/** D2: one email with every new alert of this tick, grouped by kind, at most maxLinesPerEmail lines. */
export function buildAlertEmail(x: { alerts: Alert[]; date: string; settingsUrl: string; unsubscribeUrl: string; maxLines?: number }): { subject: string; html: string; text: string } {
  let budget = x.maxLines ?? PROACTIVE_CONFIG.alerts.maxLinesPerEmail;
  const sections: Section[] = [];
  for (const k of ['checkin', 'maintenance', 'arrears'] as AlertKind[]) {
    const list = x.alerts.filter(a => a.kind === k);
    if (!list.length) continue;
    const shown = list.slice(0, Math.max(0, budget));
    budget -= shown.length;
    sections.push({ title: ALERT_TITLES[k], count: list.length, lines: shown.map(a => ({ text: `${a.title} (${a.detail})`, link: a.link })), more: list.length - shown.length });
  }
  const n = x.alerts.length;
  const subject = `Conts alert: ${n} new item${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} attention`;
  const intro = `These became urgent since the last check (${escapeHtml(x.date)}). Each one is sent to you once.`;
  const footer = footerHtml(x.settingsUrl, x.unsubscribeUrl, 'You get this because you turned on urgent alerts on System > AI Connector.');
  return {
    subject,
    html: shell('Urgent alerts', intro, sections.map(sectionHtml).join('\n'), footer),
    text: [`These became urgent since the last check (${x.date}). Each one is sent to you once.`, '', sectionsText(sections), '', `Settings: ${safeLink(x.settingsUrl)}`, `Unsubscribe: ${safeLink(x.unsubscribeUrl)}`].join('\n'),
  };
}

/** The rule table the settings section shows (read-only). */
export function thresholdsForDisplay(): { label: string; value: string }[] {
  const a = PROACTIVE_CONFIG.alerts;
  return [
    { label: 'Check-in at risk', value: `the guest arrives within ${a.checkInWithinMinutes / 60} hours and the unit is not ready or has no cleaner (the Dashboard's "Check-in at risk")` },
    { label: 'Maintenance newly overdue', value: `more than ${a.maintenanceOverdueDays} days past its due date (alerted once, up to ${a.newlyWindowDays} days after that)` },
    { label: 'Money owed newly past 30 days', value: `${rmWords(a.arrearsMinSen)} or more, more than ${a.arrearsDays} days since check-in (guests) or past the due date (invoices); only for people with Finance access` },
    { label: 'When alerts are checked', value: `every 15 minutes, ${a.hoursMyt.from}:00 to ${a.hoursMyt.to}:00 Malaysia time; each person at most every ${a.minGapMinutes + 5} minutes` },
    { label: 'Each alert', value: 'emailed to you once (never twice in a day)' },
    { label: 'Amounts you cannot see', value: 'an amount your access hides is never alerted on' },
  ];
}
