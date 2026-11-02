import { type Env, fail } from '../../../../../_lib/db';
import { requireSession } from '../../../../../_lib/auth';
import { demoAllowed } from '../../../../../_lib/demo';
import { companyDetails, printPage, esc, ringgit } from '../../../../../_lib/letterhead';
import { sampleOwnerFor, parseStatementId, sampleStatement } from '../../../../../_lib/demoPortal';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** GET /api/demo/portal/statements/:id/pdf?ownerId=demo-... — a sample statement as a print-ready page, like the real
 *  statement's (functions/api/statements/pdf.ts), with SAMPLE DATA across every page and in its title and file name. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!(await demoAllowed(env, session))) return fail('FORBIDDEN', 'The sample owner portal is for management and sales staff.', 403);
  const url = new URL(request.url);
  const found = await sampleOwnerFor(env, url);
  if (found instanceof Response) return found;
  const id = parseStatementId(String(params.id));
  if (!id || id.ownerId !== found.owner.id) return fail('NOT_FOUND', 'That sample statement does not exist.', 404);
  const st = await sampleStatement(env, found.owner, found.units, id.period);
  const [y, m] = id.period.split('-').map(Number);
  const month = `${MONTHS[m - 1]} ${y}`;
  const rows = st.units.map(u => `
    <tr><td><b>${esc(u.label)}</b></td><td class="num"></td></tr>
    ${u.lines.map(l => `<tr class="lh-minor"><td>${esc(l.label)}</td><td class="num">${l.amount < 0 ? '- ' : ''}${ringgit(l.amount)}</td></tr>`).join('')}
    <tr><td>Net Payout to Owner · ${esc(u.label)}</td><td class="num">${ringgit(u.net)}</td></tr>`).join('');
  const body = `
<div class="lh-title"><h1>Owner statement · Sample data</h1><span class="lh-docno">${esc(month)}</span></div>
<div class="lh-flag">Sample data. A sample owner (${esc(found.owner.display_name)}) and sample reservations from Demo mode, to show how a statement reads. Not an owner statement, not a payout.</div>
<table class="lh-table">
  <thead><tr><th>Unit and line</th><th class="num">Amount</th></tr></thead>
  <tbody>${rows}
    <tr class="lh-total"><td>Net Payout to Owner (sample)</td><td class="num">${ringgit(st.netPayout)}</td></tr>
  </tbody>
</table>
<p class="lh-note">Gross Income ${ringgit(st.grossBookingValue)} less ${st.share}% To Operator ${ringgit(st.managementFee)}. ${st.isFinal ? 'Month closed.' : 'This month is still running; the figures change as sample reservations are added.'}</p>`;
  return printPage({ company: await companyDetails(env), title: `Sample data · Owner statement ${month}`, body, watermark: 'SAMPLE DATA', footerNote: 'Sample data from Demo mode. Not a real statement.', filename: `sample-statement-${id.period}.html` });
};
