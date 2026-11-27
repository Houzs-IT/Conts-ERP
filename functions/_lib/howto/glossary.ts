/**
 * howto/glossary.ts: terms staff meet in the ERP (short-stay rental, owner money, renovation). `labels` are the exact
 * words on screen and are checked against the frontend; aliases include the industry words staff type (ADR, RevPAR,
 * OTA...) even where the ERP's own screens use plain words (docs/VOCABULARY.md).
 */
import type { HowToTerm } from './types';

export const GLOSSARY: HowToTerm[] = [
  // ── short stay ──────────────────────────────────────────────────────────────
  { term: 'Reservation', aliases: ['booking'], keywords: ['订单', '订房', 'tempahan'], company: 'conts', labels: ['Reservations'], page: '/reservations/bookings', guides: ['create-reservation'], // vocab-ok: glossary alias staff type
    definition: "One guest's stay in one unit, from a channel (Airbnb, Booking.com, Agoda) or direct. The ERP says reservation, never booking." },
  { term: 'Channel', aliases: ['OTA', 'booking site', 'platform'], keywords: ['渠道', '平台'], company: 'conts', labels: ['Channel'], guides: ['create-reservation'], // vocab-ok: glossary aliases staff type
    definition: 'Where a reservation comes from: Airbnb, Booking.com, Agoda, or direct. The industry word is OTA (online travel agency).' },
  { term: 'Guest total', aliases: ['GBV', 'gross booking value'], keywords: ['客人付的'], company: 'conts', labels: ['Guest total'], // vocab-ok: glossary aliases
    definition: 'What the guest pays for the whole reservation, before the channel takes its service fee.' },
  { term: 'Service fee', aliases: ['channel commission', 'OTA commission'], keywords: ['佣金', '平台费'], company: 'conts', labels: ['Service fee'], // vocab-ok: glossary aliases
    definition: 'What the channel keeps from a reservation (Airbnb, Booking.com, Agoda).' },
  { term: 'Host payout', aliases: ['channel payout', 'OTA payout'], keywords: ['平台打款'], company: 'conts', labels: ['Host payout'], guides: ['record-guest-payment'], // vocab-ok: glossary aliases
    definition: 'What the channel pays The Conts for a reservation: guest total less the service fee. Recorded on the reservation when it arrives.' },
  { term: 'ADR', aliases: ['average daily rate', 'average nightly price', 'avg nightly price'], keywords: ['平均房价'], company: 'conts', labels: ['Avg nightly price'], page: '/portfolio', // vocab-ok: industry word staff type
    definition: 'Average nightly price: reservation income divided by the nights sold in the period. The ERP shows it as "Avg nightly price".' },
  { term: 'RevPAR', aliases: ['revenue per available room', 'earnings per available night'], keywords: ['每间可售房收入'], company: 'conts', labels: ['Earnings per night (all nights)'], page: '/portfolio', // vocab-ok: industry word staff type
    definition: 'Earnings per available night: income divided by every night the unit could be sold (booked or not) = average nightly price x occupancy.' },
  { term: 'Occupancy', aliases: ['occupancy rate', 'occ'], keywords: ['入住率'], company: 'conts', labels: ['Occupancy'], page: '/portfolio',
    definition: 'Nights sold divided by nights available in the period, as a percentage. Owner stays and blocks are not sold nights.' },
  { term: 'Check-in / Checkout', aliases: ['check in', 'check out', 'arrival', 'departure'], keywords: ['入住', '退房'], company: 'conts', labels: ['Check-ins', 'Checkouts', 'Guest arrived', 'Guest left'], page: '/operations/today', guides: ['check-in-check-out'], // vocab-ok: glossary aliases
    definition: 'The day a guest arrives / leaves. On Today, "Guest arrived" checks them in and "Guest left" tells the cleaners the unit is free.' },
  { term: 'Currently hosting', aliases: ['in house', 'checked in'], keywords: ['在住'], company: 'conts', labels: ['Currently hosting'],
    definition: 'A reservation whose guest has checked in and not yet left.' },
  { term: 'Owner stay', aliases: ['owner block'], keywords: ['业主自住'], company: 'conts', labels: ['Owner stay'], guides: ['create-reservation', 'block-dates-calendar'],
    definition: 'Nights the owner (or someone they send) uses their own unit: held on the calendar, earns nothing.' },
  { term: 'Blocked nights', aliases: ['block', 'closed dates', 'stop sell'], keywords: ['封房'], company: 'conts', labels: ['Block nights'], page: '/reservations/calendar', guides: ['block-dates-calendar'], // vocab-ok: glossary alias
    definition: 'Nights nobody can book on any channel (repair, owner stay, other).' },
  { term: 'Minimum nights', aliases: ['min stay'], keywords: ['最少晚数'], company: 'conts', labels: ['Minimum nights'], // vocab-ok: glossary alias
    definition: 'The fewest nights a reservation may have on those dates.' },
  { term: 'Nightly price', aliases: ['rate', 'base price', 'weekend price', 'holiday price'], keywords: ['房价'], company: 'conts', labels: ['Nightly price', 'Weekend price', 'Holiday price'], page: '/performance/pricing', guides: ['set-nightly-prices'], // vocab-ok: glossary alias
    definition: 'Price of one night: nightly (Sun to Thu), weekend (Fri and Sat), holiday (public holidays). A custom price set on the Calendar wins over all three.' },
  { term: 'Cleaning job', aliases: ['turnover', 'housekeeping', 'BC', 'DC'], keywords: ['清洁单'], company: 'conts', labels: ['Basic clean (BC)', 'Deep clean (DC)'], page: '/operations/cleaning', guides: ['assign-cleaning-job'],
    definition: 'One cleaning of one unit. Planned by itself for every checkout; BC = basic clean, DC = deep clean.' },
  { term: 'Maintenance job', aliases: ['repair', 'work order'], keywords: ['维修单'], company: 'conts', labels: ['Add maintenance job'], page: '/operations/maintenance', guides: ['add-maintenance-job'], // vocab-ok: glossary alias staff type
    definition: 'A repair on a unit or in the building, from report to done, with who pays and its final cost.' },
  { term: 'Pass key', aliases: ['door code', 'access code'], keywords: ['门锁密码'], company: 'conts', labels: ['Pass key'], page: '/properties/pass-keys',
    definition: "A unit's door / access codes. Seen only by people given Pass key; Full on it also reveals the codes." },
  // ── owner money ─────────────────────────────────────────────────────────────
  { term: 'Owner statement', aliases: ['owner income report', 'monthly statement'], keywords: ['业主报表', '对账单'], company: 'conts', labels: ['Owner statements', 'Owner Income Report'], page: '/owners/statements', guides: ['owner-statement-generate'], // vocab-ok: glossary alias staff type
    definition: "An owner's month: income by night, cleaning, bills and deductions, the contract split, Owner Adjustments, and the Net Payout to Owner. Draft, then Final, then sent." },
  { term: 'Net Payout to Owner', aliases: ['owner payout amount'], keywords: ['业主应得'], company: 'conts', labels: ['Net Payout to Owner'],
    definition: "The final line of an owner statement: what the owner is paid for the month." },
  { term: 'To Operator', aliases: ['management fee', 'operator share'], keywords: ['管理费'], company: 'conts', labels: ['To Operator'], // vocab-ok: glossary alias staff type
    definition: "The Conts' share of the income under the unit's contract (the operator share)." },
  { term: 'Owner Adjustments', aliases: ['adjustment'], keywords: ['调整'], company: 'conts', labels: ['Owner Adjustments'],
    definition: 'Credits and charges to the owner after the split, e.g. a refund of a cost or an extra charge.' },
  { term: 'Deductions', aliases: ['owner deductions'], keywords: ['扣款'], company: 'conts', labels: ['Deductions'], page: '/properties/deductions',
    definition: "Costs taken off the owner's income on the statement (bills, cleaning, repairs, other)." },
  { term: 'GRR', aliases: ['guaranteed rent', 'guaranteed rental return'], keywords: ['保证租金'], company: 'conts', labels: ['Guaranteed rent', 'GRR'],
    definition: 'A contract where the owner gets a fixed rent each month whatever the unit earns.' },
  { term: 'Payout run', aliases: ['owner payout', 'start payout run'], keywords: ['付业主'], company: 'conts', labels: ['Start payout run', 'Owner payouts'], page: '/owners/payouts', guides: ['owner-payout-run'],
    definition: 'A batch of owner payouts transferred together: started in the ERP, transferred at the bank, then marked paid.' },
  { term: 'Make final', aliases: ['finalise', 'lock statement'], keywords: ['定稿', '锁定'], company: 'conts', labels: ['Mark final'], guides: ['owner-statement-generate'],
    definition: "Locks an owner statement: nothing more can be added to that month for the unit. A power given person by person; unlocking is another (Unlock final)." },
  { term: 'Letting', aliases: ['agent to let', 'tenancy', 'long-term rental'], keywords: ['出租', '长租'], company: 'conts', labels: ['Agent to let'], page: '/properties/agent-to-let', guides: ['record-letting'],
    definition: "A unit The Conts lets to a long-term tenant on the owner's behalf, for an agent fee." },
  { term: 'Sen vs RM', aliases: ['sen', 'ringgit'], keywords: ['仙'], company: 'both', labels: ['Amount (RM)'],
    definition: 'Screens show RM with two decimals; the system stores money in sen (RM x 100), so RM 12.50 is 1250 sen in exports and the AI Connector\'s raw reads.' },
  // ── renovation (Dream Crafter) ──────────────────────────────────────────────
  { term: 'Quotation', aliases: ['quote', 'renovation quotation', 'revision'], keywords: ['报价单'], company: 'dream_crafter', labels: ['New Quotation', 'Convert to sales order'], page: '/sales/quotations', guides: ['dc-create-quotation'],
    definition: 'The priced renovation proposal, room by room, with payment terms. Each change after sending is a new revision (R1, R2...). Accepted, it converts to the sales order.' }, // vocab-ok: rooms of a renovation, not rental units
  { term: 'Sales order (contract)', aliases: ['contract', 'renovation sales order', 'SO'], keywords: ['合约', '销售单'], company: 'dream_crafter', labels: ['Progress billing', 'Variation orders'], page: '/sales/orders', guides: ['dc-convert-quotation'],
    definition: 'The renovation contract made from the accepted quotation: billing, purchasing, VOs, commission and the project stages run on it.' }, // vocab-ok: renovation sales commission, not the channel fee
  { term: 'VO', aliases: ['variation order', 'variation', 'add and omit'], keywords: ['加减单', '变更'], company: 'dream_crafter', labels: ['New VO', 'Approve and apply'], page: '/sales/amendments', guides: ['dc-variation-order'],
    definition: 'Variation order: work added to or omitted from a signed contract, signed by the customer and applied by someone with Full on Sales order. It changes the contract sum.' },
  { term: 'Progress billing', aliases: ['instalment', 'progress claim', 'payment terms'], keywords: ['进度款'], company: 'dream_crafter', labels: ['Progress billing', 'Bill this instalment'], guides: ['dc-bill-instalment'],
    definition: "The contract's payment schedule: each instalment is billed in order, at least what the schedule asks and at most the rest of the contract." },
  { term: 'Project stages', aliases: ['signed', 'design', 'ordering', 'renovation', 'handover', 'closed'], keywords: ['项目阶段'], company: 'dream_crafter', labels: ['Project stages'], page: '/projects/list', guides: ['dc-project-stages'],
    definition: 'Signed > Design > Ordering > Renovation > Handover > Closed, each moved by a fact: sales order and first payment, design steps, a VO, every category complete, handover signed, closed and fully paid.' },
  { term: 'Defect', aliases: ['snag', 'touch-up'], keywords: ['缺陷', '补修'], company: 'dream_crafter', labels: ['Report a problem'], page: '/projects/defects', guides: ['dc-defects-handover'],
    definition: 'A problem found on site after the work: To fix > Check > Done. Every defect must be closed before handover.' },
  { term: 'Handover', aliases: ['hand over', 'key handover'], keywords: ['交屋'], company: 'dream_crafter', labels: ['Hand over'], guides: ['dc-defects-handover'],
    definition: "Giving the finished unit back to the customer, with their signature and the number of keys." },
  { term: 'Project brand', aliases: ['brand', 'letterhead', 'in-house renovation'], keywords: ['品牌'], company: 'dream_crafter', labels: ['Brand'], guides: ['dc-create-project'],
    definition: "Dream Crafter or The Conts on a renovation project and its quotation: the letterhead and the finance type (The Conts = in-house renovation of units it manages)." },
  { term: 'Commission', aliases: ['sales commission', 'my commission'], keywords: ['佣金', '提成'], company: 'dream_crafter', labels: ['My commission', 'Record payout'], page: '/supply/my-commission', guides: ['dc-commission'], // vocab-ok: renovation sales commission, not the channel fee
    definition: "A salesperson's share of their renovation contracts: tier rate by the month's sales (VOs count in their month), released in stages as the customer pays." },
  { term: 'PO', aliases: ['purchase order'], keywords: ['采购单'], company: 'dream_crafter', labels: ['New Purchase Order'], page: '/procurement/purchase-orders', guides: ['dc-purchase-order'],
    definition: 'An order to one supplier or contractor; goods are received against it and the supplier invoice matched to it.' },
  { term: 'Purchase invoice', aliases: ['PI', 'supplier invoice'], keywords: ['供应商发票'], company: 'dream_crafter', labels: ['New Purchase Invoice'], page: '/procurement/purchase-invoices', guides: ['dc-purchase-invoice'],
    definition: "The supplier's bill recorded in the ERP: what the company owes them." },
  { term: 'Payment voucher', aliases: ['PV'], keywords: ['付款单'], company: 'both', labels: ['New Payment Voucher'], page: '/finance/payment-vouchers', guides: ['dc-pay-supplier'],
    definition: 'The record of a payment out to a supplier or contractor; checked, approved and posted by Full on the Ledger.' },
  { term: 'Claim', aliases: ['expense claim', 'reimbursement', 'direct pay'], keywords: ['报销'], company: 'both', labels: ['My claims', 'Hand in'], page: '/my-claims', guides: ['hand-in-claim'],
    definition: 'Money you paid for the company and want back (Claim to me), or a request for finance to pay a supplier directly (Direct pay).' },
];
