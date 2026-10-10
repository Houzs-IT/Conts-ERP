import { type Env, all, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { checkPhone } from '../../_lib/validate';

const MANAGE = ['management'];

type Field = { def: string | number | boolean; legacy?: string; kind: 'text' | 'longtext' | 'email' | 'phone' | 'choice' | 'number' | 'bool' | 'time'; min?: number; max?: number; integer?: boolean; options?: string[]; required?: boolean };

/** Every setting, its default, and how to check a saved value. Stored as one row per setting, keyed "section.name". */
const SPEC: Record<string, Record<string, Field>> = {
  company: {
    legalName: { def: 'The Conts Sdn Bhd', legacy: 'org.legal_name', kind: 'text', required: true },
    companyNumber: { def: '202301027399 (1521322-V)', legacy: 'org.company_number', kind: 'text', required: true },
    address: { def: 'C-41-06, Jaya One, Jalan Universiti, 46200 Petaling Jaya', legacy: 'org.address', kind: 'text' },
    supportPhone: { def: '+60 17-465 8868', legacy: 'org.support_phone', kind: 'phone' },
    supportEmail: { def: 'support@theconts.com', kind: 'email' },
  },
  locale: {
    default: { def: 'en-MY', legacy: 'locale.default', kind: 'choice', options: ['en-MY', 'ms-MY', 'zh-Hans'] },
    timezone: { def: 'Asia/Kuala_Lumpur', legacy: 'locale.timezone', kind: 'choice', options: ['Asia/Kuala_Lumpur', 'Asia/Singapore', 'Asia/Bangkok', 'Asia/Jakarta'] },
    currency: { def: 'MYR', legacy: 'locale.currency', kind: 'choice', options: ['MYR', 'SGD', 'THB', 'IDR'] },
    dateFormat: { def: 'D MMM YYYY', kind: 'text' },
    managementFeePct: { def: 25, legacy: 'finance.default_fee_pct', kind: 'number', min: 0, max: 100 },
  },
  operations: {
    checkIn: { def: '15:00', legacy: 'ops.check_in', kind: 'time' },
    checkOut: { def: '11:00', legacy: 'ops.check_out', kind: 'time' },
    cleaningWindowHours: { def: 4, legacy: 'ops.turnover_sla_hours', kind: 'number', min: 1, max: 24, integer: true },
    linenSets: { def: 2, kind: 'number', min: 1, max: 10, integer: true },
    photoRequiredToMarkReady: { def: true, legacy: 'ops.photo_required', kind: 'bool' },
    // Sen. A repair the owner pays above this waits for the owner's approval (functions/_lib/maintenance.ts).
    maintenanceApprovalThreshold: { def: 30000, kind: 'number', min: 0, max: 10_000_000, integer: true },
    // Sen. What a clean costs a unit with no price of its own (functions/_lib/cleaning.ts cleanPrice).
    cleaningPriceStandard: { def: 8000, kind: 'number', min: 0, max: 1_000_000, integer: true },
    cleaningPriceDeep: { def: 13800, kind: 'number', min: 0, max: 1_000_000, integer: true },
  },
  statements: {
    cycleDay: { def: 1, kind: 'number', min: 1, max: 28, integer: true },
    autoGenerate: { def: true, kind: 'bool' },
    payoutMethod: { def: 'bank_transfer', kind: 'text' },
  },
  // The Owner Income Report (functions/_lib/ownerReport.ts) and statement generation (miscChargeMonthly, sen,
  // deducted each month from units whose contract has miscellaneous charges). Terms are one per line.
  report: {
    paymentTerms: { def: '7th every month', kind: 'text', required: true },
    monthlyTerms: { def: '', kind: 'longtext' },
    yearTerms: { def: '', kind: 'longtext' },
    miscChargeMonthly: { def: 10000, kind: 'number', min: 0, max: 10_000_000, integer: true },
  },
  security: {
    // Staff stay signed in through a normal work week; the owner portal is a brief,
    // occasional check-in so it times out sooner — see functions/_lib/auth.ts securitySettings().
    staffInactivityTimeoutMins: { def: 10080, kind: 'number', min: 15, max: 43200 },
    ownerInactivityTimeoutMins: { def: 480, kind: 'number', min: 15, max: 43200 },
    absoluteTimeoutHours: { def: 720, kind: 'number', min: 1, max: 720 },
    lockoutAttempts: { def: 5, kind: 'number', min: 3, max: 20, integer: true },
    lockoutMinutes: { def: 15, kind: 'number', min: 1, max: 120, integer: true },
  },
};

function decode(f: Field, raw: string | undefined) {
  if (raw === undefined) return f.def;
  if (f.kind === 'number') { const n = Number(raw); return Number.isFinite(n) ? n : f.def; }
  if (f.kind === 'bool') return raw === 'true';
  return raw;
}

/** The first problem with one value, or null. */
function problem(f: Field, v: unknown): string | null {
  if (f.kind === 'number' && f.integer && !Number.isInteger(v)) return 'Enter a whole number.';
  if (f.kind === 'number') return typeof v === 'number' && Number.isFinite(v) && v >= (f.min ?? -Infinity) && v <= (f.max ?? Infinity) ? null : `Enter a number from ${f.min} to ${f.max}.`;
  if (f.kind === 'bool') return typeof v === 'boolean' ? null : 'Choose on or off.';
  if (typeof v !== 'string' || v.length > (f.kind === 'longtext' ? 4000 : 300)) return f.kind === 'longtext' ? 'Keep it under 4,000 characters.' : 'Enter text.';
  if (f.required && v.trim() === '') return 'This cannot be empty.';
  if (f.kind === 'choice') return f.options!.includes(v) ? null : 'Pick one of the options.';
  if (f.kind === 'time') return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? null : 'Enter a time as HH:MM.';
  if (f.kind === 'phone') { const fields: Record<string, string> = {}; checkPhone(fields, 'v', v); return fields.v ?? null; }
  if (f.kind === 'email') return v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? null : 'Enter a valid email or leave it blank.';
  return null;
}

/** GET /api/settings — the settings by section, with defaults for anything never saved. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Settings are visible to operations, finance and management.', 403);

  const rows = await all<{ key: string; value: string }>(env, 'SELECT key, value FROM settings');
  const map = new Map(rows.map(r => [r.key, r.value]));
  const out: Record<string, Record<string, unknown>> = {};
  for (const [section, fields] of Object.entries(SPEC)) {
    out[section] = {};
    for (const [name, f] of Object.entries(fields)) out[section][name] = decode(f, map.get(`${section}.${name}`) ?? (f.legacy ? map.get(f.legacy) : undefined));
  }
  return json({ generatedAt: nowIso(), ...out });
};

/** PUT /api/settings { section: { field: value } } — management only. Every field is checked; every change is audited. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MANAGE.includes(session.role)) return fail('FORBIDDEN', 'Only management can change organisation settings.', 403);

  const b = await request.json<Record<string, Record<string, unknown>>>().catch(() => null);
  if (!b || typeof b !== 'object') return fail('VALIDATION', 'Nothing to save.', 422);

  const writes: [string, string][] = [];
  const fields: Record<string, string> = {};
  for (const [section, values] of Object.entries(b)) {
    const spec = SPEC[section];
    if (!spec || typeof values !== 'object' || values === null) return fail('VALIDATION', `Unknown settings section "${section}".`, 422);
    for (const [name, v] of Object.entries(values)) {
      const key = `${section}.${name}`, f = spec[name];
      const bad = f ? problem(f, v) : 'Unknown setting.';
      if (bad) fields[key] = bad; else writes.push([key, String(v)]);
    }
  }
  if (Object.keys(fields).length) return fail('VALIDATION', 'Check the highlighted settings.', 422, fields);
  if (!writes.length) return fail('VALIDATION', 'Nothing to save.', 422);

  const now = nowIso();
  for (const [key, value] of writes) {
    await run(env, 'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', key, value, now);
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'settings.update', entityTable: 'settings', entityId: 'organisation', after: Object.fromEntries(writes) });
  return json({ ok: true, saved: writes.length });
};
