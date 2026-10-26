import { z } from 'zod';

/**
 * The employee record's fields (migration 0162, PLAN-hr-employees.md), ported from Hookka's Employee Master. No database
 * code here: the Employees tab imports this too, so the form and the API use the same lists and the same rules.
 */

/** Malaysian banks, a fixed list (Hookka, owner 1 Aug 2026): a bank typed two ways is how a payment file gets rejected. */
export const MALAYSIAN_BANKS = [
  'Maybank', 'CIMB Bank', 'Public Bank', 'RHB Bank', 'Hong Leong Bank', 'AmBank', 'Bank Islam', 'OCBC Bank', 'UOB Bank',
  'HSBC Bank', 'Affin Bank', 'Alliance Bank', 'Bank Simpanan Nasional', 'Bank Rakyat', 'Agrobank', 'MBSB Bank',
  'Standard Chartered', 'Citibank',
] as const;

export const PAYMENT_METHODS = ['transfer', 'cash'] as const;
export const PAY_BASES = ['monthly', 'daily'] as const;
export const TAX_RESIDENCIES = ['resident', 'non_resident'] as const;
/** LHDN's three MTD categories. Single and "married, spouse working" give the same PCB but are different declarations. */
export const TAX_CATEGORIES = ['single', 'married_spouse_not_working', 'married_spouse_working'] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type PayBasis = (typeof PAY_BASES)[number];
export type TaxResidency = (typeof TAX_RESIDENCIES)[number];
export type TaxCategory = (typeof TAX_CATEGORIES)[number];
export type Bank = (typeof MALAYSIAN_BANKS)[number];
export type EmployeeStatus = 'active' | 'resigned';

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = { transfer: 'Bank transfer', cash: 'Cash' };
export const PAY_BASIS_LABEL: Record<PayBasis, string> = { monthly: 'Monthly salary', daily: 'Daily rate' };
export const TAX_RESIDENCY_LABEL: Record<TaxResidency, string> = { resident: 'Resident', non_resident: 'Non-resident' };
export const TAX_CATEGORY_LABEL: Record<TaxCategory, string> = {
  single: 'Single', married_spouse_not_working: 'Married, spouse not working', married_spouse_working: 'Married, spouse working',
};

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date.');
const text = (max: number) => z.string().trim().max(max).transform(v => v || null).nullable();
const sen = z.int().min(0).max(100_000_000);

/** What the Employees form saves. Every field is the whole value, not a change. */
export const employeeInput = z.object({
  icNumber: text(20),
  passportNumber: text(20),
  nationality: text(40),
  joinDate: day.nullable(),
  status: z.enum(['active', 'resigned']),
  resignedAt: day.nullable(),
  payBasis: z.enum(PAY_BASES),
  basicSalarySen: sen,
  dailyRateSen: sen,
  workingDaysPerMonth: z.int().min(1).max(31),
  workingHoursPerDay: z.number().gt(0).max(24),
  otMultiplier: z.number().min(1).max(5),
  paymentMethod: z.enum(PAYMENT_METHODS),
  bankName: z.enum(MALAYSIAN_BANKS).nullable(),
  bankAccount: z.string().trim().regex(/^[0-9 -]{0,30}$/, 'Digits only.').transform(v => v.replace(/\D/g, '') || null).nullable(),
  epfEnabled: z.boolean(),
  socsoEnabled: z.boolean(),
  eisEnabled: z.boolean(),
  pcbEnabled: z.boolean(),
  taxResidency: z.enum(TAX_RESIDENCIES).nullable(),
  taxCategory: z.enum(TAX_CATEGORIES).nullable(),
  taxChildReliefSen: sen.nullable(),
  annualLeaveDays: z.int().min(0).max(60).nullable(),
  medicalLeaveDays: z.int().min(0).max(60).nullable(),
}).refine(e => e.status === 'active' || !!e.resignedAt, { path: ['resignedAt'], message: 'Give the last working day.' });
export type EmployeeInput = z.infer<typeof employeeInput>;

/** One person on the Employees tab: the roster entry, and the HR record (defaults until it is first saved). */
export interface Employee extends EmployeeInput {
  /** The HR record's id; null until it is first saved. */
  id: string | null;
  cleanerId: string | null;
  technicianId: string | null;
  name: string;
  phone: string | null;
  /** EMP-001, from the login "Give app access" made; null without app access. */
  employeeId: string | null;
  /** The roster entry is switched on. */
  isActive: boolean;
}

/** The record a person starts with before anyone saves one. Matches the column defaults in migration 0162. */
export const EMPLOYEE_DEFAULTS: EmployeeInput = {
  icNumber: null, passportNumber: null, nationality: null, joinDate: null, status: 'active', resignedAt: null,
  payBasis: 'monthly', basicSalarySen: 0, dailyRateSen: 0, workingDaysPerMonth: 26, workingHoursPerDay: 8, otMultiplier: 1.5,
  paymentMethod: 'transfer', bankName: null, bankAccount: null,
  epfEnabled: false, socsoEnabled: false, eisEnabled: false, pcbEnabled: false,
  taxResidency: null, taxCategory: null, taxChildReliefSen: null, annualLeaveDays: null, medicalLeaveDays: null,
};
