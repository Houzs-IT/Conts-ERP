/**
 * howto/guidesContsOwners.ts: process help for The Conts' units, owners and owner money: add an owner, add a unit,
 * record a long-term letting, add a utility bill, generate / finalise / send owner statements, and pay owners.
 * Written from the real screens:
 *   src/pages/OwnersPage.tsx + src/pages/owners/shared.tsx (Add owner)
 *   src/pages/UnitsPage.tsx + src/pages/units/AddUnitPage.tsx, addUnitRules.ts (Add unit: Listing, Type and size, Contract)
 *   src/pages/LettingsPage.tsx + src/pages/units/LettingTab.tsx (Agent to let)
 *   src/pages/ExpensesPage.tsx + src/components/AddUtilityBill.tsx + src/pages/owners/Costs.tsx BillModal
 *   src/pages/StatementsPage.tsx, StatementDetailPage.tsx (Owner statements)
 *   src/pages/PayoutsPage.tsx (Owner payouts, Start payout run)
 * and the handlers (functions/api/owners, units, lettings, expenses, statements/*, payouts/*). Rules cited beside the
 * text in code comments.
 */
import type { HowToGuide } from './types';

export const GUIDES: HowToGuide[] = [
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'add-owner',
    title: 'Add a unit owner (with their bank account)',
    keywords: ['add owner', 'new owner', 'owner bank account', 'landlord', '新业主', '加业主', '业主资料', 'pemilik baru', 'tambah pemilik'],
    module: 'Owners',
    companies: ['conts'],
    purpose: 'Create the owner record that units, contracts, owner statements and payouts hang on.',
    prerequisites: ["The owner's name as on their IC or passport.", 'Optional: email, phone, IC number and bank account (can be added later).'],
    who: 'Management, finance and operations managers.',
    // functions/api/owners/index.ts:153 — session.manage: Full on Owners (or management)
    permission: ['POST /api/owners', 'area:owners:full'],
    page: '/owners',
    sidebar: 'UNITS > Owners',
    steps: [
      { do: 'Open UNITS > Owners and click "Add owner".', highlight: 'Add owner', then: 'The "Add owner" window opens.' },
      {
        do: 'Fill the owner details.',
        fields: [
          // functions/api/owners/index.ts:157 — name required
          { label: 'Owner name', required: true, value: "The owner's name as on their IC or passport.", example: "'Lim Chee Keong'" },
          // functions/api/owners/index.ts:158,161 — valid email, not used by another owner
          { label: 'Email', required: false, value: 'Must look like an email and not be used by another owner. Used for the owner portal.', example: "'chee.keong@gmail.com'" },
          { label: 'Phone', required: false, value: 'A valid phone number.', example: "'+60 12-888 1234'" },
          { label: 'IC / passport number', required: false, value: 'Malaysian IC or a passport number.', example: "'900101-14-1234'" },
          { label: 'Bank', required: false, value: 'Choose the bank. Needed before the owner can be paid.', example: "'Maybank'" },
          // src/pages/owners/shared.tsx:266 — digits only, 6 to 20
          { label: 'Account number', required: false, value: 'Digits only, 6 to 20 of them; spaces and dashes are fine.', example: "'5140 1234 5678'" },
          { label: 'Account holder', required: false, value: 'Only when "The account is in the owner\'s name" is unticked: the name printed on the bank account.', example: "'Lim Holdings Sdn Bhd'" },
        ],
      },
      { do: 'Click "Add owner" at the bottom.', highlight: 'Add owner', then: 'The owner appears in the list; open them to link units and set the contract.' },
    ],
    checkBefore: ['Name spelled as on the IC.', 'Bank account number checked digit by digit.'],
    result: 'A new owner on UNITS > Owners, ready to have units linked and a contract set.',
    warnings: ['Payouts go to the bank account on this record: a wrong digit sends money to the wrong account.'],
    undo: 'Open the owner and click "Edit" to correct the details ("Edit owner details").',
    commonMistakes: [{ mistake: 'Adding the same owner twice with a different email.', fix: 'Search the owner list first ("Search owners"); an email already in use is refused.' }],
    workedExample: "Owner 'Lim Chee Keong' with Maybank account 5140 1234 5678: Owners > Add owner > Owner name 'Lim Chee Keong' > Email 'chee.keong@gmail.com' > Bank 'Maybank' > Account number '5140 1234 5678' > Add owner.",
    related: ['add-unit', 'owner-statement-generate'],
    nextStep: 'Add their unit and its contract (add-unit).',
    contact: 'Operations manager / finance.',
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'add-unit',
    title: 'Add a new unit and its management contract',
    keywords: ['add unit', 'new unit', 'onboard unit', 'new listing', 'management contract', '加单位', '新单位', '新房源', '合约', 'unit baru', 'tambah unit'],
    module: 'Units',
    companies: ['conts'],
    purpose: 'Put a new unit into the system with its building, owner, layout and the contract that decides the owner split.',
    prerequisites: ['The owner exists (add-owner).', 'The building exists, or you add it from the form.'],
    who: 'Management, finance and operations managers.',
    // functions/api/units/index.ts:58 — session.manage (Full on Units, or management)
    permission: ['POST /api/units', 'area:properties:full'],
    page: '/properties/units',
    sidebar: 'UNITS > Units',
    steps: [
      { do: 'Open UNITS > Units and click "Add unit".', highlight: 'Add unit', then: 'The "Add unit" page opens with three steps: "Listing", "Type and size", "Contract". Nothing is saved until the last step.' },
      {
        do: 'Step "Listing": pick the owner and fill the listing details, then click "Next".',
        page: '/properties/units/new',
        fields: [
          { label: 'Owner', required: false, value: 'Pick the owner. Without one the contract step is skipped (add it on the Contract tab later).', example: "'Lim Chee Keong'" },
          { label: 'Listing name', required: true, value: 'Exactly as published on the channels.', example: "'Cosy 2BR KLCC view'" },
          // functions/api/units/index.ts:71 — code unique in the building
          { label: 'Unit code', required: true, value: 'Building prefix plus unit, created by The Conts; must be new in that building.', example: "'VT-A-12-03'" },
          // functions/api/units/index.ts:63,66 — building required and must exist
          { label: 'Building', required: true, value: 'Pick the building (or add it).', example: "'Vertica'" },
          { label: 'Purpose', required: true, value: 'What the unit is for (only rental units take reservations).', example: "'Rental'" },
        ],
      },
      {
        do: 'Step "Type and size": type, bedrooms, bathrooms, size, beds and car park bays, then click "Next".',
        page: '/properties/units/new',
        fields: [
          { label: 'Bedrooms', required: false, value: '0 = studio; blank saves as 1.', example: "'2'" },
          { label: 'Bathrooms', required: false, value: 'Blank saves as 1.', example: "'2'" },
          { label: 'Size (sq ft)', required: false, value: 'Size in square feet.', example: "'850'" },
        ],
      },
      {
        do: 'Step "Contract": pick the "Package" and fill the boxes it asks for, then click "Add unit".',
        page: '/properties/units/new',
        highlight: 'Add unit',
        then: 'The unit is created and its contract saved. If the contract fails, the page says "The unit is added. Only its contract is left to save." and the button becomes "Save contract".',
      },
    ],
    checkBefore: ['The unit code is not already used in that building.', 'The package and split match the signed agreement.'],
    result: 'The unit appears in UNITS > Units with its owner and contract; it can be priced, booked and appears on owner statements.',
    warnings: ["The contract decides the owner's share on every statement: check it against the signed agreement."],
    undo: "Open the unit and change its details or its Contract tab. The owner's name, IC and bank are changed on the owner's page, not the unit.",
    commonMistakes: [{ mistake: "Typing the owner's bank details on the unit.", fix: "They live on the owner: pick the owner, and edit the bank on the owner's page." }],
    workedExample: "Unit A-12-03 at Vertica for owner Lim Chee Keong: Units > Add unit > Owner 'Lim Chee Keong' > Listing name 'Cosy 2BR KLCC view' > Unit code 'VT-A-12-03' > Building 'Vertica' > Purpose rental > Next > Bedrooms 2 > Next > Package > Add unit.",
    related: ['add-owner', 'set-nightly-prices', 'record-letting'],
    contact: 'Operations manager.',
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'record-letting',
    title: 'Record a unit we let long-term for its owner (Agent to let)',
    keywords: ['agent to let', 'letting', 'tenancy', 'tenant', 'long term rental', 'rent out', '出租', '长租', '租客', '租约', 'sewa', 'penyewa', 'perjanjian sewa'],
    module: 'Units',
    companies: ['conts'],
    purpose: "Track a unit we are finding a long-term tenant for on the owner's behalf: tenant, agreement dates, rent and our agent fee, with a reminder before it ends.",
    prerequisites: ['The unit exists.'],
    who: 'Management, finance and operations managers.',
    // functions/api/lettings/index.ts:44 — session.manage
    permission: ['POST /api/lettings', 'area:agentToLet:full'],
    page: '/properties/agent-to-let',
    sidebar: 'UNITS > Units > Agent to let',
    steps: [
      { do: 'Open UNITS > Units, the "Agent to let" tab, and click "Record a unit to let".', highlight: 'Record a unit to let', then: 'The "Record a unit to let" window opens.' },
      {
        do: 'Fill the letting.',
        fields: [
          // functions/api/lettings/index.ts:47,51
          { label: 'Unit', required: true, value: 'Search and pick the unit.', example: "'Vertica A-12-03'" },
          { label: 'Status', required: true, value: '"Looking for a tenant", "Rented" or "Closed".', example: "'Rented'" },
          // src/pages/units/LettingTab.tsx — Rented needs the tenant and the end date
          { label: 'Tenant', required: false, value: "The tenant's name; needed when the status is Rented.", example: "'Ahmad Faizal'" },
          { label: 'Tenant phone', required: false, value: 'Optional.', example: "'+60 13-555 0101'" },
          { label: 'Agreement starts', required: false, value: 'First day of the tenancy.', example: "'2027-01-01'" },
          { label: 'Agreement ends', required: false, value: 'Last day; not before the start. You are reminded 90 days before.', example: "'2027-12-31'" },
          { label: 'Monthly rent (RM)', required: false, value: 'Rent per month.', example: "'1,800.00'" },
          { label: 'Our agent fee (RM)', required: false, value: 'What we charge for finding the tenant.', example: "'900.00'" },
          { label: 'Notes', required: false, value: 'Optional, up to 2000 characters.', example: "'Deposit 2+1 held by owner'" },
        ],
      },
      { do: 'Click "Record".', then: 'Toast "Letting recorded." The unit shows on the Agent to let list; a Rented letting is reminded 90 days before it ends.' },
    ],
    checkBefore: ['The agreement dates match the signed tenancy agreement.'],
    result: 'The letting is listed on Agent to let and on the unit\'s Letting tab.',
    warnings: ['A unit Rented long-term should not take short-stay reservations for those dates: block them on the calendar.'],
    undo: 'Click the letting row to open it and change any field, then "Save"; set "Closed" when it ends.',
    commonMistakes: [{ mistake: 'Leaving the end date empty on a Rented letting.', fix: 'Add the "Agreement ends" date so the 90-day reminder works.' }],
    workedExample: "Tenant 'Ahmad Faizal' rents 'Vertica A-12-03' for 2027 at RM 1,800 a month: Agent to let > Record a unit to let > Unit A-12-03 > Status Rented > Tenant 'Ahmad Faizal' > 2027-01-01 to 2027-12-31 > Monthly rent 1,800.00 > Our agent fee 900.00 > Record.",
    related: ['add-unit', 'block-dates-calendar'],
    contact: 'Operations manager.',
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'add-utility-bill',
    title: 'Add a utility bill or expense to a unit',
    keywords: ['utility bill', 'electric bill', 'water bill', 'wifi bill', 'indah water', 'add expense', 'unit cost', '水电费', '电费', '水费', '网费', '加开销', 'bil elektrik', 'bil air', 'perbelanjaan'],
    module: 'Finance',
    companies: ['conts'],
    purpose: "Record a unit's Wi-Fi, water, electricity or IndahWater bill (or another cost) so it is paid and, when the owner pays, deducted on the owner statement.",
    prerequisites: ['The bill (and its receipt when the owner pays it).', "The month is not final on the owner's statement."],
    who: 'Finance staff.',
    // functions/api/expenses/index.ts:22 — session.manage on Finance
    permission: ['POST /api/expenses'],
    page: '/finance/payables',
    sidebar: 'FINANCE > Rental bills > Accounts payable',
    steps: [
      { do: 'Open FINANCE > Rental bills > Accounts payable and click "Add utility bill".', highlight: 'Add utility bill', then: 'Pick the unit in the "Add utility bill" window.' },
      {
        do: 'Fill the bill.',
        fields: [
          { label: 'Bill', required: true, value: 'Which bill (Wi-Fi, water, electricity, IndahWater, other fees).', example: "'Electricity'" },
          // src/pages/owners/Costs.tsx BillModal — amount above 0
          { label: 'Amount (RM)', required: true, value: 'Above 0.', example: "'120.50'" },
          // functions/api/expenses/index.ts:48 — the month must not be final
          { label: 'Bill date', required: true, value: 'The date on the bill; its month must not be final on the owner statement.', example: "'2026-11-28'" },
          { label: 'Reference (optional)', required: false, value: 'Bill number, or the account on file.', example: "'TNB 220012345678'" },
          { label: 'Paid by', required: true, value: 'Who pays the bill.', example: "'Owner'" },
        ],
        // functions/api/expenses/index.ts:50 — RECEIPT_REQUIRED for owner-paid bills
        check: 'When the owner pays, the receipt must be attached; the button says "Attach the receipt: the owner pays this bill".',
      },
      { do: 'Click "Add bill".', then: 'The bill is listed on Accounts payable and on the unit\'s costs for its month.' },
    ],
    checkBefore: ['The right unit and bill month.', 'Owner-paid bills have the receipt attached.'],
    result: 'An expense on the unit for that month; owner-paid ones are deducted on the owner statement.',
    warnings: ["A bill in a month that is already final is refused: (That month's owner statement is already final, so nothing can be added to it)"],
    undo: 'Open the expense on Accounts payable and use "Delete expense" > "Confirm delete" (Finance), then add it again.',
    commonMistakes: [{ mistake: 'Using the payment date instead of the bill date.', fix: 'The bill date decides the statement month: use the date on the bill.' }],
    workedExample: "TNB bill RM 120.50 dated 28 Nov for 'Vertica A-12-03', owner pays: Accounts payable > Add utility bill > unit A-12-03 > Bill Electricity > Amount 120.50 > Bill date 2026-11-28 > Paid by Owner > attach the receipt > Add bill.",
    related: ['owner-statement-generate'],
    contact: 'Finance lead.',
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'owner-statement-generate',
    title: "Generate, finalise and send owners' monthly statements",
    keywords: ['owner statement', 'generate statement', 'monthly statement', 'owner income report', 'mark final', 'send to owner', '业主报表', '月结', '出报表', '业主对账单', 'penyata pemilik'], // vocab-ok: search keywords staff type
    module: 'Owners',
    companies: ['conts'],
    purpose: "Build each owner's month (income by night, cleaning, bills and deductions, the contract split, Owner Adjustments), check it, make it final and send it to the owner.",
    prerequisites: ["The month's reservations, payments and costs are in.", 'Locks done for income, deductions and O2 if your team locks them (Unit report > Monthly).'],
    who: 'Finance staff; making a statement final is a power given person by person.',
    // functions/api/statements/generate.ts:22 — session.manage on Finance; finalise.ts:15 — Make final area
    permission: ['POST /api/statements/generate'],
    page: '/owners/statements',
    sidebar: 'UNITS > Owners > Owner statements',
    steps: [
      { do: 'Open UNITS > Owners, the "Owner statements" tab, and click "Generate statements".', highlight: 'Generate statements', then: 'The "Generate statements" window opens.' },
      {
        do: 'Pick the "Period" and click "Generate".',
        fields: [
          // functions/api/statements/generate.ts:26,187 — YYYY-MM; a sent period cannot be regenerated
          { label: 'Period', required: true, value: 'The month. A month already sent is marked "already sent" and cannot be regenerated.', example: "'November 2026'" },
        ],
        then: 'Each owner\'s statement is built as Draft. The list shows "Gross Income", "To Operator", "Deductions" and "Net Payout to Owner" per owner.',
      },
      {
        do: 'Open a statement and check it, then click "Mark final".',
        page: '/owners/statements/:id',
        highlight: 'Mark final',
        // functions/api/statements/finalise.ts:15 — Make final power
        check: 'Warnings for unpaid reservations or missing costs are shown at the top: fix them first. "Mark final" shows only to people given Make final.',
      },
      {
        do: 'Click "Send to owner" and confirm.',
        page: '/owners/statements/:id',
        highlight: 'Send to owner',
        // functions/api/statements/send.ts — sends the Owner Income Report; creates the payout
        then: 'The owner gets the Owner Income Report and a payout waits on Owner payouts for the next run.',
      },
    ],
    checkBefore: ['Every unit of the owner is on the statement.', 'Net Payout to Owner matches what you expect from the income and costs.'],
    result: 'Statements move Draft > Final > Sent; each sent statement creates a pending owner payout.',
    warnings: [
      'A sent month cannot be regenerated.',
      'Once final, nothing can be added to that month for the unit (bills, maintenance costs, payments are refused).',
      '"Send to owner" emails the owner.',
    ],
    // functions/api/statements/unlock-final.ts — Unlock final is its own power
    undo: 'A final statement can only be reopened by someone given Unlock final; unlocking cancels its pending payout.',
    approvals: 'Make final and Unlock final are powers management gives person by person.',
    deadlines: 'Statements are for a calendar month; the owner-close locks decide when each part of a month stops changing.',
    commonMistakes: [{ mistake: 'Making a statement final before the month\'s bills are in.', fix: 'Ask someone with Unlock final to reopen it, add the bill, generate again.' }],
    workedExample: 'November 2026: Owner statements > Generate statements > Period November 2026 > Generate > open Lim Chee Keong > check > Mark final > Send to owner > confirm.',
    related: ['owner-payout-run', 'add-utility-bill', 'record-guest-payment'],
    nextStep: 'Pay the owners (owner-payout-run).',
    contact: 'Finance lead.',
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'owner-payout-run',
    title: 'Pay owners: start a payout run and mark payouts paid',
    keywords: ['owner payout', 'pay owner', 'payout run', 'bank transfer file', 'mark paid', '付业主', '业主付款', '转账给业主', 'bayar pemilik'],
    module: 'Owners',
    companies: ['conts'],
    purpose: 'Move the pending owner payouts (created when statements are sent) into a run, download the bank transfer file, transfer at the bank and mark each one paid.',
    prerequisites: ['The owners\' statements are sent.', 'Each owner has a bank account on file (payouts without one cannot join a run).'],
    who: 'Finance staff.',
    // functions/api/payouts/run.ts:14 — session.manage on Finance
    permission: ['POST /api/payouts/run'],
    page: '/owners/payouts',
    sidebar: 'UNITS > Owners > Owner payouts',
    steps: [
      { do: 'Open UNITS > Owners, the "Owner payouts" tab. Check "Not yet paid" and "Waiting for a run".' },
      {
        do: 'Click "Start payout run", untick any payout you are not paying now and start the run.',
        highlight: 'Start payout run',
        // functions/api/payouts/run.ts:18,37 — 1-500 payouts; those without a bank account are left out
        check: 'Payouts without a bank account cannot be ticked. With approval rules on, the run goes for approval first.',
        then: 'Toast Payout run <number> started. The payouts move to In progress.',
      },
      { do: 'Click the download for the run, choose "One transfer per" and "Download" the bank transfer file; upload it at the bank.', highlight: 'Download' },
      {
        do: 'When the bank confirms, tick the payouts and click "Mark paid" (or "Try again" for one the bank failed, with the reason).',
        highlight: 'Mark paid',
        // functions/api/payouts/index.ts:159 — failed needs the reason
      },
    ],
    checkBefore: ['The total of the run matches the bank transfer total.', 'Account numbers are right (the file has the full numbers).'],
    result: 'Payouts move Pending > In progress > Paid; the owner statement shows it paid.',
    warnings: ['The transfer itself happens at the bank: marking paid does not move money.', 'With approval rules on, a second person must approve the run first.'],
    undo: 'A payout marked failed can be tried again. A paid payout cannot be changed; a payout of a statement that is unlocked is cancelled.',
    approvals: 'With Settings > Approval rules on, a payout run waits for a second person on FINANCE > Approvals.',
    commonMistakes: [{ mistake: 'Marking paid before the bank confirmed the transfer.', fix: 'Only mark paid after the bank shows the transfer done; a failed one is marked failed with the bank\'s reason.' }],
    workedExample: 'Pay November: Owner payouts > Start payout run > keep all 18 ticked > start > Download > One transfer per owner > Download > upload at the bank > after confirmation tick all > Mark paid.',
    related: ['owner-statement-generate'],
    contact: 'Finance lead.',
  },
];
