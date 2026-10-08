import { type Env, one, all, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

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

  const lines = await all<any>(env, `
    SELECT l.*, u.unit_number, p.name AS property_name
    FROM statement_lines l
    LEFT JOIN units u ON u.id = l.unit_id
    LEFT JOIN properties p ON p.id = u.property_id
    WHERE l.statement_id = ? ORDER BY l.sort_order, l.occurred_on`, id);

  const rm = (sen: number) => `RM ${(Math.abs(sen) / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const signed = (sen: number) => sen < 0 ? `\u2212 ${rm(sen)}` : rm(sen);
  const period = new Date(s.period_start).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
  const esc = (v: unknown) => String(v ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));

  // Provisional figures must be labelled as such wherever they appear.
  const provisional = s.state === 'provisional';

  const html = `<!doctype html>
<html lang="en-MY"><head>
<meta charset="utf-8" />
<title>Owner statement \u2014 ${esc(s.display_name)} \u2014 ${esc(period)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; font-variant-numeric: tabular-nums; }
  body { margin: 0; font-family: "IBM Plex Sans", system-ui, sans-serif; color: #252525; font-size: 10.5pt; line-height: 1.5; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding-bottom: 18px; border-bottom: 2px solid #C8A46A; }
  .wordmark { font-size: 12pt; font-weight: 600; letter-spacing: 0.18em; }
  .muted { color: #706D67; font-size: 9pt; }
  h1 { font-size: 18pt; font-weight: 600; letter-spacing: -0.01em; margin: 22px 0 2px; }
  .flag { margin: 14px 0; padding: 10px 12px; background: #FFF4D8; border-left: 2px solid #B7791F; color: #8A5A12; font-size: 9.5pt; }
  table { width: 100%; border-collapse: collapse; margin-top: 18px; }
  th { text-align: left; font-size: 8.5pt; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #706D67; padding: 8px 0; border-bottom: 1px solid #DEDAD3; }
  td { padding: 9px 0; border-bottom: 1px solid #EDEAE4; font-size: 10pt; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; }
  .ref { font-family: "IBM Plex Mono", monospace; font-size: 8.5pt; color: #706D67; }
  .total td { border-top: 2px solid #151515; border-bottom: none; padding-top: 14px; font-weight: 600; font-size: 12pt; }
  .foot { margin-top: 28px; padding-top: 14px; border-top: 1px solid #DEDAD3; font-size: 8.5pt; color: #706D67; }
  @media screen { body { max-width: 190mm; margin: 24px auto; padding: 0 16px; } }
</style>
</head><body>

<div class="head">
  <div>
    <div class="wordmark">THE CONTS</div>
    <div class="muted">Property Management</div>
  </div>
  <div class="muted" style="text-align:right">
    The Conts Sdn Bhd<br />202301027399 (1521322-V)<br />Petaling Jaya, Malaysia
  </div>
</div>

<h1>Owner statement</h1>
<div class="muted">${esc(s.display_name)} &middot; ${esc(period)} &middot; issued ${new Date(s.generated_at).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}</div>

${provisional ? '<div class="flag">Provisional figures. This statement is not final and may change before it is issued.</div>' : ''}

<table>
  <thead><tr><th style="width:52%">Description</th><th style="width:18%">Unit</th><th style="width:14%">Date</th><th class="num" style="width:16%">Amount</th></tr></thead>
  <tbody>
    ${lines.length === 0 ? `
      <tr><td>Gross booking value</td><td>\u2014</td><td>${esc(s.period_end)}</td><td class="num">${rm(s.gross_booking_value)}</td></tr>
      <tr><td>Management fee</td><td>\u2014</td><td>${esc(s.period_end)}</td><td class="num">\u2212 ${rm(s.management_fee)}</td></tr>
      <tr><td>Expenses</td><td>\u2014</td><td>${esc(s.period_end)}</td><td class="num">\u2212 ${rm(s.expenses_total)}</td></tr>`
    : lines.map((l: any) => `
      <tr>
        <td>${esc(l.description)}${l.reference ? `<div class="ref">${esc(l.reference)}</div>` : ''}</td>
        <td>${esc(l.property_name ? l.property_name + ' ' + l.unit_number : '\u2014')}</td>
        <td>${esc(l.occurred_on)}</td>
        <td class="num">${signed(l.amount)}</td>
      </tr>`).join('')}
    <tr class="total"><td colspan="3">Net payout</td><td class="num">${rm(s.net_payout)}</td></tr>
  </tbody>
</table>

<div class="foot">
  ${s.state === 'paid' && s.bank_account_last4
    ? `Transferred to ${esc(s.bank_name ?? 'your account')} \u00b7\u00b7\u00b7\u00b7${esc(s.bank_account_last4)}.`
    : 'Payment is made to the bank account on your management agreement.'}
  <br />Every deduction above carries a category, a date and a reference. Questions: +60 17-465 8868.
</div>

</body></html>`;

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-disposition': `inline; filename="statement-${s.period_start.slice(0, 7)}-${s.display_name.replace(/\W+/g, '-').toLowerCase()}.html"`,
      'cache-control': 'private, no-store',
    },
  });
};
