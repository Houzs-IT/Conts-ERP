/**
 * howto/guidesContsGrowth.ts: process help for pricing, guest reviews, Mail Center and staff claims. Written from:
 *   src/pages/PricingPage.tsx + src/pages/pricing/{UnitPrices,BatchEdit,types}.tsx (Unit prices, channel price rules)
 *   src/pages/ReviewsPage.tsx + src/pages/reviews/GuestReviews.tsx (Review guests on Airbnb)
 *   engine/frontend/src/pages/MailCenter/{Inbox,Thread,Compose}.tsx (Mail Center, an engine screen inside the ERP)
 *   src/pages/MyClaimsPage.tsx (My claims: Hand in)
 * and the handlers (functions/api/rates, reviews/guest-reviews/*, claims proxy to the engine). Mail Center and My
 * claims are the same screens for The Conts and Dream Crafter, so those two guides carry both companies.
 */
import type { HowToGuide } from './types';

export const GUIDES: HowToGuide[] = [
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'set-nightly-prices',
    title: "Set a unit's nightly, weekend and holiday prices",
    keywords: ['set price', 'nightly price', 'weekend price', 'holiday price', 'pricing', 'rate', 'change price', 'channel price', '定价', '改价格', '房价', '周末价', '假日价', 'harga', 'tukar harga'],
    module: 'Pricing',
    companies: ['conts'],
    purpose: 'Set what a unit sells for per night on the direct site and on each channel; the channels are updated by themselves.',
    prerequisites: ['The unit is a rental unit (showrooms and warehouses are not priced).', 'You have Full access on Pricing.'],
    who: 'Pricing manager.',
    // functions/api/rates/index.ts:31 — session.manage on Pricing (Full); :37 rental units only
    permission: ['PUT /api/rates', 'area:pricing:full'],
    page: '/performance/pricing',
    sidebar: 'GROWTH > Pricing',
    steps: [
      { do: 'Open GROWTH > Pricing, keep the "Unit prices" tab, and pick the unit ("Search units" or "Building").', highlight: 'Unit prices' },
      {
        do: 'In the "Prices per channel" table click the Direct price to change it and type the new amount.',
        fields: [
          // functions/api/rates/index.ts:43 — nightly above RM 0.00
          { label: 'Nightly price', required: true, value: 'Sun to Thu nights, above RM 0.00.', example: "'280.00'" },
          // functions/api/rates/index.ts:54 — weekend above 0 or empty (then the nightly price)
          { label: 'Weekend price', required: false, value: 'Fri and Sat nights, above RM 0.00, or empty to use the nightly price.', example: "'340.00'" },
          // functions/api/rates/index.ts:69
          { label: 'Holiday price', required: false, value: 'Public holidays, above RM 0.00, or empty to use the weekend or nightly price.', example: "'420.00'" },
        ],
        then: 'The price saves when you leave the box; the channels follow by their rule.',
      },
      {
        do: "To change how a channel follows the direct price, click that channel's rule and choose under \"How it is priced\", then \"Save\".",
        check: 'A percentage is 0 to 300%. "Fixed" gives the channel its own nightly, weekend and holiday price.',
      },
      { do: 'Many units at once: use the "Batch edit" tab, pick the units, "Add a change", then "Preview" and apply.', highlight: 'Batch edit' },
    ],
    checkBefore: ['The right unit.', 'The Holiday price is above the weekend price.'],
    result: 'New prices apply to nights without a custom Calendar price; channels are updated (failed updates show under "Failed updates").',
    warnings: ['Prices go to Airbnb, Booking.com and Agoda straight away.', 'A night with a custom price on the Calendar keeps it.'],
    undo: 'Type the old price back in the same box.',
    commonMistakes: [{ mistake: 'Changing the Airbnb price directly and expecting the direct price to follow.', fix: 'The direct price is the base; channels follow it unless their rule is "Fixed".' }],
    workedExample: "Raise 'Vertica A-12-03' to RM 280 a night and RM 340 at weekends: Pricing > Unit prices > A-12-03 > Direct Nightly price 280.00 > Weekend price 340.00.",
    related: ['block-dates-calendar', 'add-unit'],
    contact: 'Pricing manager / management.',
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'review-guest-airbnb',
    title: 'Review a guest on Airbnb after checkout',
    keywords: ['review guest', 'guest review', 'write a review', 'airbnb review', 'bad guest', 'reviews', '评价客人', '写评价', '差评客人', 'ulasan tetamu'],
    module: 'Reviews',
    companies: ['conts'],
    purpose: "Write (or approve) The Conts' review of an Airbnb guest within Airbnb's review window, or hold a bad guest's review.",
    prerequisites: [
      // functions/api/reviews/guest-reviews/index.ts:52,55 — Airbnb only; window must be open
      'An Airbnb reservation whose review window is still open (only Airbnb lets hosts review guests).',
    ],
    who: 'Operations and management.',
    // functions/api/reviews/guest-reviews/index.ts:46 — operations and management
    permission: ['POST /api/reviews/guest-reviews'],
    page: '/performance/reviews',
    sidebar: 'GROWTH > Reviews',
    steps: [
      { do: 'Open GROWTH > Reviews and choose "Review guests".', highlight: 'Review guests' },
      {
        do: 'On the guest\'s reservation click "Write a review" (or "Approve and send" when a rule already wrote it).',
        highlight: 'Write a review',
        fields: [
          { label: 'Public review', required: true, value: 'What other hosts see on Airbnb.', example: "'Jane left the unit spotless. Welcome back any time.'" },
          { label: 'Private note', required: false, value: 'Only the guest sees it.', example: "'Thank you for the kind note.'" },
        ],
        then: 'The review is sent to Airbnb through Channex.',
      },
      { do: 'For a problem guest click "Bad guest": their review is held and sent late.', highlight: 'Bad guest' },
    ],
    checkBefore: ['The scores and wording are fair and factual.'],
    result: 'The review shows sent; on the Overview the guest\'s score is recorded.',
    warnings: ['A sent review cannot be changed: Airbnb publishes it.'],
    undo: 'Before it is sent: "Edit" or "Drop". After it is sent: not possible.',
    commonMistakes: [{ mistake: 'Waiting too long: the window closes.', fix: 'Review within Airbnb\'s window; "Auto rules" can write good reviews by themselves.' }],
    workedExample: "Jane Tan checked out yesterday: Reviews > Review guests > her reservation > Write a review > Public review 'Jane left the unit spotless.' > send.",
    related: ['check-in-check-out'],
    contact: 'Operations manager.',
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'reply-mail-center',
    title: 'Reply to or send an email from Mail Center',
    keywords: ['mail center', 'email', 'reply email', 'send email', 'shared inbox', 'compose', '邮件', '回邮件', '发邮件', '邮箱', 'emel', 'balas emel'],
    module: 'Mail Center',
    companies: ['conts', 'dream_crafter'],
    purpose: "Answer emails in the company's shared mailboxes and send new ones, so every reply is kept with the conversation.",
    prerequisites: ['Mail Center access (Users and roles > Permissions, Mail).', 'A mailbox you may read and send from (set per mailbox under Mailboxes).'],
    who: 'Anyone given Mail Center access.',
    // engine/backend/src/conts/access.ts:132 — Mail at view gives mail_center.read; what each person reads and sends is set per mailbox
    permission: ['area:mail:view'],
    page: '/mail',
    sidebar: 'MAIL > Mail center',
    steps: [
      { do: 'Open MAIL > Mail center and click the email in the inbox.', then: 'The conversation opens on the right.' },
      { do: 'Click "Reply" at the top of the conversation.', highlight: 'Reply', then: 'The reply box opens under the conversation.' },
      { do: 'Type your answer (attach files if needed) and click "Send reply".', highlight: 'Send reply', check: 'The From mailbox and the recipient are right; "Reply all" fills Cc only when you click it.' },
      { do: 'To start a new email click the compose button ("Compose new email"), fill To, subject and text, then "Send".' },
    ],
    checkBefore: ['The right mailbox and recipients.', 'Attachments are the right files.'],
    result: 'The email is sent and kept in the conversation; "Archive (mark done)" moves it out of the inbox.',
    warnings: ['"Send reply" sends the email straight away.'],
    undo: 'A sent email cannot be recalled; send a correction.',
    commonMistakes: [{ mistake: 'Replying from a personal mailbox for a company matter.', fix: 'Pick the shared mailbox as the sender.' }],
    workedExample: "A guest asks for parking: Mail center > the email > Reply > 'Parking is at level P3, bay 12.' > Send reply > Archive (mark done).",
    related: ['hand-in-claim'],
    contact: 'Your supervisor, or IT Support for mailbox access.',
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'hand-in-claim',
    title: 'Hand in a receipt to claim money back, or ask finance to pay a supplier',
    keywords: ['claim', 'my claims', 'expense claim', 'reimbursement', 'hand in receipt', 'petty cash', 'direct pay', 'pay supplier request', '报销', '报账', '收据报销', '零用钱', 'tuntutan', 'resit tuntutan'],
    module: 'My claims',
    companies: ['conts', 'dream_crafter'],
    purpose: 'Get money back for something you paid for the company (a claim), or ask finance to pay a supplier directly (direct pay).',
    prerequisites: ['The receipt, invoice or quotation (photos or a PDF).'],
    who: 'Every staff member.',
    // functions/api/claims/[[path]].ts proxies to the engine as the signed-in person (claimsAssertion); no permission area
    permission: ['POST /api/claims/receipts'],
    page: '/my-claims',
    sidebar: 'HOME > My claims',
    steps: [
      { do: 'Open HOME > My claims and the "Hand in" tab.', highlight: 'Hand in' },
      {
        do: 'Under "Hand in as" choose "Claim to me" (you paid) or "Direct pay" (finance pays a supplier).',
        fields: [{ label: 'Hand in as', required: true, value: '"Claim to me" or "Direct pay".', example: "'Claim to me'" }],
      },
      {
        do: 'Claim to me: add the receipt, then check the date, amount and shop it read.',
        fields: [
          { label: 'Paid back by', required: false, value: '"Petty cash" or "Finance, by transfer" (only when your department keeps petty cash).', example: "'Finance, by transfer'" },
          { label: 'Date on the receipt', required: true, value: 'Not in the future.', example: "'2026-11-26'" },
          { label: 'Amount', required: true, value: 'The receipt total in RM.', example: "'86.40'" },
          { label: 'Shop (optional)', required: false, value: 'Where you bought it.', example: "'Mr DIY Mid Valley'" },
        ],
      },
      {
        do: 'Direct pay: pick the supplier (and its PO if any), add the invoice or quotation and check the total.',
        fields: [
          { label: 'Purchase order (optional)', required: false, value: "The supplier's PO; picking it fills the bill total.", example: "'PO-2611-014'" },
          { label: 'Bill or quotation total', required: true, value: 'The full amount.', example: "'2,450.00'" },
          { label: 'Deposit % (optional)', required: false, value: 'To pay a deposit only.', example: "'50'" },
          { label: 'Pay by (optional)', required: false, value: 'When the supplier must be paid; today or later.', example: "'2026-12-05'" },
        ],
      },
      {
        do: 'Under "What it was for" fill the line(s), add "Anything finance should know (optional)", then click "Hand in" (or "Send to finance" for direct pay).',
        check: 'When there are several lines they must add up to the amount.',
        then: 'It appears under "Mine" with its number; finance checks and pays it.',
      },
    ],
    checkBefore: ['The amount read from the receipt is right.', 'Your bank account under "Paid back to" is right for a transfer.'],
    result: 'A claim or payment request waiting for finance under "Mine"; you see when it is paid.',
    warnings: ['Renovation lines may first go to a reviewer before finance.'],
    undo: 'Under "Mine" use "Withdraw" while finance has not acted; a rejected or withdrawn one can be changed with "Edit and resubmit".',
    commonMistakes: [{ mistake: 'Handing in the same receipt twice.', fix: 'Check "Mine" first; withdraw the duplicate.' }],
    workedExample: "You paid RM 86.40 at Mr DIY for unit supplies: My claims > Hand in > Claim to me > add the receipt photo > Date 2026-11-26 > Amount 86.40 > Shop 'Mr DIY Mid Valley' > line > Hand in.",
    related: ['reply-mail-center'],
    contact: 'Finance.',
  },
];
