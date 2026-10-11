/** The printed Invoice and Official Receipt, from the document's frozen snapshot, on the shared letterhead. */
import { printPage, esc, ringgit, longDate } from './letterhead';
import type { Snapshot } from './guestDocuments';
import { parsePhone } from '../../src/lib/phone';
import { phone } from '../../src/lib/format';

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function words(n: number): string {
  if (n === 0) return 'Zero';
  const under1000 = (x: number) => {
    const h = Math.floor(x / 100), r = x % 100;
    const rest = r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? ' ' + ONES[r % 10] : ''}`;
    return [h ? `${ONES[h]} Hundred` : '', rest].filter(Boolean).join(' ');
  };
  const parts: string[] = [];
  for (const [size, name] of [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand'], [1, '']] as const) {
    const chunk = Math.floor(n / size) % 1000;
    if (chunk) parts.push(`${under1000(chunk)}${name ? ' ' + name : ''}`);
  }
  return parts.join(' ');
}
/** "Ringgit Malaysia One Hundred Twenty and Sen Fifty Only", as Malaysian receipts write the sum. */
export function amountInWords(sen: number): string {
  const rm = Math.floor(Math.abs(sen) / 100), s = Math.abs(sen) % 100;
  return `Ringgit Malaysia ${words(rm)}${s ? ` and Sen ${words(s)}` : ''} Only`;
}

export function renderDocument(s: Snapshot, voided: { at: string; reason: string } | null): Response {
  const receipt = s.docType === 'receipt';
  const title = receipt ? 'Official receipt' : 'Invoice';
  const stay = `${longDate(s.booking.checkIn)} to ${longDate(s.booking.checkOut)} (${s.booking.nights} ${s.booking.nights === 1 ? 'night' : 'nights'})`;
  const left: [string, string][] = [
    [receipt ? 'Received from' : 'Bill to', s.guest.name],
    ...(s.guest.phone ? [['Phone', parsePhone(s.guest.phone)?.international ?? s.guest.phone] as [string, string]] : []),
    ...(s.guest.email ? [['Email', s.guest.email] as [string, string]] : []),
  ];
  const right: [string, string][] = [
    [receipt ? 'Receipt no' : 'Invoice no', s.docNo],
    ['Date', longDate(s.issuedAt)],
    ['Reservation', [s.booking.ref, s.booking.channelLabel].filter(Boolean).join(' · ')],
    ['Unit', s.booking.unit],
    ['Dates', stay],
  ];
  const dl = (rows: [string, string][]) => `<dl>${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;

  const rows = s.lines.map(l => `<tr><td>${esc(l.label)}${l.sub ? `<div class="ref">${esc(l.sub)}</div>` : ''}</td><td class="num">${ringgit(l.amount)}</td></tr>`).join('');
  const summary = receipt
    ? `<tr class="lh-total"><td>Amount received</td><td class="num">${ringgit(s.total)}</td></tr>`
    : `<tr class="lh-total"><td>Total</td><td class="num">${ringgit(s.total)}</td></tr>
       <tr class="lh-minor"><td>Paid to date</td><td class="num">${ringgit(s.paidToDate)}</td></tr>
       <tr class="lh-minor"><td><strong>Balance due</strong></td><td class="num"><strong>${ringgit(s.balance)}</strong></td></tr>`;

  const paidBy = receipt && s.payment
    ? `<p class="lh-note"><strong>${esc(amountInWords(s.total))}</strong><br />
        Received on ${esc(longDate(s.payment.receivedOn))}${s.payment.method ? ` by ${esc(s.payment.method)}` : ''}${s.payment.reference ? `, reference ${esc(s.payment.reference)}` : ''}.
        ${s.balance > 0 ? `Balance still due on this reservation: ${ringgit(s.balance)}.` : 'Nothing further is due on this reservation.'}</p>`
    : `<p class="lh-note">${s.balance <= 0 ? 'This reservation is paid in full. Thank you.' : s.booking.checkIn > s.issuedAt.slice(0, 10) ? `The balance of ${ringgit(s.balance)} is due before check-in.` : `The balance of ${ringgit(s.balance)} is due.`}</p>`;

  const body = `
<div class="lh-title"><h1>${title}</h1><span class="lh-docno">${esc(s.docNo)}</span></div>
${voided ? `<div class="lh-void"><strong>Void.</strong> Voided on ${esc(longDate(voided.at))}: ${esc(voided.reason)}. This number is not reused.</div>` : ''}
<div class="lh-parties">${dl(left)}${dl(right)}</div>
<table class="lh-table">
  <thead><tr><th>Description</th><th class="num" style="width:30%">Amount</th></tr></thead>
  <tbody>${rows}${summary}</tbody>
</table>
${paidBy}`;

  // Guests are often abroad: the company phone prints in +60 form. The owner statement and Owner Income Report keep
  // the number as saved in Settings.
  return printPage({
    company: { ...s.company, phone: phone(s.company.phone) }, body, title: `${title} ${s.docNo}`, watermark: voided ? 'VOID' : undefined,
    footerNote: `Issued by ${esc(s.issuedBy)}`, filename: `${s.docNo}.html`,
  });
}
