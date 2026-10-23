import { type Env, one, all, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { companyDetails, printPage, esc, ringgit, longDate } from '../../_lib/letterhead';

/**
 * GET /api/statements/pdf?id=…
 *
 * Returns a print-ready HTML document rather than a binary PDF. Cloudflare Workers
 * have no PDF renderer, and every consumer of this — the owner portal download, the
 * email attachment, the finance export — can print to PDF from HTML. The document
 * carries its own @page rules, so "Save as PDF" produces the same file everywhere.
 *
 * If a binary is later required, point a headless-Chrome service at this URL; the
 * markup needs no changes.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return fail('VALIDATION', 'A statement id is required.', 422);

  const s = await one<any>(env, `
    SELECT s.*, o.display_name, o.email, o.bank_name, o.bank_account_last4, o.user_id AS owner_user
    FROM owner_statements s JOIN owners o ON o.id = s.owner_id WHERE s.id = ?`, id);
  if (!s) return fail('NOT_FOUND', 'That statement no longer exists.', 404);

  // Owners may only download their own.
  if (session.role === 'owner' && s.owner_user !== session.userId) {
    return fail('FORBIDDEN', 'This statement belongs to another owner.', 403);
  }
  // Provisional figures can still change, so owners only ever see a finalised statement.
  if (session.role === 'owner' && s.state === 'provisional') {
    return fail('NOT_FINAL', 'This statement is not final yet.', 403);
  }
  if (!session.manage && session.role !== 'owner') {
    return fail('FORBIDDEN', 'Statements are available to finance, management and the owner.', 403);
  }

  // A statement built by the workbook rules (it has unit figures) opens as the Owner Income Report, so the owner
  // portal button and any link sent earlier land on the same report finance sees. ?format=legacy keeps this page;
  // months paid before Property OS (only a payout line) have no report and stay here.
  const url = new URL(request.url);
  if (url.searchParams.get('format') !== 'legacy' && await one(env, 'SELECT 1 AS x FROM statement_units WHERE statement_id = ? LIMIT 1', id)) {
    return new Response(null, { status: 302, headers: { location: `${url.origin}/finance/statements/${encodeURIComponent(id)}/report`, 'cache-control': 'no-store' } });
  }

  const lines = await all<any>(env, `
    SELECT l.*, u.unit_number, p.name AS property_name
    FROM statement_lines l
    LEFT JOIN units u ON u.id = l.unit_id
    LEFT JOIN properties p ON p.id = u.property_id
    WHERE l.statement_id = ? ORDER BY l.sort_order, l.occurred_on`, id);

  const company = await companyDetails(env);
  const signed = (sen: number) => sen < 0 ? `− ${ringgit(sen)}` : ringgit(sen);
  const period = new Date(s.period_start).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
  // Provisional figures must be labelled as such wherever they appear.
  const provisional = s.state === 'provisional';

  const body = `
<div class="lh-title"><h1>Owner statement</h1><span class="lh-docno">${esc(period)}</span></div>
<div class="lh-sub">${esc(s.display_name)} &middot; issued ${esc(longDate(s.generated_at))}</div>
${provisional ? '<div class="lh-flag">Draft figures. This statement is not final and may change before it is issued.</div>' : ''}
<table class="lh-table">
  <thead><tr><th style="width:52%">Description</th><th style="width:18%">Unit</th><th style="width:14%">Date</th><th class="num" style="width:16%">Amount</th></tr></thead>
  <tbody>
    ${lines.length === 0 ? `
      <tr><td>Gross Income</td><td>—</td><td>${esc(longDate(s.period_end))}</td><td class="num">${ringgit(s.gross_booking_value)}</td></tr>
      <tr><td>To Operator</td><td>—</td><td>${esc(longDate(s.period_end))}</td><td class="num">− ${ringgit(s.management_fee)}</td></tr>
      <tr><td>Total Deduction</td><td>—</td><td>${esc(longDate(s.period_end))}</td><td class="num">− ${ringgit(s.expenses_total)}</td></tr>`
    : lines.map((l: any) => `
      <tr>
        <td>${esc(l.description)}${l.reference ? `<div class="ref">${esc(l.reference)}</div>` : ''}</td>
        <td>${esc(l.property_name ? l.property_name + ' ' + l.unit_number : '—')}</td>
        <td>${esc(longDate(l.occurred_on))}</td>
        <td class="num">${signed(l.amount)}</td>
      </tr>`).join('')}
    <tr class="lh-total"><td colspan="3">Net Payout to Owner</td><td class="num">${ringgit(s.net_payout)}</td></tr>
  </tbody>
</table>
<p class="lh-note">${s.state === 'paid' && s.bank_account_last4
    ? `Transferred to ${esc(s.bank_name ?? 'your account')} ····${esc(s.bank_account_last4)}.`
    : 'Payment is made to the bank account on your contract.'}
  Every deduction above carries a category, a date and a reference.</p>`;

  return printPage({
    company, body,
    title: `Owner statement — ${s.display_name} — ${period}`,
    filename: `statement-${String(s.period_start).slice(0, 7)}-${String(s.display_name).replace(/\W+/g, '-').toLowerCase()}.html`,
  });
};
