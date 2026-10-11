/** The one letterhead and footer every printable document carries: guest invoices and official receipts, and the
 *  owner statement print view (functions/api/statements/pdf.ts). Company details come from Settings > Company
 *  (company.*, with the older org.* keys and the Settings defaults behind them); the Owner Income Report page reads
 *  the same details through ownerReport.ts, and lays them out the same way (name and details left, logo right).
 *
 *  Documents are print-ready HTML, not binary PDF: Workers have no PDF renderer, and every browser saves the page as
 *  a PDF with its own @page rules, so "Save as PDF" gives the same A4 file everywhere. */
import { type Env, all } from './db';

export interface Company { legalName: string; companyNumber: string; address: string; phone: string; email: string; logo: string }

/** Same defaults as Settings > Company (functions/api/settings/index.ts), so a database where nobody saved the
 *  screen prints what the screen shows. */
export const COMPANY_DEFAULTS = {
  legalName: 'The Conts Sdn. Bhd.', companyNumber: '202301027399 (1521322-V)',
  address: 'E-28-02 & E-28-03, Menara Suezcap 2, KL Gateway,\nNo. 2, Jalan Kerinchi, Gerbang Kerinchi Lestari,\n59200 Kuala Lumpur, W.P. Kuala Lumpur.',
  phone: '+60 11-6133 3289', email: 't.conts725@gmail.com',
};
const DEFAULTS = COMPANY_DEFAULTS;
export const LOGO_PATH = '/brand/the-conts-logo.png';

export function companyFrom(m: Map<string, string>): Company {
  const pick = (key: string, legacy: string | null, def: string) => m.get(key) ?? (legacy ? m.get(legacy) : undefined) ?? def;
  return {
    legalName: pick('company.legalName', 'org.legal_name', DEFAULTS.legalName),
    companyNumber: pick('company.companyNumber', 'org.company_number', DEFAULTS.companyNumber),
    address: pick('company.address', 'org.address', DEFAULTS.address),
    phone: pick('company.supportPhone', 'org.support_phone', DEFAULTS.phone),
    email: pick('company.supportEmail', null, DEFAULTS.email),
    logo: LOGO_PATH,
  };
}

export async function companyDetails(env: Env): Promise<Company> {
  const rows = await all<{ key: string; value: string }>(env, `SELECT key, value FROM settings WHERE key LIKE 'company.%' OR key LIKE 'org.%'`);
  return companyFrom(new Map(rows.map(r => [r.key, r.value])));
}

export const esc = (v: unknown) => String(v ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));
/** RM 1,234.56 from sen. */
export const ringgit = (sen: number) => `RM ${(Math.abs(sen) / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** 3 Sep 2026 from YYYY-MM-DD or an ISO time, in Malaysia time. Month names are fixed (as src/lib/format.ts): the
 *  en-GB locale prints "Sept", which the date format does not allow. */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const longDate = (d: string | null | undefined) => {
  if (!d) return '';
  const [y, m, day] = (d.length === 10 ? d : new Date(Date.parse(d) + 8 * 3600e3).toISOString().slice(0, 10)).split('-').map(Number);
  return `${day} ${MON[m - 1]} ${y}`;
};

const CSS = `
  @page { size: A4; margin: 14mm 15mm 16mm; }
  * { box-sizing: border-box; font-variant-numeric: tabular-nums; }
  body { margin: 0; font-family: "Times New Roman", Times, serif; color: #151515; font-size: 10.5pt; line-height: 1.4; }
  .lh-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 6px; border-bottom: 1.5px solid #000; }
  .lh-company { font-size: 17pt; font-weight: 700; text-transform: uppercase; letter-spacing: .01em; margin-bottom: 2px; }
  .lh-small { font-size: 9pt; margin-bottom: 2px; }
  .lh-addr { font-size: 9.5pt; font-weight: 700; max-width: 112mm; text-transform: uppercase; white-space: pre-line; }
  .lh-contact { font-size: 9.5pt; }
  .lh-logo { width: 30mm; height: auto; margin-top: 1mm; }
  .lh-title { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; margin: 14px 0 4px; }
  .lh-title h1 { margin: 0; font-size: 16pt; font-weight: 700; letter-spacing: .02em; text-transform: uppercase; }
  .lh-docno { font-size: 12pt; font-weight: 700; white-space: nowrap; }
  .lh-sub { color: #555; font-size: 9.5pt; }
  .lh-flag { margin: 12px 0; padding: 8px 10px; background: #fff4d8; border-left: 2px solid #b7791f; color: #8a5a12; font-size: 9.5pt; }
  .lh-void { margin: 12px 0; padding: 8px 10px; background: #fde8e8; border-left: 2px solid #b42318; color: #8b1a12; font-size: 9.5pt; }
  .lh-watermark { position: fixed; top: 42%; left: 0; right: 0; text-align: center; font-size: 96pt; font-weight: 700; color: rgba(180, 35, 24, .12); transform: rotate(-24deg); pointer-events: none; letter-spacing: .1em; }
  .lh-parties { display: grid; grid-template-columns: 1.2fr 1fr; gap: 0 24px; margin: 12px 0; }
  .lh-parties dl { margin: 0; }
  .lh-parties dl > div { display: grid; grid-template-columns: 30mm 1fr; margin-bottom: 3px; }
  .lh-parties dt { font-weight: 700; }
  .lh-parties dd { margin: 0; }
  table.lh-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  .lh-table th { text-align: left; font-size: 9pt; font-weight: 700; padding: 6px; border-top: 1.5px solid #000; border-bottom: 1.5px solid #000; background: #f3efe7; }
  .lh-table td { padding: 6px; border-bottom: 1px solid #ddd8ce; vertical-align: top; }
  .lh-table .num { text-align: right; white-space: nowrap; }
  .lh-table .ref { font-size: 8.5pt; color: #555; }
  .lh-table tr.lh-total td { border-top: 1.5px solid #000; border-bottom: 1.5px solid #000; font-weight: 700; font-size: 11.5pt; }
  .lh-table tr.lh-minor td { border-bottom: none; padding-top: 3px; padding-bottom: 3px; }
  .lh-note { margin-top: 14px; font-size: 9.5pt; }
  .lh-foot { margin-top: 26px; padding-top: 8px; border-top: 1px solid #000; font-size: 8.5pt; color: #333; display: flex; justify-content: space-between; gap: 16px; }
  .lh-foot .lh-gen { color: #666; text-align: right; }
  @media screen { body { max-width: 190mm; margin: 24px auto; padding: 0 16px; background: #fff; } }
  @media screen and (max-width: 640px) { body { margin: 12px auto; } .lh-head, .lh-title, .lh-foot { flex-direction: column; } .lh-parties { grid-template-columns: 1fr; } .lh-logo { width: 24mm; } }
  @media print { .lh-noprint { display: none; } }
`;

/** The letterhead block: name and company details on the left, the logo on the right, a rule beneath. */
export function letterhead(c: Company): string {
  const contact = [c.phone && `TEL: ${esc(c.phone)}`, c.email && `EMAIL: ${esc(c.email)}`].filter(Boolean).join(' | ');
  return `<header class="lh-head">
  <div>
    <div class="lh-company">${esc(c.legalName)}</div>
    ${c.companyNumber ? `<div class="lh-small">Company No: ${esc(c.companyNumber)}</div>` : ''}
    ${c.address ? `<div class="lh-addr">${esc(c.address)}</div>` : ''}
    ${contact ? `<div class="lh-contact">${contact}</div>` : ''}
  </div>
  <img src="${esc(c.logo)}" alt="The Conts" class="lh-logo" />
</header>`;
}

/** The footer every document ends with. */
export function footer(c: Company, note?: string): string {
  return `<footer class="lh-foot">
  <div>${esc(c.legalName)}${c.companyNumber ? ` (${esc(c.companyNumber)})` : ''}${c.address ? `<br />${esc(c.address)}` : ''}${note ? `<br />${note}` : ''}</div>
  <div class="lh-gen">This document was generated by computer.<br />${[c.phone, c.email].filter(Boolean).map(esc).join(' &middot; ')}</div>
</footer>`;
}

/** A whole print-ready page: letterhead, the caller's body, footer. `body` is trusted markup built with esc(). */
export function printPage(x: { company: Company; title: string; body: string; footerNote?: string; watermark?: string; filename: string }): Response {
  const html = `<!doctype html>
<html lang="en-MY"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(x.title)}</title>
<style>${CSS}</style>
</head><body>
${x.watermark ? `<div class="lh-watermark" aria-hidden="true">${esc(x.watermark)}</div>` : ''}
${letterhead(x.company)}
${x.body}
${footer(x.company, x.footerNote)}
</body></html>`;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-disposition': `inline; filename="${x.filename.replace(/[^\w.-]+/g, '-')}"`,
      'cache-control': 'private, no-store',
    },
  });
}
