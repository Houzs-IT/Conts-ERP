/* Pay on a PO schedule is one press (owner, 7 Nov 2026): it records, and the voucher and journal are made behind it. Nobody
   attaches anything. The voucher pays the supplier's own control from the default bank and goes through every door a voucher
   does, the same "Post now" finance uses, carrying the three keys for this one purpose only. Money was recorded before this
   runs, so a refusal here (the ledger not open, the bank's voucher letter not set) never undoes the press: it is answered,
   and the voucher stays a draft for finance. */

import type { Context } from 'hono';
import { apControlOf, resolveRoles, type RoleCodes } from '../../acc/rules';
import { activeCompanyId } from './companyScope';

/* eslint-disable @typescript-eslint/no-explicit-any -- the same loosely typed client as payment-vouchers.ts */

export interface PoPaymentFacts {
  paidOn: string; amountSen: number; label: string; poNumber: string; projectId: number | null;
  supplier: { id: string; name: string; code: string | null; control_account: string | null };
}

const KEYS = ['scm.payment_voucher.write', 'scm.payment_voucher.check', 'scm.payment_voucher.approve', 'scm.payment_voucher.post'];

/** What the voucher says: Dr the supplier's control, Cr the default bank. */
export function voucherBody(p: PoPaymentFacts, roles: RoleCodes): Record<string, unknown> {
  const description = `${p.poNumber} ${p.label}`;
  return {
    payeeName: p.supplier.name, supplierId: p.supplier.id, purpose: 'SUPPLIER_PAYMENT', creditAccountCode: roles.BANK_DEFAULT, voucherDate: p.paidOn, projectId: p.projectId,
    notes: description, lines: [{ debitAccountCode: apControlOf(roles, p.supplier), amountSen: p.amountSen, description }],
  };
}

/** The request as one holding the voucher keys, for the steps of this voucher. */
export function withVoucherKeys(c: any, pvId: string): any {
  const hu = c.get('houzsUser');
  const req = new Proxy(c.req, { get(t, k) {
    if (k === 'param') return (n: string) => (n === 'id' ? pvId : t.param(n));
    if (k === 'json') return async () => ({});
    const v = (t as any)[k];
    return typeof v === 'function' ? v.bind(t) : v;
  } });
  return new Proxy(c, { get(t, k) {
    if (k === 'req') return req;
    if (k === 'get') return (key: string) => (key === 'houzsUser' ? { ...hu, permissions: [...(hu?.permissions ?? []), ...KEYS], permissions_set: [...(hu?.permissions_set ?? hu?.permissions ?? []), ...KEYS] } : t.get(key));
    const v = (t as any)[k];
    return typeof v === 'function' ? v.bind(t) : v;
  } });
}

/** Replaceable in tests. */
export const poVoucherDeps = {
  create: async (c: any, body: Record<string, unknown>): Promise<Response> => {
    const { createPaymentVoucherCore } = await import('../routes/payment-vouchers');
    return createPaymentVoucherCore(c, body) as Promise<Response>;
  },
  post: async (c: any): Promise<Response> => {
    const { postNowHandler } = await import('../../conts/pv-post-now');
    return postNowHandler(c as Context<any>);
  },
  roles: resolveRoles,
};

export interface PoVoucherAnswer { pvNumber: string | null; posted: boolean; problem: string | null }

const words = (j: Record<string, unknown>, fallback: string): string => String(j.message ?? j.error ?? j.reason ?? fallback);

export async function voucherForPoPayment(c: any, paymentId: string, p: PoPaymentFacts): Promise<PoVoucherAnswer> {
  const sb = c.get('supabase');
  try {
    const roles = await poVoucherDeps.roles(sb, activeCompanyId(c) ?? null);
    const made = await poVoucherDeps.create(c, voucherBody(p, roles));
    const pv = (await made.json()) as Record<string, unknown>;
    if (made.status !== 201) return { pvNumber: null, posted: false, problem: words(pv, 'The voucher could not be made.') };
    const pvId = String(pv.id);
    await sb.from('reno_po_instalment_payments').update({ payment_voucher_id: pvId }).eq('id', paymentId);
    const posted = await poVoucherDeps.post(withVoucherKeys(c, pvId));
    const out = (await posted.clone().json().catch(() => ({}))) as Record<string, unknown>;
    if (!posted.ok) return { pvNumber: String(pv.pvNumber), posted: false, problem: words(out, 'The voucher was made but not posted.') };
    return { pvNumber: String(pv.pvNumber), posted: true, problem: null };
  } catch (e) {
    console.error('[po-schedule] voucher failed', e);
    return { pvNumber: null, posted: false, problem: e instanceof Error ? e.message : 'The voucher could not be made.' };
  }
}
