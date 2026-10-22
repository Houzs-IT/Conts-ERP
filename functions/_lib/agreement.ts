/** The management agreement generator (staff sheet UNIT, 17 Oct 2026: "our template agreement, fill in the details,
 *  contract auto-generated"). The template text lives in agreement_templates (migration 0125), one row per saved
 *  version, edited by management in Settings > Agreement template. {{placeholders}} are filled from the unit, its
 *  owner and the contract in force, and the result is a print-ready page (letterhead.ts) saved as PDF from the browser.
 *  A placeholder the template uses but the records do not have yet is reported as missing, and nothing is generated
 *  until it is filled in where it belongs (owner page, unit Details, Contract tab). */
import { type Env, one, all } from './db';
import { contractView } from './unitContract';
import { statementSettings, type Query } from './ownerStatement';
import { MODEL_LABEL, isShare, isTenancy } from './revenueModel';
import { CODE_LABEL } from './unitPurpose';
import { unitLayout } from './unitLayout';
import { companyDetails, longDate, ringgit, esc } from './letterhead';
import { hasColumn } from './auth';

export interface Placeholder { key: string; label: string; where: string; optional?: boolean }

/** Every placeholder a template may use; Settings lists them. `where` says where a missing value is filled in. */
export const PLACEHOLDERS: Placeholder[] = [
  { key: 'today', label: 'Date generated', where: '' },
  { key: 'company_name', label: 'Company legal name', where: 'Settings > Company details' },
  { key: 'company_number', label: 'Company registration number', where: 'Settings > Company details' },
  { key: 'company_address', label: 'Company address', where: 'Settings > Company details' },
  { key: 'owner_name', label: "Owner's legal name", where: "the owner's page" },
  { key: 'owner_ic', label: "Owner's IC or company number", where: "the owner's page" },
  { key: 'owner_address', label: "Owner's address", where: "the owner's page" },
  { key: 'owner_phone', label: "Owner's phone", where: "the owner's page", optional: true },
  { key: 'owner_email', label: "Owner's email", where: "the owner's page", optional: true },
  { key: 'unit_code', label: 'Unit code', where: "the unit's Details tab" },
  { key: 'building', label: 'Building', where: "the unit's Details tab" },
  { key: 'unit_address', label: 'Unit address', where: "the unit's Details tab" },
  { key: 'unit_layout', label: 'Layout (bedrooms, bathrooms)', where: "the unit's Details tab", optional: true },
  { key: 'model_code', label: 'Contract code (PS, PS GRR, ...)', where: "the unit's Contract tab" },
  { key: 'model_name', label: 'Contract type in words', where: "the unit's Contract tab" },
  { key: 'terms', label: 'Terms in short ("Share 75/25")', where: "the unit's Contract tab" },
  { key: 'owner_pct', label: "Owner's share %", where: "the unit's Contract tab" },
  { key: 'management_pct', label: 'Operator share %', where: "the unit's Contract tab" },
  { key: 'agent_pct', label: 'Agent share %', where: "the unit's Contract tab", optional: true },
  { key: 'guarantee', label: 'Guarantee (monthly or yearly)', where: "the unit's Contract tab" },
  { key: 'monthly_rent', label: 'Monthly rent', where: "the unit's Contract tab" },
  { key: 'deposit', label: 'Deposit', where: "the unit's Contract tab", optional: true },
  { key: 'start_date', label: 'Contract start date', where: "the unit's Contract tab" },
  { key: 'end_date', label: 'Contract end date', where: "the unit's Contract tab", optional: true },
  { key: 'renews_on', label: 'Renewal date', where: "the unit's Contract tab", optional: true },
  { key: 'bank_name', label: "Owner's bank", where: "the owner's page" },
  { key: 'bank_account', label: "Owner's bank account number", where: "the owner's page" },
  { key: 'account_holder', label: 'Account holder', where: "the owner's page" },
];
const BY_KEY = new Map(PLACEHOLDERS.map(p => [p.key, p]));
const NOT_APPLICABLE = 'Not applicable';

export const usedKeys = (body: string) => [...new Set([...body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map(m => m[1]))];

export interface Template { id: string; version: number; title: string; body: string; createdAt: string; createdBy: string | null }

export async function templatesReady(env: Env) { return hasColumn(env, 'agreement_templates', 'body').catch(() => false); }
export async function currentTemplate(env: Env): Promise<Template | null> {
  if (!(await templatesReady(env))) return null;
  const r = await one<any>(env, 'SELECT id, version, title, body, created_at, created_by_label FROM agreement_templates ORDER BY version DESC LIMIT 1');
  return r ? { id: r.id, version: Number(r.version), title: r.title, body: r.body, createdAt: r.created_at, createdBy: r.created_by_label ?? null } : null;
}

/** The values for one unit's agreement, and the placeholders the template uses that have no value yet. */
export async function agreementValues(env: Env, unitId: string, body: string): Promise<{ values: Record<string, string>; missing: { key: string; label: string; where: string }[]; contractId: string | null } | null> {
  const q: Query = (sql, ...args) => all(env, sql, ...args);
  const ownerAddr = await hasColumn(env, 'owners', 'address_lines').catch(() => false);
  const codeCol = await hasColumn(env, 'owner_contracts', 'contract_code').catch(() => false);
  const u = await one<any>(env, `
    SELECT u.id, u.unit_number, u.unit_code, u.address, u.bedrooms, u.bathrooms, u.layout_type, u.package, u.split_kind, u.split_value, u.misc_charges,
           p.name AS building, p.address_line, p.city, p.state, p.postcode,
           o.display_name, o.legal_name, o.ic_number, o.phone, o.email, o.bank_name, o.bank_account_number, o.bank_account_holder,
           ${ownerAddr ? 'o.address_lines, o.address_postcode, o.address_city, o.address_state, o.address_country,' : ''}
           c.id AS c_id, c.revenue_model, c.model, c.management_fee_pct, c.agent_fee_pct, c.agent_name, c.minimum_guarantee, c.minimum_guarantee_annual,
           c.grr_amount, c.deposit_amount, c.tenant_name, c.starts_on, c.ends_on, c.renews_on, c.guarantee_starts_on, c.guarantee_ends_on, c.misc_charges AS c_misc
           ${codeCol ? ', c.contract_code' : ''}
    FROM units u JOIN properties p ON p.id = u.property_id JOIN owners o ON o.id = u.owner_id
    LEFT JOIN owner_contracts c ON c.id = u.contract_id WHERE u.id = ?`, unitId);
  if (!u) return null;
  const [company, settings] = await Promise.all([companyDetails(env), statementSettings(q)]);
  const v = u.c_id ? contractView({ ...u, id: u.c_id, misc_charges: u.c_misc }, u, settings.defaultFeePct) : null;
  const pct = (n: number | null | undefined) => (n == null ? '' : `${Number(Number(n).toFixed(2))}%`);
  const ownerAddress = [u.address_lines, [u.address_postcode, u.address_city].filter(Boolean).join(' '), [u.address_state, u.address_country].filter(Boolean).join(', ')]
    .map((x: string | null | undefined) => (x ?? '').trim()).filter(Boolean).join(', ');
  const layout = unitLayout(u);
  const share = v ? isShare(v.revenueModel) : false;
  const values: Record<string, string> = {
    today: longDate(new Date().toISOString()),
    company_name: company.legalName, company_number: company.companyNumber, company_address: company.address.replace(/\n/g, ' '),
    owner_name: (u.legal_name || u.display_name || '').trim(), owner_ic: (u.ic_number ?? '').trim(), owner_address: ownerAddress,
    owner_phone: u.phone ?? '', owner_email: u.email ?? '',
    unit_code: (u.unit_code || u.unit_number || '').trim(), building: u.building ?? '',
    unit_address: (u.address || [u.unit_number, u.address_line, u.postcode, u.city, u.state].filter(Boolean).join(', ')).trim(),
    unit_layout: [layout.size, layout.layout].filter(Boolean).join(', '),
    model_code: v ? v.contractCode : '', model_name: v ? CODE_LABEL[v.contractCode] ?? MODEL_LABEL[v.revenueModel] : '', terms: v ? v.termsLabel : '',
    owner_pct: v ? (share ? pct(v.ownerPct) : NOT_APPLICABLE) : '',
    management_pct: v ? (share || isTenancy(v.revenueModel) ? pct(v.managementPct) : NOT_APPLICABLE) : '',
    agent_pct: v ? (share && v.agentPct ? pct(v.agentPct) : NOT_APPLICABLE) : '',
    guarantee: !v ? '' : v.revenueModel === 'management_guarantee' ? (v.minimumGuarantee ? `${ringgit(v.minimumGuarantee)} a month` : '')
      : v.revenueModel === 'management_yearly_guarantee' ? (v.yearlyGuarantee ? `${ringgit(v.yearlyGuarantee)} for each contract year` : '') : NOT_APPLICABLE,
    monthly_rent: !v ? '' : share ? NOT_APPLICABLE : v.monthlyRent ? `${ringgit(v.monthlyRent)} a month` : '',
    deposit: v?.deposit ? ringgit(v.deposit) : NOT_APPLICABLE,
    start_date: v?.startsOn ? longDate(String(v.startsOn).slice(0, 10)) : '',
    end_date: v?.endsOn ? longDate(String(v.endsOn).slice(0, 10)) : 'no fixed end date',
    renews_on: v?.renewsOn ? longDate(String(v.renewsOn).slice(0, 10)) : 'not set',
    bank_name: u.bank_name ?? '', bank_account: (u.bank_account_number ?? '').trim(), account_holder: (u.bank_account_holder || '').trim(),
  };
  const used = usedKeys(body);
  const missing = used.filter(k => BY_KEY.has(k) && !BY_KEY.get(k)!.optional && !values[k]).map(k => ({ key: k, label: BY_KEY.get(k)!.label, where: BY_KEY.get(k)!.where }));
  if (!u.c_id) missing.unshift({ key: 'contract', label: 'A contract for this unit', where: "the unit's Contract tab" });
  return { values, missing, contractId: u.c_id ?? null };
}

/** The template as print-ready markup: "# " lines are headings, blank lines split paragraphs, placeholders filled.
 *  Every value is escaped; an unknown placeholder is left visible so it is noticed. */
export function renderAgreement(body: string, values: Record<string, string>): string {
  const fill = (line: string) => esc(line).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k: string) => (k in values ? `<strong>${esc(values[k])}</strong>` : m));
  return body.replace(/\r\n/g, '\n').split(/\n{2,}/).map(block => {
    const lines = block.split('\n').filter(l => l.trim());
    if (!lines.length) return '';
    const head = lines[0].startsWith('# ') ? `<h2 class="ag-h">${fill(lines.shift()!.slice(2))}</h2>` : '';
    return `${head}${lines.length ? `<p class="ag-p">${lines.map(fill).join('<br />')}</p>` : ''}`;
  }).join('\n');
}
