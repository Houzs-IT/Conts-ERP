// Conts only (not part of Houzs's code): what finance corrects on a voucher goes back to the payment requests and staff
// claims it pays (chew, 16 Nov 2026: corrected on the Payment voucher, not on the request; "要，同步回去"). Each line of
// the voucher names what it pays (migration 0330); after the voucher is made or its draft edited:
//   a request open and paid by this voucher alone takes its lines (description, amount, department, sub-department,
//     project, unit, account) and their total; what was first asked is kept (asked_lines), as an AP invoice does;
//   a request alone on the voucher takes its payee (and supplier, when the voucher names one);
//   a claim paid back by it takes its lines and total.
// A voucher to several payees prefixed each line with its payee ("Various"): that prefix is not carried back.
// Best effort: a failure is logged and never undoes the voucher.
import { requestPayments } from './request-vouchers';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as in the modules it sits beside */
type Db = any;
const now = () => new Date().toISOString();
const OPEN = new Set(['SUBMITTED', 'PART_PAID']);

type PvLine = { line_no: number; description: string | null; amount_sen: number; department: string; sub_department_id?: string | null; project_id: number | null; unit_id: string | null;
  debit_account_code: string | null; payment_request_id?: string | null; staff_receipt_id?: string | null };

/** "Ah Seng · Tiles" back to "Tiles" on a voucher to several payees. */
const unprefixed = (d: string | null, various: boolean): string | null => {
  if (!d || !various) return d;
  const at = d.indexOf(' · ');
  return at > 0 ? d.slice(at + 3) : d;
};
const asLine = (l: PvLine, various: boolean) => ({
  department: l.department, sub_department_id: l.sub_department_id ?? null, unit_id: l.unit_id ?? null, project_id: l.project_id ?? null,
  account_code: l.debit_account_code || null, amount_sen: Number(l.amount_sen), description: unprefixed(l.description, various),
});
const same = (a: Array<ReturnType<typeof asLine>>, b: Array<Record<string, any>>) => a.length === b.length && a.every((x, i) => {
  const y = b[i]!;
  return x.amount_sen === Number(y.amount_sen) && (x.description ?? '') === (y.description ?? '') && String(x.project_id ?? '') === String(y.project_id ?? '')
    && String(x.unit_id ?? '') === String(y.unit_id ?? '') && String(x.sub_department_id ?? '') === String(y.sub_department_id ?? '') && String(x.account_code ?? '') === String(y.account_code ?? '');
});

export async function syncFromVoucherBestEffort(sb: Db, pvId: string): Promise<void> {
  try {
    const { data: pvRow } = await sb.from('payment_vouchers').select('id, status, payee_name, supplier_id, payment_request_id').eq('id', pvId).maybeSingle();
    const pv = pvRow as { id: string; status: string; payee_name: string | null; supplier_id: string | null; payment_request_id: string | null } | null;
    if (!pv || pv.status === 'CANCELLED') return;
    const { data: lr } = await sb.from('payment_voucher_lines').select('*').eq('pv_id', pv.id);
    const lines = ((lr ?? []) as PvLine[]).sort((a, b) => Number(a.line_no) - Number(b.line_no));
    /* A voucher for one request names it on the voucher; its lines naming none are that request's (before 0330). */
    const reqOf = (l: PvLine) => l.payment_request_id ?? (!l.staff_receipt_id ? pv.payment_request_id : null);
    const reqIds = [...new Set(lines.map(reqOf).filter((x): x is string => !!x))];
    const recIds = [...new Set(lines.map(l => l.staff_receipt_id).filter((x): x is string => !!x))];
    if (reqIds.length + recIds.length === 0) return;
    const various = /^Various\b/.test(pv.payee_name ?? '');
    const alone = reqIds.length + recIds.length === 1;

    const pays = reqIds.length ? await requestPayments(sb, reqIds) : null;
    for (const q of reqIds) {
      const { data: rr } = await sb.from('payment_requests').select('id, status, payee_name, supplier_id, amount_sen, asked_lines').eq('id', q).maybeSingle();
      const req = rr as { id: string; status: string; payee_name: string; supplier_id: string | null; amount_sen: number; asked_lines: unknown } | null;
      if (!req || !OPEN.has(req.status)) continue;
      const patch: Record<string, unknown> = {};
      /* Its payee, when it is the voucher's only payee. */
      if (alone && pv.payee_name && !various && pv.payee_name !== req.payee_name) Object.assign(patch, { payee_name: pv.payee_name.slice(0, 200) });
      if (alone && pv.supplier_id && pv.supplier_id !== req.supplier_id) Object.assign(patch, { supplier_id: pv.supplier_id, payee_to_check: false });
      /* Its lines, when this voucher alone pays it (a part paid one keeps what the earlier voucher paid). */
      const live = (pays?.vouchers.get(q) ?? []).filter(v => v.status !== 'CANCELLED');
      const mine = lines.filter(l => reqOf(l) === q).map(l => asLine(l, various));
      if (live.length === 1 && live[0]!.id === pv.id && mine.length) {
        const { data: had } = await sb.from('payment_request_lines').select('*').eq('request_id', q);
        const current = ((had ?? []) as Array<Record<string, any>>).sort((a, b) => Number(a.sort) - Number(b.sort));
        if (!same(mine, current)) {
          if (req.asked_lines == null) {
            patch.asked_lines = current.map(h => ({ department: h.department, subDepartmentId: h.sub_department_id ?? null, unitId: h.unit_id, maintenanceIssueId: h.maintenance_issue_id,
              projectId: h.project_id, amountSen: Number(h.amount_sen), description: h.description }));
            patch.asked_amount_sen = Number(req.amount_sen);
          }
          patch.amount_sen = mine.reduce((n, l) => n + l.amount_sen, 0);
          const gone = await sb.from('payment_request_lines').delete().eq('request_id', q);
          if (gone.error) throw new Error(gone.error.message);
          /* A maintenance job a line named stays on the line in its place. */
          const ins = await sb.from('payment_request_lines').insert(mine.map((l, i) => ({ ...l, maintenance_issue_id: current[i]?.maintenance_issue_id ?? null, sort: i, request_id: q })));
          if (ins.error) {
            await sb.from('payment_request_lines').insert(current.map(({ id: _i, ...l }) => l));
            throw new Error(ins.error.message);
          }
        }
      }
      if (Object.keys(patch).length) await sb.from('payment_requests').update({ ...patch, updated_at: now() }).eq('id', q);
    }

    for (const id of recIds) {
      const { data: rr } = await sb.from('staff_receipts').select('id, status, payback_pv_id').eq('id', id).maybeSingle();
      const rec = rr as { id: string; status: string; payback_pv_id: string | null } | null;
      if (!rec || rec.payback_pv_id !== pv.id || rec.status !== 'CHECKED') continue;
      const mine = lines.filter(l => l.staff_receipt_id === id).map(l => asLine(l, various));
      const { data: had } = await sb.from('staff_receipt_lines').select('*').eq('receipt_id', id);
      const current = ((had ?? []) as Array<Record<string, any>>).sort((a, b) => Number(a.sort) - Number(b.sort));
      if (!mine.length || same(mine, current)) continue;
      const gone = await sb.from('staff_receipt_lines').delete().eq('receipt_id', id);
      if (gone.error) throw new Error(gone.error.message);
      const ins = await sb.from('staff_receipt_lines').insert(mine.map((l, i) => ({ ...l, maintenance_issue_id: current[i]?.maintenance_issue_id ?? null, sort: i, receipt_id: id })));
      if (ins.error) {
        await sb.from('staff_receipt_lines').insert(current.map(({ id: _i, ...l }) => l));
        throw new Error(ins.error.message);
      }
      await sb.from('staff_receipts').update({ amount_sen: mine.reduce((n, l) => n + l.amount_sen, 0), updated_at: now() }).eq('id', id);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[claims] voucher ${pvId} did not carry back to its requests:`, (e as Error).message);
  }
}
