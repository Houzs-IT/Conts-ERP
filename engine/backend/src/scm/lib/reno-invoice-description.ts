// The renovation invoice's one line (plan 2026-10-30-renovation-einvoice-ready.md Task 4; spec goal 6): finance's
// template from the e-invoice settings, e.g. chew's "1st Progress Billing for Interior Design & Renovation Works (15%
// Deposit & Design Fee as per Sales Order, refer to attached breakdown)". Placeholders: {ordinal} {seq} {pct} {label}
// {so}. An e-invoice line description is at most 300 characters, so a long instalment label is shortened, never the
// template's own words.
import { DEFAULT_RENO_DESCRIPTION } from '../../acc/einvoice-settings';
import { MAX_DESCRIPTION } from '../../acc/einvoice-build';

export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

const pctOf = (bp: number): string => `${Number((bp / 100).toFixed(2))}%`;

export function renderRenoDescription(tpl: string | null, v: { seq: number; pctBp: number; label: string; soDocNo: string }): string {
  const template = tpl && tpl.trim() ? tpl.trim() : DEFAULT_RENO_DESCRIPTION;
  const fill = (label: string) => template
    .replace(/\{ordinal\}/g, ordinal(v.seq)).replace(/\{seq\}/g, String(v.seq)).replace(/\{pct\}/g, pctOf(v.pctBp))
    .replace(/\{so\}/g, v.soDocNo).replace(/\{label\}/g, label)
    .replace(/\s+/g, ' ').replace(/\(\s/g, '(').replace(/\s\)/g, ')').trim();
  const label = v.label.trim();
  let out = fill(label);
  if (out.length > MAX_DESCRIPTION && label && template.includes('{label}')) {
    const keep = label.length - (out.length - MAX_DESCRIPTION) - 1;
    if (keep > 0) out = fill(`${label.slice(0, keep).trimEnd()}…`);
  }
  return out.length > MAX_DESCRIPTION ? `${out.slice(0, MAX_DESCRIPTION - 1)}…` : out;
}
