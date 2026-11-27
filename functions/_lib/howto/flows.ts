/**
 * howto/flows.ts: end-to-end chains (each step is a task guide with its click-by-click steps, the role that does it
 * and the hand-off), and the first-week reading path per role. The Conts and Dream Crafter each get their own flows.
 */
import type { HowToFlow } from './types';

export const FLOWS: HowToFlow[] = [
  {
    id: 'flow-reservation-to-owner-payout',
    title: 'The Conts: a reservation from creation to the owner being paid',
    keywords: ['whole process', 'end to end', 'reservation to payout', 'stay cycle', 'guest to owner', '整个流程', '从订房到付业主', 'proses penuh'],
    summary: 'A guest books, arrives and leaves; the unit is cleaned; the money is recorded; at month end the owner statement is made final, sent and paid.',
    companies: ['conts'],
    steps: [
      { guide: 'create-reservation', role: 'Reservations', handoff: 'A direct guest or a missed channel reservation (channel reservations arrive by themselves).' },
      { guide: 'record-guest-payment', role: 'Finance', handoff: 'The guest paid (or the channel paid the host payout).' },
      { guide: 'check-in-check-out', role: 'Front desk / operations', handoff: 'The check-in day comes; on the checkout day the guest leaves.' },
      { guide: 'assign-cleaning-job', role: 'Cleaning supervisor', handoff: 'Guest out: the cleaning job is ready to clean.' },
      { guide: 'add-maintenance-job', role: 'Operations', handoff: 'The cleaner reports damage, or something breaks.' },
      { guide: 'add-utility-bill', role: 'Finance', handoff: "The month's unit bills arrive." },
      { guide: 'owner-statement-generate', role: 'Finance', handoff: 'Month end: every reservation, payment and cost of the month is in.' },
      { guide: 'owner-payout-run', role: 'Finance', handoff: 'Statements are sent: payouts wait for a run.' },
    ],
  },
  {
    id: 'flow-new-unit-onboarding',
    title: 'The Conts: taking on a new unit from an owner',
    keywords: ['onboard unit', 'new owner and unit', 'take on unit', 'setup unit', '新单位上线', '接新房', 'unit baru'],
    summary: 'Add the owner, add the unit with its contract, price it, and it is ready to be booked; or let it long-term.',
    companies: ['conts'],
    steps: [
      { guide: 'add-owner', role: 'Operations manager / finance', handoff: 'The management agreement is signed.' },
      { guide: 'add-unit', role: 'Operations manager', handoff: 'The owner record exists.' },
      { guide: 'set-nightly-prices', role: 'Revenue manager', handoff: 'The unit exists and is listed on the channels.' },
      { guide: 'block-dates-calendar', role: 'Reservations', handoff: 'Any nights the owner keeps or set-up works.' },
      { guide: 'record-letting', role: 'Operations manager', handoff: 'Only when the owner wants a long-term tenant instead.' },
    ],
  },
  {
    id: 'flow-renovation-project',
    title: 'Dream Crafter: a renovation project from quotation to handover',
    keywords: ['whole renovation process', 'renovation end to end', 'quotation to handover', 'project cycle', '装修整个流程', '从报价到交屋', 'proses renovasi'],
    summary: 'Open the project, quote, convert to the contract, collect the deposit, run design and VOs, buy materials, bill the instalments, fix defects and hand over.',
    companies: ['dream_crafter'],
    steps: [
      { guide: 'dc-create-project', role: 'Sales / project coordinator', handoff: 'A customer wants a renovation.' },
      { guide: 'dc-create-quotation', role: 'Sales / designer', handoff: 'The project exists.' },
      { guide: 'dc-convert-quotation', role: 'Sales', handoff: 'The customer accepted the quotation.' },
      { guide: 'dc-collect-payment', role: 'Finance / sales', handoff: 'The deposit is paid: the project moves to Design.' },
      { guide: 'dc-variation-order', role: 'Sales; approval by Full on Sales order', handoff: 'The customer changes the scope.' },
      { guide: 'dc-purchase-order', role: 'Procurement', handoff: 'Materials and contract work are needed for the site.' },
      { guide: 'dc-bill-instalment', role: 'Finance / salesperson', handoff: 'Each stage in the payment terms is reached.' },
      { guide: 'dc-defects-handover', role: 'Site supervisor', handoff: 'Site work is done.' },
      { guide: 'dc-project-stages', role: 'Project manager', handoff: 'Handed over and fully paid: close the project.' },
    ],
  },
  {
    id: 'flow-procure-to-pay',
    title: 'Dream Crafter: buying from a supplier and paying them',
    keywords: ['procure to pay', 'purchase to payment', 'buy and pay supplier', '采购到付款', 'beli dan bayar'],
    summary: 'Add the supplier, raise the PO, record their invoice, pay it with a voucher.',
    companies: ['dream_crafter'],
    steps: [
      { guide: 'dc-add-supplier', role: 'Procurement', handoff: 'A new supplier or contractor.' },
      { guide: 'dc-purchase-order', role: 'Procurement', handoff: 'The supplier exists.' },
      { guide: 'dc-purchase-invoice', role: 'Finance / procurement', handoff: 'Goods or work delivered and the supplier billed.' },
      { guide: 'dc-pay-supplier', role: 'Finance', handoff: 'The invoice is due.' },
    ],
  },
];

/** First-week reading path per role: guides and flows in order (two a day). */
export const ONBOARDING: Record<string, { title: string; company: 'conts' | 'dream_crafter' | 'both'; path: string[] }> = {
  reservations: { title: 'Reservations / front desk (The Conts)', company: 'conts', path: ['flow-reservation-to-owner-payout', 'create-reservation', 'check-in-check-out', 'change-or-cancel-reservation', 'block-dates-calendar', 'review-guest-airbnb', 'reply-mail-center', 'hand-in-claim'] },
  operations: { title: 'Operations, cleaning and maintenance (The Conts)', company: 'conts', path: ['check-in-check-out', 'assign-cleaning-job', 'add-maintenance-job', 'block-dates-calendar', 'flow-new-unit-onboarding', 'record-letting', 'hand-in-claim'] },
  finance: { title: 'Finance (The Conts)', company: 'conts', path: ['flow-reservation-to-owner-payout', 'record-guest-payment', 'add-utility-bill', 'owner-statement-generate', 'owner-payout-run', 'add-owner', 'hand-in-claim'] },
  'renovation-sales': { title: 'Renovation sales (Dream Crafter)', company: 'dream_crafter', path: ['flow-renovation-project', 'dc-create-project', 'dc-create-quotation', 'dc-convert-quotation', 'dc-variation-order', 'dc-collect-payment', 'dc-commission'] },
  'renovation-project': { title: 'Renovation project coordinator / site (Dream Crafter)', company: 'dream_crafter', path: ['flow-renovation-project', 'dc-create-project', 'dc-project-stages', 'dc-defects-handover', 'dc-purchase-order', 'hand-in-claim'] },
  'renovation-finance': { title: 'Renovation finance and procurement (Dream Crafter)', company: 'dream_crafter', path: ['flow-procure-to-pay', 'dc-add-supplier', 'dc-purchase-order', 'dc-purchase-invoice', 'dc-pay-supplier', 'dc-bill-instalment', 'dc-collect-payment', 'dc-commission'] },
};
