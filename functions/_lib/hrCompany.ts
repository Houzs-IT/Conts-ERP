import { type Env } from './db';
import { hasColumn } from './auth';

export const HR_COMPANIES = ['conts', 'dream_crafter'] as const;
export type HrCompany = (typeof HR_COMPANIES)[number];

const hasEmployeeCompany = (env: Env): Promise<boolean> => hasColumn(env, 'employees', 'company').catch(() => false);
const hasDreamCrafterRecords = (env: Env): Promise<boolean> => hasColumn(env, 'employees', 'dc_staff_id').catch(() => false);

async function companyCondition(env: Env, company: HrCompany): Promise<string> {
  if (await hasEmployeeCompany(env)) return `company = '${company}'`;
  if (await hasDreamCrafterRecords(env)) return company === 'conts' ? 'dc_staff_id IS NULL' : 'dc_staff_id IS NOT NULL';
  return company === 'conts' ? 'true' : 'false';
}

export async function employeeOfCompanySql(env: Env, company: HrCompany, employeeIdColumn: string): Promise<string> {
  return ` AND ${employeeIdColumn} IN (SELECT id FROM employees WHERE ${await companyCondition(env, company)})`;
}
