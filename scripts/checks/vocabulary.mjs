// One word per idea (docs/VOCABULARY.md). Flags a word that docs/VOCABULARY.md lists under "do not use" when it
// appears in text people read: JSX text, labels, titles, placeholders, toasts, fail(...) messages, PDF and email
// text. Code (keys, SQL, stored values such as 'checked_out' or 'cancelled') is never read, so it is never flagged.
//
// Part of `npm run check` (scripts/checks/run.mjs). A legitimate exception (a channel's own word, an import column
// the file format fixes) is marked on its line, or the line above, with a comment `vocab-ok: <reason>`.
//
//   node scripts/checks/vocabulary.mjs                       run the check (self-test first)
//   node scripts/checks/vocabulary.mjs --inventory <out.csv>  write every user-facing string (string,location,kind)
//   node scripts/checks/vocabulary.mjs --rename-map <out.csv> write old -> suggested new string -> files
//   node scripts/checks/vocabulary.mjs --counts               how often each word of each idea is used today
//   node scripts/checks/vocabulary.mjs --pending              the words still to change in the PENDING_REWORK files
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { ROOT, runCheck, read } from './_lib.mjs';

/* ------------------------------------------------------------------ the words ------------------------------------ */

// side: 'rental' rules do not apply to supply chain screens, where the same English word names a different thing
// (a stock adjustment, a customer's order). source: where the chosen word comes from.
// `bad` patterns are matched case-insensitively against one user-facing string; `to` is the suggested word.
export const RULES = [
  // Rental side: Airbnb's host words.
  { concept: 'A guest\'s reservation (the record)', term: 'Reservation', source: 'Airbnb', side: 'rental', bad: [
    { re: /\bbookings\b(?!\.com)/, to: 'reservations' },
    { re: /\bbooking\b(?!\.com|\s+requests?\b|\s+sites?\b)/, to: 'reservation' },
    { re: /\b(?:new|next|current|this|that|each|past|upcoming|previous|their|your|a|the|guest's|guests') stays\b/, to: m => m.replace(/stays$/i, 'reservations') },
    { re: /\b(?:new|next|current|this|that|each|past|upcoming|previous|their|your|a|guest's) stay\b(?! the same)/, to: m => m.replace(/stay$/i, 'reservation') },
  ] },
  { concept: 'Day a guest arrives / leaves', term: 'Check-in / Checkout', source: 'Airbnb', side: 'rental', bad: [
    { re: /\bcheck-outs?\b/, to: m => m.replace(/check-out/i, 'checkout') },
    { re: /\bdepartures?\b/, to: m => m.replace(/departure/i, 'checkout') },
    { re: /\barrivals?\b/, to: m => m.replace(/arrival/i, 'check-in') },
  ] },
  { concept: 'A request not yet accepted', term: 'Inquiry', source: 'Airbnb', side: 'rental', bad: [
    { re: /\benquir(?:y|ies)\b/, to: m => m.replace(/enquir/i, 'inquir') },
  ] },
  { concept: 'One unit\'s ad on a channel', term: 'Listing', source: 'Airbnb', side: 'rental', bad: [] },
  { concept: 'The apartment an owner owns', term: 'Unit', source: 'Owner report', side: 'rental', bad: [
    { how: 'reword', re: /\b(?:apartments?|rooms?)\b(?! (?:and rate|type))/, to: m => (/s$/i.test(m) ? 'units' : 'unit'), note: 'Booking.com room mapping keeps "room": that is Booking.com\'s word' },
  ] },
  { concept: 'The building a unit is in', term: 'Building', source: 'Owner report', side: 'rental', bad: [
    { how: 'reword', re: /\bpropert(?:y|ies)\b(?! OS)/, to: m => (/ies$/i.test(m) ? 'buildings' : 'building') },
  ] },
  { concept: 'Airbnb, Booking.com, Agoda, direct', term: 'Channel', source: 'Plain', side: 'rental', bad: [
    { re: /\bOTAs?\b/, to: m => (/s$/.test(m) ? 'channels' : 'channel') },
    { re: /\bbooking sites?\b/, to: m => (/s$/i.test(m) ? 'channels' : 'channel') },
    { re: /\b(?:the )?platform(?:'s|s)?\b/, to: 'channel' },
  ] },
  { concept: 'Nights nobody can book', term: 'Blocked nights', source: 'Airbnb', side: 'rental', bad: [
    { re: /\bstop[ -]sell\b/, to: 'blocked' },
    { re: /\boff sale\b/, to: 'blocked', how: 'reword' },
    { re: /\b(?:back )?on sale\b/, to: 'available', how: 'reword' },
    { re: /\bopen for sale\b/, to: 'available' },
  ] },
  { concept: 'Price of one night', term: 'Nightly price', source: 'Airbnb', side: 'rental', bad: [
    { re: /\b(?:base )?nightly rates?\b/, to: 'nightly price' },
    { re: /\bbase price\b/, to: 'nightly price' },
    { re: /\bweekend rates?\b/, to: 'weekend price' },
    { re: /\bweb rate\b/, to: 'direct price' },
  ] },
  { concept: 'Fewest nights a reservation may have', term: 'Minimum nights', source: 'Airbnb', side: 'rental', bad: [
    { re: /\bmin(?:imum)?\.? stay\b/, to: 'minimum nights' },
  ] },
  { concept: 'What the guest pays for a reservation', term: 'Guest total', source: 'Plain (Airbnb shows it as "Guest paid")', side: 'rental', bad: [
    { re: /\bgross booking value\b/, to: 'guest total' },
    { re: /\bbooking value\b/, to: 'guest total' },
    { re: /\bGBV\b/, to: 'guest total' },
  ] },
  { concept: 'What the channel keeps', term: 'Service fee', source: 'Airbnb', side: 'rental', bad: [
    { re: /\bsite fees?\b/, to: 'service fee' },
    { re: /\bplatform fees?\b/, to: 'service fee' },
    { re: /\bchannel fees?\b/, to: 'service fee' },
    { re: /\bcommission\b/, to: 'service fee' },
  ] },
  { concept: 'What the channel pays us for a reservation', term: 'Host payout', source: 'Airbnb', side: 'rental', bad: [
    { re: /\b(?:booking )?site payouts?\b/, to: 'host payout' },
    { re: /\bcollected revenue\b/, to: 'earnings' },
  ] },
  { concept: 'Host payouts added up over a period (staff screens)', term: 'Earnings', source: 'Airbnb', side: 'rental', bad: [
    { re: /\baccommodation revenue\b/, to: 'earnings' },
    { re: /\brevenue\b(?! per)/, to: 'earnings', how: 'reword', note: 'a contract\'s "revenue split" is the owner/operator split: say "split"' },
  ] },
  { concept: 'Average price per booked night', term: 'Average nightly price', source: 'Plain', side: 'rental', bad: [
    { re: /\bADR\b/, to: 'Avg nightly price' },
    { re: /\bRevPAR\b/, to: 'Earnings per available night' },
  ] },
  { concept: 'Guest conversations', term: 'Messages', source: 'Airbnb', side: 'rental', bad: [
    { re: /^Inbox$/, to: 'Messages' },
  ] },

  // Owner money: the owner's own Owner Income Report.
  { concept: 'Money to the owner for a month (the final line)', term: 'Net Payout to Owner', source: 'Owner report', side: 'rental', bad: [
    { re: /\bnet owner payouts?\b/, to: 'Net Payout to Owner', exact: true },
    { re: /^net (?:owner )?payout(?: to owner)?\b/, to: 'Net Payout to Owner', exact: true },
  ] },
  { concept: 'Owner credits and charges after the split', term: 'Owner Adjustments', source: 'Owner report (O2 Adjustment)', side: 'rental', bad: [
    { re: /\bowner (?:credits?|charges?)(?: and (?:credits?|charges?))?\b/, to: 'owner adjustments' },
  ] },
  { concept: 'The operator\'s percentage', term: 'To Operator (Operator share)', source: 'Owner report', side: 'rental', bad: [
    { re: /\bmanagement share\b/, to: 'operator share' },
    { re: /\bcompany share\b/, to: 'operator share' },
    { re: /\bmanagement fees?\b/, to: 'operator share', how: 'reword', note: 'owner money prints "N% To Operator"; a contract field is "Operator share"' },
  ] },
  { concept: 'Statement status', term: 'Draft / Final', source: 'Plain', side: 'rental', bad: [
    { re: /\bprovisional\b/, to: 'draft' },
    { re: /\bfinali[sz]ed\b/, to: 'final' },
  ] },
  { concept: 'Monthly owner document', term: 'Owner statement', source: 'Owner report terms', side: 'rental', bad: [
    { re: /\bowner reports?\b/, to: m => (/s$/i.test(m) ? 'owner statements' : 'owner statement') },
    { re: /\bincome reports?\b(?! \{)/, to: 'owner statement', note: 'the PDF title "Owner Income Report" stays' },
  ] },

  // Operations.
  { concept: 'One cleaning of one unit', term: 'Cleaning job', source: 'Plain', side: 'rental', bad: [
    { re: /\bhousekeeping\b/, to: 'cleaning' },
    { re: /\bturnovers?\b/, to: m => (/s$/i.test(m) ? 'cleaning jobs' : 'cleaning job') },
    { re: /\bcleans\b/, to: 'cleaning jobs' },
  ] },
  { concept: 'Person who cleans', term: 'Cleaner', source: 'Plain', side: 'rental', bad: [
    { re: /\bhousekeepers?\b/, to: m => (/s$/i.test(m) ? 'cleaners' : 'cleaner') },
  ] },
  { concept: 'A repair on a unit', term: 'Maintenance job', source: 'Plain', side: 'rental', bad: [
    { re: /\bwork orders?\b/, to: 'maintenance job' },
    { re: /\btickets?\b/, to: 'maintenance job' },
    { re: /\bmaintenance issues?\b/, to: 'maintenance jobs' },
  ] },
  { concept: 'Work for one cleaner or technician', term: 'Job', source: 'Plain', side: 'rental', bad: [
    { re: /\bmy tasks\b/, to: 'My jobs' },
  ] },

  // Jargon, everywhere.
  { concept: 'Words for engineers', term: '(say what happens)', source: 'Plain', side: 'all', how: 'reword', bad: [
    { re: /\bwebhooks?\b/, to: 'live updates' },
    { re: /\bpayloads?\b/, to: 'details' },
    { re: /\bidempoten\w*\b/, to: '(remove)' },
    { re: /\boutbox\b/, to: 'waiting to send' },
    { re: /\bentit(?:y|ies)\b/, to: 'record' },
    { re: /\baudit log\b/, to: 'history' },
    { re: /\bendpoint\b/, to: 'address' },
    { re: /\bfield roles?\b/, to: 'cleaners and technicians' },
    { re: /\bsynced\b/, to: 'sent' },
    { re: /\bsyncing\b/, to: 'updating' },
    { re: /\bsyncs?\b/, to: 'update', note: 'say what moves where: "Prices update on Airbnb"' },
    { re: /\bSLA\b/, to: 'time allowed' },
  ] },
];

/** The owner decided every term above on this date (PR #168). */
const DECIDED = '2026-10-11';

/** Single labels the word rules cannot catch, because the same word is right elsewhere ("Confirmed" on a sales
 *  order): the status pills and menu entries that change. [old, new, term, where]. */
const LABEL_ROWS = [
  ['Confirmed', 'Upcoming', 'Reservation status', 'src/lib/status.ts (booking.confirmed, calendar.confirmed)'],
  ['Checked in', 'Currently hosting', 'Reservation status', 'src/lib/status.ts (booking.checked_in)'],
  ['Checked out', 'Past', 'Reservation status', 'src/lib/status.ts (booking.checked_out)'],
  ['No show', 'No-show', 'Reservation status', 'src/lib/status.ts (booking.no_show)'],
  ['Provisional', 'Draft', 'Draft / Final', 'src/lib/status.ts (statement.provisional)'],
  ['Finalised', 'Final', 'Draft / Final', 'src/lib/status.ts (statement.finalised)'],
  ['Bookings', 'Reservations', 'Reservation', 'src/lib/navigation.ts (bookings)'],
  ['PROPERTIES', 'UNITS', 'Building', 'src/lib/navigation.ts (group label)'],
  ['Inbox', 'Messages', 'Messages', 'src/lib/navigation.ts (inbox)'],
  ['Payouts', 'Owner payouts', 'Net Payout to Owner', 'src/lib/navigation.ts (payouts)'],
  ['Adjustments', 'Stock adjustments', 'Stock adjustment', 'src/lib/navigation.ts (adjustments, supply chain)'],
  ['Products & Maintenance', 'Products', 'Products', 'src/lib/navigation.ts (procurement, supply chain)'],
  ['Housekeeper', 'Cleaner', 'Cleaner', 'src/lib/vocabulary.ts (ROLE_LABEL.housekeeper); src/components/PermissionsChart.tsx'],
  ['Block', 'Repair', 'Blocked nights', 'src/lib/vocabulary.ts (CHANNEL.maintenance_block label: the reason shown on a blocked night)'],
];

/** Screens and API folders of the supply chain workspace: rental words do not apply there. */
const SUPPLY = /(SalesOrder|SalesInvoice|SalesReturn|DeliveryOrder|DeliveryPlanning|DeliveryDate|DeliveryTime|DeliveryZone|DeliveryResidence|Purchase|Goods|Stock|Racks|Warehouse|Supplier|Customer|Fabric|Product|Mrp|DpOrders|LastMile|LoadingList|Driver|Vehicle|Fleet|ThreePL|Consignment|CreditNote|PaymentVoucher|Unbilled|Adjustments|Categories|RateCard|Accounting|SupplyChain|scmEngine|ShortStock)|\/(sales-orders|sales-invoices|sales-returns|delivery-\w+|purchase-\w+|goods-receipts|stock\w*|racks|warehouses|suppliers|customers|fabrics|products|product-models|mrp|loading-list|drivers?|driver-leave|vehicles|fleet-health|coverage-fleet|threepl-companies|consignment-notes|credit-notes|payment-vouchers|unbilled-deliveries|categories|rate-cards|rate-card-compute|accounting|supply-chain|so-amendments|residence-rules|scm-util|stock-ops|transport|fabric|racks)(\/|\.ts|$)/i;
export const isSupply = rel => SUPPLY.test(rel);

/** Words that must stay as they are, whatever the rules say. */
const KEEP = [
  /Booking\.com/i, /\bOwner stay/i, /\bOwner Income Report\b/, /\bPayout Before O2 Adjustment\b/, /\bHotel ID\b/,
  /\bNet Income Before Deduct Management Fees\b/, /\bNet Payout to Owner\b/i, /\bNET PAYOUT TO OWNER\b/,
];

/** Files whose strings are fixed by someone else: column headers of the HostPlatform and Airbnb export files
 *  (the import matches them exactly), and the owner report's own wording. */
export const allow = {
  'src/lib/statementTerms.ts': 'The owner report\'s own wording, kept exactly as printed.',
  'scripts/checks/vocabulary.mjs': 'This check names the words it bans.',
  // The printed Owner Income Report copies the owner's own sample word for word (owner's rule), old words included.
  'src/pages/OwnerIncomeReportPage.tsx': 'The printed report copies the owner\'s sample word for word.',
};

/** Screens being reworked in parallel by the units-owners sweep, which applies these words there itself
 *  (docs/VOCABULARY.md, status line). Remove a prefix here once its rework lands. */
export const PENDING_REWORK = [
  'src/pages/units/', 'src/pages/owners/', 'src/pages/OwnerProfilePage.tsx', 'src/pages/OwnersPage.tsx', 'src/pages/UnitsPage.tsx',
  'functions/_lib/ownerStatement.ts', 'functions/api/units/', 'functions/api/owners/',
];
const pending = rel => PENDING_REWORK.some(p => rel === p || (p.endsWith('/') && rel.startsWith(p)));

/** Lines excused by a `vocab-ok: <reason>` comment on the line itself or the line above (reason at least 10 chars). */
const OK_MARK = /vocab-ok:\s*(.{10,})/;
function excusedLines(text) {
  const out = new Set();
  text.split('\n').forEach((l, i) => { if (OK_MARK.test(l)) { out.add(i + 1); out.add(i + 2); } });
  return out;
}
const SKIP_KIND = /^const:\w*(COLUMNS|HEADERS|HEADER|COLS)$/;

/* ------------------------------------------------------------- the user-facing strings -------------------------- */

const SKIP_FILE = /(^|\/)reno[^/]*$|renovation|(^|\/)(fallback|demo|mock|fixtures?)\.\w+$|\.d\.ts$/i;

function walkTs(dir, out = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (e.name !== 'node_modules') walkTs(rel, out); }
    else if (/\.(ts|tsx)$/.test(e.name) && !SKIP_FILE.test(rel)) out.push(rel);
  }
  return out;
}
export const uiFiles = () => [...walkTs('src'), ...walkTs('functions')].sort();
const checkedFiles = () => uiFiles().filter(rel => !pending(rel));

const NON_UI_ATTR = new Set(['className', 'class', 'key', 'to', 'href', 'src', 'id', 'name', 'type', 'variant', 'tone', 'size', 'icon',
  'entity', 'value', 'path', 'role', 'htmlFor', 'autoComplete', 'inputMode', 'method', 'target', 'rel', 'align', 'mode', 'width', 'height',
  'as', 'side', 'kind', 'format', 'accept', 'pattern', 'step', 'min', 'max', 'dir', 'lang', 'form', 'color', 'status', 'area', 'field',
  'sort', 'style', 'd', 'viewBox', 'fill', 'stroke', 'strokeWidth', 'xmlns', 'storageKey', 'layoutKey', 'tableKey', 'testId',
  'channel', 'defaultValue', 'justify', 'gap', 'state', 'scope', 'tab', 'columns', 'cols', 'span', 'wrap', 'weight', 'font', 'shape', 'currency']);
const NON_UI_KEY = new Set(['key', 'path', 'icon', 'tone', 'type', 'id', 'area', 'kind', 'template', 'channel', 'table', 'entity', 'field',
  'sort', 'className', 'method', 'code', 'href', 'to', 'variant', 'size', 'align', 'width', 'mode', 'format', 'status', 'state', 'role',
  'entityTable', 'entityId', 'dedupe', 'dedupeKey', 'link', 'url', 'col', 'column', 'name', 'value', 'workspace', 'action', 'event',
  'recipient', 'contentType', 'headers', 'Content-Type', 'scope', 'tab', 'unit', 'currency', 'locale', 'timeZone', 'cron', 'color', 'accessor',
  'by', 'dir', 'order', 'group']);
const DATA_KEY = /^(padding|margin|border\w*|background\w*|font\w*|boxShadow|transition|gridTemplate\w*|outline|inset|transform|animation|cursor|display|position|overflow|whiteSpace|textAlign|lineHeight|letterSpacing|opacity|zIndex|top|left|right|bottom|minWidth|maxWidth|minHeight|maxHeight|height|width|gap|flex\w*|\w+(Name|Code|DocNo|No|Number|Id|Email|Phone|Address|Ref|Url|Plate))$/;
const UI_KEY = /^(label|title|message|description|body|subject|placeholder|hint|help|helper|empty|emptyText|emptyTitle|emptyBody|text|header|heading|caption|tooltip|note|summary|confirm|confirmLabel|cancelLabel|busyLabel|submitLabel|sub|subtitle|noun|plural|singular|eyebrow|detail|reason|question|prompt|actionLabel|error|warning|legend|short|long|blurb|why|lede|intro|cta|button|disabledReason|preview|needs|timing|trigger)$/;
const UI_ATTR = /^(title|label|placeholder|aria-label|description|hint|help|empty|emptyText|message|confirmLabel|cancelLabel|busyLabel|submitLabel|saveLabel|heading|subtitle|sub|alt|tooltip|caption|noun|body|text|note|eyebrow|actionLabel|disabledReason|error)$/;
const SKIP_CALL = /^(cn|cx|clsx|twMerge|run|all|first|one|many|exec|query|sql|prepare|get|set|has|delete|getItem|setItem|removeItem|fetch|require|import|includes|startsWith|endsWith|split|join|replace|replaceAll|match|test|indexOf|querySelector|querySelectorAll|addEventListener|removeEventListener|createElement|setAttribute|getAttribute|append|URL|URLSearchParams|Date|RegExp|parseInt|parseFloat|Number|toLocaleString|toLocaleDateString|DateTimeFormat|NumberFormat|log|warn|info|debug|padStart|padEnd|localeCompare|header|cookie|redirect|navigate|matchPath|encodeURIComponent|decodeURIComponent|digest|importKey|sign|verify|btoa|atob|Response|json|text|blob|bind|secret|cachedFetch|useApi|useQuery|upsert|q|cols)$/;
const SKIP_RECV = /^(api|console|db|sql|env|localStorage|sessionStorage|document|window|url|params|searchParams|headers|request|req|res|crypto|JSON|Object|Array|Math|path|fs|style|el|ref|node|map|set|cache|history|location|router|z|where|conds|clauses)$/;
const SQLISH = /[=<>]\s*\?|\?::|\bIN \(|\bIS (NOT )?NULL\b|\bI?LIKE\b|\bEXCLUDED\.|\bDO (NOTHING|UPDATE)\b|\b[a-z_]+\.[a-z_]+\s*(=|IN\b|IS\b|>=|<=|<|>)|\bto_char\(|COALESCE|jsonb|::(text|date|int|numeric|bigint)|ORDER BY|GREATEST\(|LEAST\(|\|\||\bNOT IN\b|\bON CONFLICT\b|\bnow\(\)|\bINTERVAL\b/;
const SQL_START = /^(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DROP|BEGIN|COMMIT|FROM|WHERE|AND|OR|LEFT JOIN|JOIN|GROUP BY|RETURNING|SET|VALUES|LIMIT|CASE|SUM|COUNT)\b/;

function looksHuman(s, strong) {
  const t = s.trim();
  if (!t || !/[A-Za-z]/.test(t)) return false;
  if (/^(https?:|mailto:|tel:|\/|\.\/|#|data:)/.test(t)) return false;
  if (SQL_START.test(t) || SQLISH.test(t)) return false;
  if (/^[a-z_]+(, ?[a-z_]+)+,?$/.test(t)) return false; // column lists
  if (/\b\d+px\b|\bsolid\b|\{color\.|\{space\.|\{radius\./.test(t)) return false; // inline css
  if (/^[a-z0-9_.:\-/[\]=!&>%#()@* ]+$/.test(t) && /(^|\s)[a-z0-9]+[-:][a-z0-9]/.test(t)) return false; // tailwind classes
  if (/^[a-z]+[A-Z]\w*$/.test(t)) return false; // camelCase
  if (/^\w+\.\w+(\.\w+)*$/.test(t)) return false; // dotted keys
  if (/^[\w-]+\/[\w./+-]+$/.test(t)) return false; // mime types, paths
  if (/^#?[0-9a-f]{3,8}$/i.test(t) || /^(rgb|hsl|var|calc|url)\(/.test(t)) return false;
  if (/^[\d\s.,:%+\-x]+$/.test(t)) return false;
  if (!strong) {
    if (/^[a-z0-9_.:\-/[\]=!&>%#()@*]+$/.test(t)) return false; // codes and keys
    if (/^[A-Z0-9_]+$/.test(t) && t.length > 1) return false; // ENUM_CODES
    if (!/^[A-Z]/.test(t) && !/\s/.test(t)) return false;
  }
  return true;
}

function textOf(node, sf) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  let s = node.head.text;
  for (const sp of node.templateSpans) s += `{${sp.expression.getText(sf).replace(/\s+/g, ' ').slice(0, 30)}}${sp.literal.text}`;
  return s;
}

function attrKind(attr) {
  const name = attr.name.getText();
  if (NON_UI_ATTR.has(name) || /^on[A-Z]/.test(name) || /^(data|aria-(?!label))-/.test(name)) return null;
  return { kind: `attr:${name}`, strong: UI_ATTR.test(name) };
}

const PASS_THROUGH = [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.PlusToken];
const COMPARE = [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword];

/** Where a string literal ends up: null when it is code, else its kind and whether the place is surely for people. */
function classify(node, sf) {
  let n = node, p = node.parent;
  while (p && (ts.isConditionalExpression(p) || ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isArrayLiteralExpression(p) ||
    (ts.isBinaryExpression(p) && PASS_THROUGH.includes(p.operatorToken.kind)) || ts.isTemplateSpan(p) || ts.isTemplateExpression(p) || ts.isSpreadElement(p))) {
    if (ts.isConditionalExpression(p) && p.condition === n) return null;
    n = p; p = p.parent;
  }
  if (!p) return null;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p) || ts.isExternalModuleReference(p)) return null;
  if (ts.isCaseClause(p) || ts.isElementAccessExpression(p) || ts.isTaggedTemplateExpression(p) || ts.isPropertyDeclaration(p) || ts.isEnumMember(p)) return null;
  if (ts.isBinaryExpression(p) && COMPARE.includes(p.operatorToken.kind)) return null;
  if (ts.isJsxExpression(p)) return p.parent && ts.isJsxAttribute(p.parent) ? attrKind(p.parent) : { kind: 'jsx-text', strong: true };
  if (ts.isJsxAttribute(p)) return attrKind(p);
  if (ts.isPropertyAssignment(p)) {
    if (p.name === n) return null;
    const k = p.name.getText(sf).replace(/['"]/g, '');
    if (NON_UI_KEY.has(k) || DATA_KEY.test(k)) return null;
    return { kind: `prop:${k}`, strong: UI_KEY.test(k) };
  }
  if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
    const e = p.expression;
    const name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : '';
    const recv = ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) ? e.expression.text : '';
    const idx = (p.arguments ?? []).indexOf(n);
    if (name === 'fail') return idx >= 1 ? { kind: 'api-error', strong: true } : null;
    if (/^(Error|ApiFailure|HttpError|UserError|ValidationError|ApprovalRefused)$/.test(name)) return { kind: 'error', strong: true };
    if (/^plurali?[sz]?e?$/.test(name)) return { kind: 'plural', strong: true };
    if (/^(toast|notifyFailure|errorMessage|setError|setMessage|setNotice|setInfo|setWarning|setHint)$/.test(name) && !SKIP_RECV.test(recv)) return { kind: `call:${name}`, strong: true };
    if (name === 'audit') return { kind: 'audit', strong: false };
    if (SKIP_CALL.test(name) || SKIP_RECV.test(recv)) return null;
    return { kind: `arg:${name || '?'}`, strong: false };
  }
  if (ts.isVariableDeclaration(p)) return { kind: `const:${p.name.getText(sf).slice(0, 30)}`, strong: false };
  if (ts.isReturnStatement(p) || ts.isArrowFunction(p)) return { kind: 'return', strong: false };
  if (ts.isParameter(p) || ts.isBindingElement(p)) return { kind: 'default', strong: false };
  if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken) return { kind: 'assign', strong: false };
  return { kind: 'other', strong: false };
}

/** Every string in a .ts/.tsx file that people may read: { string, line, kind }. */
export function extractStrings(text, rel) {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const add = (node, s, kind) => out.push({ string: s.replace(/\s+/g, ' ').trim(), line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, kind });
  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const s = node.text.replace(/\s+/g, ' ').trim();
      if (s && /[A-Za-z]/.test(s)) add(node, s, 'jsx-text');
      return;
    }
    if (ts.isTemplateExpression(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const c = classify(node, sf);
      const s = textOf(node, sf);
      if (c && looksHuman(s, c.strong)) add(node, s, c.kind);
      if (ts.isTemplateExpression(node)) node.templateSpans.forEach(sp => visit(sp.expression));
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/* ------------------------------------------------------------------ matching ------------------------------------- */

const caseLike = (from, to) => (from.length > 4 && /^[A-Z]{2,}/.test(from) && from === from.toUpperCase() ? to.toUpperCase()
  : /^[A-Z]/.test(from) ? to.charAt(0).toUpperCase() + to.slice(1) : to);

/** The banned words in one string, each with the rule it breaks and a suggested replacement. */
export function findBanned(s, rel) {
  const hits = [];
  let masked = s;
  for (const k of KEEP) masked = masked.replace(new RegExp(k.source, 'g' + (k.flags.includes('i') ? 'i' : '')), m => '\u0000'.repeat(m.length));
  for (const rule of RULES) {
    if (rule.side === 'rental' && isSupply(rel)) continue;
    for (const b of rule.bad) {
      const re = new RegExp(b.re.source, 'gi');
      for (const m of masked.matchAll(re)) {
        const to = typeof b.to === 'function' ? b.to(m[0]) : b.to;
        hits.push({ word: m[0], index: m.index, rule, to: b.exact ? to : caseLike(m[0], to), note: b.note, how: b.how ?? rule.how ?? 'swap' });
      }
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

export function suggest(s, rel) {
  let out = s;
  for (const h of findBanned(s, rel).reverse()) out = out.slice(0, h.index) + h.to + out.slice(h.index + h.word.length);
  return out;
}

/* ------------------------------------------------------------------ the check ------------------------------------ */

export const def = {
  name: 'vocabulary',
  rule: 'one word per idea: use the word docs/VOCABULARY.md chooses, not its synonyms',
  files: checkedFiles,
  allow,
  scan(text, rel) {
    const hits = [];
    const ok = excusedLines(text);
    for (const s of extractStrings(text, rel)) {
      if (SKIP_KIND.test(s.kind) || ok.has(s.line)) continue;
      for (const h of findBanned(s.string, rel)) {
        hits.push({ line: s.line, msg: `"${h.word}" -> "${h.to}" (${h.rule.term})`, text: s.string.slice(0, 160) });
      }
    }
    return hits;
  },
  selfTest: {
    bad: [
      { path: 'src/pages/X.tsx', text: "export const A = () => <h1>New booking</h1>;" },
      { path: 'src/pages/Y.tsx', text: "toast({ tone: 'success', title: 'Check-out moved.' });" },
      { path: 'functions/api/x.ts', text: "return fail('VALIDATION', 'Set a minimum stay of at least 1 night.', 422);" },
      { path: 'src/pages/Z.tsx', text: "<Field label=\"Gross booking value\" />" },
      { path: 'src/pages/W.tsx', text: "const s = `Sent to the OTA at ${t}`; toast({ title: s });" },
      { path: 'src/pages/V.tsx', text: "<p>Waiting for the webhook.</p>" },
      { path: 'src/pages/U.tsx', text: "// vocab-ok: short\n<p>New booking</p>" },
    ],
    good: [
      { path: 'src/pages/X.tsx', text: "export const A = () => <h1>New reservation</h1>;" },
      { path: 'src/pages/Y.tsx', text: "if (r.state === 'checked_out' || r.channel === 'booking_com') toast({ title: 'Checkout moved.' });" },
      { path: 'src/pages/Z.tsx', text: "<p>Linked to Booking.com. Owner stay blocked 3 nights. Your price stays the same.</p>" },
      { path: 'functions/api/x.ts', text: "await run(env, 'UPDATE reservations SET state = ? WHERE id = ?', s, id);" },
      { path: 'src/pages/SalesOrdersPage.tsx', text: "<h1>Stock adjustments and sales bookings</h1>" },
      { path: 'src/pages/R.tsx', text: "<PdfTitle text=\"Owner Income Report\" /> <span>Payout Before O2 Adjustment</span>" },
      { path: 'src/pages/Q.tsx', text: "// vocab-ok: Booking.com calls it a room on this screen\n<Field label=\"Room\" />" },
    ],
  },
};

/* ------------------------------------------------------------------ reports -------------------------------------- */

const csvCell = s => (/[",\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s));

function inventory() {
  const rows = [];
  for (const rel of uiFiles()) for (const s of extractStrings(read(rel), rel)) rows.push({ ...s, rel });
  return rows;
}

const arg = process.argv.indexOf('--inventory') > 0 ? 'inventory' : process.argv.indexOf('--rename-map') > 0 ? 'rename-map'
  : process.argv.includes('--counts') ? 'counts' : process.argv.includes('--pending') ? 'pending' : null;
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ROOT, 'scripts/checks/vocabulary.mjs');

if (isMain && arg === 'inventory') {
  const out = process.argv[process.argv.indexOf('--inventory') + 1];
  const rows = inventory();
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, ['string,location,kind', ...rows.map(r => [r.string, `${r.rel}:${r.line}`, r.kind].map(csvCell).join(','))].join('\n') + '\n');
  console.log(`${rows.length} strings from ${new Set(rows.map(r => r.rel)).size} files -> ${out}`);
} else if (isMain && arg === 'rename-map') {
  const out = process.argv[process.argv.indexOf('--rename-map') + 1];
  const map = new Map();
  for (const r of inventory()) {
    if (SKIP_KIND.test(r.kind) || allow[r.rel]) continue;
    const hits = findBanned(r.string, r.rel);
    if (!hits.length) continue;
    const key = r.string;
    const e = map.get(key) ?? { old: r.string, new: suggest(r.string, r.rel), terms: new Set(), files: new Set(), how: 'swap' };
    if (hits.some(h => h.how === 'reword')) e.how = 'reword';
    hits.forEach(h => e.terms.add(h.rule.term));
    e.files.add(`${r.rel}:${r.line}`);
    map.set(key, e);
  }
  const rows = [...map.values()].sort((a, b) => [...a.terms][0].localeCompare([...b.terms][0]) || a.old.localeCompare(b.old));
  rows.unshift(...LABEL_ROWS.map(([old, nu, term, file]) => ({ old, new: nu, terms: new Set([term]), how: 'swap', files: new Set([file]) })));
  fs.writeFileSync(out, ['old,new,term,how,decided,files', ...rows.map(e => [e.old, e.new, [...e.terms].join(' + '), e.how, DECIDED, [...e.files].join(' ')].map(csvCell).join(','))].join('\n') + '\n');
  console.log(`${rows.length} distinct strings to change, ${rows.reduce((n, e) => n + e.files.size, 0)} places -> ${out}`);
} else if (isMain && arg === 'counts') {
  const rows = inventory().filter(r => !SKIP_KIND.test(r.kind));
  for (const rule of RULES) {
    const counts = rule.bad.map(b => {
      const re = new RegExp(b.re.source, 'i');
      return [b.re.source, rows.filter(r => !(rule.side === 'rental' && isSupply(r.rel)) && re.test(r.string)).length];
    });
    console.log(`${rule.term} [${rule.source}]: ${counts.map(([w, n]) => `${w}=${n}`).join('  ')}`);
  }
} else if (isMain && arg === 'pending') {
  let n = 0;
  for (const rel of uiFiles().filter(pending)) {
    for (const h of def.scan(read(rel), rel)) { n++; console.log(`${rel}:${h.line}  ${h.msg}\n      ${h.text}`); }
  }
  console.log(`${n} words to change in the files the units-owners rework owns.`);
} else if (isMain) {
  process.exit(runCheck(def) ? 1 : 0);
}
