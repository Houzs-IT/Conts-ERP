/**
 * howto/screensFull.ts: the busiest screens documented button by button (detail "full"), read from their page code
 * (the files named beside each entry) and the handlers' permission checks. Every other router page gets a "basic"
 * entry from screensBasic.ts. Permissions use the guides' form (howto/types.ts HowToPermission).
 */
import type { ScreenEntry } from './screenTypes';

export const FULL_SCREENS: ScreenEntry[] = [
  {
    // src/pages/BookingsPage.tsx, src/components/booking/BookingDrawer.tsx
    path: '/reservations/bookings', title: 'Reservations', company: 'conts', detail: 'full',
    purpose: 'Every reservation with its money: to-do tiles (arriving, departing, unpaid...), views, search, totals (guest total, service fee, host payout), and the reservation drawer to take payments, issue receipts, change dates or cancel.',
    sidebar: 'RESERVATIONS > Reservations',
    sections: ['Reservations', 'Guest total', 'Service fee', 'Host payout'],
    keywords: ['reservation list', 'bookings', '订单列表', '订房', 'senarai tempahan'], // vocab-ok: words staff type
    actions: [
      { label: 'Create reservation', kind: 'button', does: 'Opens the Create reservation window: a direct guest, a channel reservation that did not arrive, or an owner stay.', permission: 'POST /api/reservations', sideEffects: 'Blocks the dates on every channel the unit is listed on.' },
      { label: 'Import', kind: 'button', does: 'Reads a CSV of reservations (unit, guest, channel, checkin, checkout) and shows the rows before importing.', permission: 'POST /api/reservations/import' },
      { label: 'Clear all', kind: 'button', does: 'Clears the search and the to-do filter.' },
      { label: 'Mark host payouts received', kind: 'button', does: 'With reservations ticked: records one host payout per reservation for what it still has outstanding.', permission: 'POST /api/reservations/mark-paid-out', sideEffects: 'Records money received (Finance).' },
      { label: 'Record payment', kind: 'button', does: 'In the drawer: records a guest payment, a host payout or a refund on the reservation.', permission: 'POST /api/reservations/x/payments', sideEffects: 'Money recorded; a refund may wait for approval.' },
      { label: 'Issue invoice', kind: 'button', does: 'In the drawer: issues the guest invoice for the reservation.', permission: 'POST /api/guest-documents' },
      { label: 'Change dates', kind: 'button', does: 'In the drawer: moves or extends a direct reservation (channel reservations change on the channel).', permission: 'PATCH /api/reservations/x/dates' },
      { label: 'Cancel reservation', kind: 'button', does: 'In the drawer: cancels with a reason and frees the dates.', permission: 'PATCH /api/reservations/x', sideEffects: 'Dates released on every channel.' },
      { label: 'Message guest', kind: 'button', does: 'In the drawer: sends the guest a message on their channel.', permission: 'POST /api/messages' },
      { label: 'Duplicate', kind: 'button', does: 'In the drawer: starts a new reservation with this guest and unit filled in.' },
    ],
  },
  {
    // src/pages/CalendarPage.tsx, src/components/calendar/CalendarModals.tsx
    path: '/reservations/calendar', title: 'Calendar', company: 'conts', detail: 'full',
    purpose: 'Every unit by night: reservations, owner stays and blocks; drag over nights to book, block or change the price.',
    sidebar: 'RESERVATIONS > Calendar',
    sections: ['Block nights', 'Set price'],
    keywords: ['availability', '日历', '房态', 'kalendar'],
    actions: [
      { label: 'Block nights', kind: 'button', does: 'Blocks nights on one unit for a repair, an owner stay or another reason.', permission: 'POST /api/blocks', sideEffects: 'Nights blocked on every channel.' },
      { label: 'Update prices', kind: 'button', does: 'Changes nightly prices for many units and dates in three steps.', permission: 'POST /api/rates/bulk', sideEffects: 'Prices go to the channels.' },
      { label: 'Check changes', kind: 'button', does: 'In Update prices: shows the old and new prices before saving.' },
    ],
  },
  {
    // src/pages/OperationsTodayPage.tsx
    path: '/operations/today', title: 'Today', company: 'conts', detail: 'full',
    purpose: "Today's (or tomorrow's) check-ins and checkouts with their units, cleaning progress, maintenance due and units free tonight.",
    sidebar: 'OPERATIONS > Today',
    sections: ['Check-ins', 'Checkouts', 'Cleaning jobs done', 'Maintenance'],
    keywords: ['today', 'arrivals', 'departures', '今天', '入住退房', 'hari ini'], // vocab-ok: words staff type
    actions: [
      { label: 'Guest arrived', kind: 'button', does: 'Checks the guest in: the reservation shows Currently hosting.', permission: 'PATCH /api/reservations/x' },
      { label: 'Guest left', kind: 'button', does: 'Marks the guest out so the cleaning job shows ready to clean.', permission: 'POST /api/housekeeping/guest-left' }, // vocab-ok: an API path, not a word on screen
      { label: 'Change check-in time', kind: 'button', does: 'Changes the expected check-in time.' },
      { label: 'Change checkout time', kind: 'button', does: 'Changes the expected checkout time.' },
      { label: 'Open Cleaning', kind: 'button', does: 'Opens OPERATIONS > Cleaning.' },
    ],
  },
  {
    // src/pages/CleaningPage.tsx
    path: '/operations/cleaning', title: 'Cleaning', company: 'conts', detail: 'full',
    purpose: 'Cleaning jobs by day on the Board (assign cleaners, mark done), their History, cleaners\' pay, prices and outside billing.',
    sidebar: 'OPERATIONS > Cleaning',
    sections: ['Board', 'History', 'Pay', 'Prices', 'Outside billing'],
    keywords: ['housekeeping', 'cleaners', '清洁', '打扫', 'pembersihan'], // vocab-ok: words staff type
    actions: [
      { label: 'Assign cleaner', kind: 'button', does: 'On a card: tick the cleaners for that cleaning job and Apply.', permission: 'POST /api/housekeeping/tasks/x/assign' }, // vocab-ok: an API path, not a word on screen
      { label: 'Add cleaning job', kind: 'button', does: 'Adds a cleaning job by hand (deep clean, refresh, an outside address).', permission: 'POST /api/housekeeping/tasks' },
      { label: 'Mark done', kind: 'button', does: 'With cards ticked: marks those cleaning jobs done.', permission: 'PATCH /api/housekeeping/tasks/x' }, // vocab-ok: a search keyword staff type, not a label
      { label: 'Guest left', kind: 'button', does: 'Marks the guest out on that unit so cleaning can start.', permission: 'POST /api/housekeeping/guest-left' }, // vocab-ok: an API path, not a word on screen
      { label: 'Report damage', kind: 'button', does: 'Opens a maintenance job for the unit from its cleaning job.', permission: 'POST /api/maintenance/issues' },
      { label: 'Delete job', kind: 'button', does: 'Removes the cleaning job.', permission: 'POST /api/housekeeping/cancel', sideEffects: 'Gone from the cleaner\'s app at once.' }, // vocab-ok: a search keyword staff type, not a label
    ],
  },
  {
    // src/pages/MaintenancePage.tsx, src/components/ops/OpsUi.tsx
    path: '/operations/maintenance', title: 'Maintenance', company: 'conts', detail: 'full',
    purpose: 'Maintenance jobs from report to done: quote, owner approval, technician, repair window, final cost; approval rules and profit by job.',
    sidebar: 'OPERATIONS > Maintenance',
    sections: ['Quote and billing', 'Owner approval'],
    keywords: ['repairs', 'maintenance log', '维修', '报修', 'penyelenggaraan'],
    actions: [
      { label: 'Add maintenance job', kind: 'button', does: 'Opens the maintenance job form.', permission: 'POST /api/maintenance/issues' },
      { label: 'Add pass key job', kind: 'button', does: 'Opens a pass key job (door code for a check-in).', permission: 'POST /api/maintenance/issues' },
      { label: 'Send to owner for approval', kind: 'button', does: 'Sends the quote to the owner on the owner portal; work waits until they approve.', permission: 'POST /api/maintenance/issues/x/request-approval' },
      { label: "Record owner's approval", kind: 'button', does: "Records the owner's yes given by phone or chat (finance / management).", permission: 'POST /api/maintenance/issues/x/approve' },
      { label: 'Mark done', kind: 'button', does: 'Closes the job with its final cost, who pays and the billing date (Full on Maintenance).', permission: 'area:maintenance:full', sideEffects: 'Records the cost on the unit for the billing month.' },
      { label: 'Approval rules', kind: 'button', does: 'Which jobs need the owner\'s approval first.' },
      { label: 'Profit by job', kind: 'button', does: 'What each job earned against its cost.' },
      { label: 'Technicians', kind: 'button', does: 'Opens HR > Employees for the technician roster.' },
    ],
  },
  {
    // src/pages/OwnersPage.tsx
    path: '/owners', title: 'Owners', company: 'conts', detail: 'full',
    purpose: 'Every owner with their units, fee model and what is owed to them; open one for their details, contract, statements and payouts.',
    sidebar: 'UNITS > Owners',
    sections: ['Owners', 'To pay owners', 'Gross income'],
    keywords: ['owner list', 'landlords', '业主', 'pemilik'],
    actions: [
      { label: 'Add owner', kind: 'button', does: 'Creates an owner (name, contact, bank account).', permission: 'POST /api/owners' },
      { label: 'Unit statements (.zip)', kind: 'button', does: "Downloads every unit's statement for the month." },
      { label: 'Clear filters', kind: 'button', does: 'Clears the search and filters.' },
    ],
  },
  {
    // src/pages/StatementsPage.tsx
    path: '/owners/statements', title: 'Owner statements', company: 'conts', detail: 'full',
    purpose: "Each owner's monthly statement (Draft, Final, Sent): gross income, To Operator, deductions and Net Payout to Owner; generate a month.",
    sidebar: 'UNITS > Owners > Owner statements',
    sections: ['Gross Income', 'To Operator', 'Deductions', 'Net Payout to Owner'],
    keywords: ['monthly statement', 'owner report', '业主报表', 'penyata'], // vocab-ok: a search keyword staff type, not a label
    actions: [
      { label: 'Generate statements', kind: 'button', does: "Builds every owner's statement for a month as Draft (a sent month cannot be regenerated).", permission: 'POST /api/statements/generate' },
      { label: 'Previous period', kind: 'button', does: 'Shows the month before.' },
      { label: 'Next period', kind: 'button', does: 'Shows the month after.' },
    ],
  },
  {
    // src/pages/PayoutsPage.tsx
    path: '/owners/payouts', title: 'Owner payouts', company: 'conts', detail: 'full',
    purpose: 'Payouts created when statements are sent: start a payout run, download the bank transfer file, mark paid or failed.',
    sidebar: 'UNITS > Owners > Owner payouts',
    sections: ['Owner payouts', 'Not yet paid', 'Waiting for a run'],
    keywords: ['pay owners', '付业主', 'bayar pemilik'],
    actions: [
      { label: 'Start payout run', kind: 'button', does: 'Moves the ticked pending payouts into a run (with approval rules on, it waits for approval first).', permission: 'POST /api/payouts/run', sideEffects: 'Money goes out once transferred at the bank.' },
      { label: 'Mark paid', kind: 'button', does: 'Marks a payout paid after the bank transfer.', permission: 'PATCH /api/payouts' },
      { label: 'Try again', kind: 'button', does: 'Puts a failed payout back for another run.', permission: 'PATCH /api/payouts' },
      { label: 'Download', kind: 'button', does: 'Downloads the bank transfer file (one transfer per owner or per unit).' },
    ],
  },
  {
    // src/pages/UnitsPage.tsx, src/pages/units/AddUnitPage.tsx
    path: '/properties/units', title: 'Units', company: 'conts', detail: 'full',
    purpose: 'Every unit by building with its owner, contract and status; open one for its tabs (details, contract, financials, reservations, cleaning, letting).',
    sidebar: 'UNITS > Units',
    sections: ['All units', 'Pass key', 'Scheduled changes', 'Agent to let', 'Unit settings'],
    keywords: ['unit list', 'properties', '单位', '房源', 'unit'], // vocab-ok: words staff type
    actions: [{ label: 'Add unit', kind: 'button', does: 'Opens Add unit (Listing, Type and size, Contract).', permission: 'POST /api/units' }],
  },
  {
    // src/pages/LettingsPage.tsx
    path: '/properties/agent-to-let', title: 'Agent to let', company: 'conts', detail: 'full',
    purpose: "Units The Conts lets long-term for their owners: tenant, agreement dates, rent, agent fee, reminders before they end.",
    sidebar: 'UNITS > Units > Agent to let',
    sections: ['Looking for a tenant', 'Rented'],
    keywords: ['letting', 'tenancy', '出租', 'sewa'],
    actions: [{ label: 'Record a unit to let', kind: 'button', does: 'Records a letting (unit, status, tenant, dates, rent, agent fee).', permission: 'POST /api/lettings' }],
  },
  {
    // src/pages/ExpensesPage.tsx
    path: '/finance/payables', title: 'Accounts payable', company: 'conts', detail: 'full',
    purpose: "The units' bills and expenses for the month (utilities, repairs, other costs), who pays them, and the report.",
    sidebar: 'FINANCE > Rental bills > Accounts payable',
    sections: ['Accounts payable'],
    keywords: ['expenses', 'bills', '开销', 'perbelanjaan'],
    actions: [
      { label: 'Add utility bill', kind: 'button', does: "Adds a unit's Wi-Fi, water, electricity or IndahWater bill.", permission: 'POST /api/expenses' },
      { label: 'Add expense', kind: 'button', does: 'Adds another cost to a unit.', permission: 'POST /api/expenses' },
      { label: 'Utility bills', kind: 'button', does: "Opens the month's utility bills of every unit." },
      { label: 'Generate report', kind: 'button', does: 'Downloads the expenses report as CSV.' },
    ],
  },
  {
    // src/pages/PricingPage.tsx, src/pages/pricing/*
    path: '/performance/pricing', title: 'Pricing', company: 'conts', detail: 'full',
    purpose: 'Nightly, weekend and holiday prices per unit and channel; batch edits; the public holiday list.',
    sidebar: 'GROWTH > Pricing',
    sections: ['Unit prices', 'Batch edit', 'Public holidays'],
    keywords: ['rates', 'price', '房价', 'harga'],
    actions: [
      { label: 'Unit prices', kind: 'tab', does: "One unit's prices per channel and level.", permission: 'area:pricing:full' },
      { label: 'Batch edit', kind: 'tab', does: 'Changes prices of many units at once with a preview.', permission: 'POST /api/pricing/batch' },
      { label: 'Preview', kind: 'button', does: 'In Batch edit: shows old and new prices before applying.' },
    ],
  },
  {
    // src/pages/ReviewsPage.tsx, src/pages/reviews/GuestReviews.tsx
    path: '/performance/reviews', title: 'Reviews', company: 'conts', detail: 'full',
    purpose: 'Guest reviews by unit and cleaner, bad reviews, and The Conts\' own reviews of Airbnb guests (with templates and auto rules).',
    sidebar: 'GROWTH > Reviews',
    sections: ['Overview', 'All reviews', 'Bad reviews', 'Review guests', 'Unit health', 'Cleaners'],
    keywords: ['ratings', '评价', 'ulasan'],
    actions: [
      { label: 'Write a review', kind: 'button', does: 'Writes the review of an Airbnb guest within the review window.', permission: 'POST /api/reviews/guest-reviews' },
      { label: 'Approve and send', kind: 'button', does: 'Sends a review an auto rule wrote.', permission: 'POST /api/reviews/guest-reviews/x/approve', sideEffects: 'Published on Airbnb.' },
      { label: 'Bad guest', kind: 'button', does: "Holds the guest's review and sends it late.", permission: 'POST /api/reviews/guest-reviews/bad-guest' },
      { label: 'Templates', kind: 'button', does: 'Guest review templates.' },
      { label: 'Auto rules', kind: 'button', does: 'Rules that write reviews by themselves.' },
    ],
  },
  {
    // src/pages/MyClaimsPage.tsx
    path: '/my-claims', title: 'My claims', company: 'both', detail: 'full',
    purpose: 'Hand in a receipt to claim money back or ask finance to pay a supplier; follow your claims; petty cash you keep.',
    sidebar: 'HOME > My claims',
    sections: ['Hand in', 'Mine', 'Petty cash I keep', 'To review'],
    keywords: ['claim', 'reimbursement', '报销', 'tuntutan'],
    actions: [
      { label: 'Hand in', kind: 'tab', does: 'The claim / direct pay form.', permission: 'POST /api/claims/receipts' },
      { label: 'Withdraw', kind: 'button', does: 'Takes back a claim finance has not acted on.', permission: 'POST /api/claims/requests/x/withdraw' },
      { label: 'Edit and resubmit', kind: 'button', does: 'Changes a rejected or withdrawn claim and sends it again.' },
    ],
  },
  {
    // engine/frontend/src/pages/MailCenter/{Inbox,Thread}.tsx
    path: '/mail', title: 'Mail center', company: 'both', detail: 'full',
    purpose: "The company's shared mailboxes: read, reply, forward, archive; compose new emails.",
    sidebar: 'MAIL > Mail center',
    sections: [],
    keywords: ['email', 'inbox', '邮件', 'emel'],
    actions: [
      { label: 'Reply', kind: 'button', does: 'Opens the reply box under the conversation.', permission: 'area:mail:view' },
      { label: 'Send reply', kind: 'button', does: 'Sends the reply.', permission: 'area:mail:view', sideEffects: 'The email is sent.' },
      { label: 'Forward', kind: 'button', does: 'Forwards the conversation as a new email.', permission: 'area:mail:view' },
    ],
  },
  {
    // engine/frontend/src/pages/renovation-beta/RenovationBetaHome.tsx
    path: '/projects/list', title: 'Projects', company: 'dream_crafter', detail: 'full',
    purpose: 'All renovation projects with their stage, brand, sales order and payments; open one for its workspace (Overview, Drawings, VO, SO, Site & photos, Defects, Timeline).',
    sidebar: 'PROJECTS > Projects',
    sections: ['All projects', 'Overview', 'Drawings', 'VO', 'Site & photos', 'Defects', 'Timeline'],
    keywords: ['renovation projects', 'project list', '项目', '装修项目', 'projek'],
    actions: [
      { label: '+ New project', kind: 'button', does: 'Opens New renovation project.', permission: 'area:projects:edit' },
      { label: 'Report a problem', kind: 'button', does: 'In a project, Defects tab: reports a defect with photos.', permission: 'area:projects:edit' },
      { label: 'Hand over', kind: 'button', does: "In a project, Defects tab: records the handover with the customer's signature once every defect is closed.", permission: 'area:projects:edit' },
    ],
  },
  {
    // engine/frontend/src/pages/renovation/QuotationsList.tsx, scm-v2/renovationQuotationChrome.tsx
    path: '/sales/quotations', title: 'Quotations', company: 'dream_crafter', detail: 'full',
    purpose: 'Renovation quotations and their revisions: draft, sent, accepted, converted to the sales order.',
    sidebar: 'SUPPLY CHAIN > Sales order > Quotations',
    sections: ['Quotations'],
    keywords: ['quote', '报价', 'sebut harga'],
    actions: [
      { label: 'New Quotation', kind: 'button', does: 'Opens a new quotation.', permission: 'area:scSales:edit' },
      { label: 'Mark sent', kind: 'button', does: 'Marks the quotation sent to the customer.', permission: 'area:scSales:edit' },
      { label: 'Accepted', kind: 'button', does: 'Records the customer\'s acceptance of this revision.', permission: 'area:scSales:edit' },
      { label: 'Convert to sales order', kind: 'button', does: 'Makes the sales order (contract) from the accepted quotation.', permission: 'area:scSales:edit', sideEffects: 'Locks the quotation.' },
      { label: 'Print PDF', kind: 'button', does: 'Prints the quotation.' },
      { label: 'Copy as new', kind: 'button', does: 'Starts a new quotation from this one.', permission: 'area:scSales:edit' },
    ],
  },
  {
    // engine/frontend/src/pages/scm-v2/SalesOrderDetail.tsx + renovation/RenovationSalesOrder.tsx
    path: '/sales/orders', title: 'Sales orders', company: 'dream_crafter', detail: 'full',
    purpose: 'Sales orders, including renovation contracts with their progress billing, variation orders and payments.',
    sidebar: 'SUPPLY CHAIN > Sales order > Sales orders',
    sections: ['Progress billing', 'Variation orders', 'Credit notes'],
    keywords: ['contract', 'SO', '销售单', '合约'],
    actions: [
      { label: 'Bill', kind: 'button', does: 'Bills the next instalment as a sales invoice.', permission: 'area:scInvoices:edit' },
      { label: 'New VO', kind: 'button', does: 'Starts a variation order on the contract.', permission: 'area:scSales:edit' },
      { label: 'Collect payment', kind: 'button', does: 'Records a customer payment against the order.', permission: 'area:scSales:edit' },
      { label: 'Credit note', kind: 'button', does: 'Raises a credit note on the contract.', permission: 'area:scInvoices:edit' },
    ],
  },
  {
    // engine/frontend/src/pages/scm-v2/Suppliers.tsx
    path: '/procurement/suppliers', title: 'Suppliers', company: 'dream_crafter', detail: 'full',
    purpose: 'Suppliers and contractors with their contacts, tax numbers and bound items.',
    sidebar: 'SUPPLY CHAIN > Procurement > Suppliers',
    sections: ['Suppliers'],
    keywords: ['contractors', 'vendors', '供应商', 'pembekal'],
    actions: [{ label: 'New Supplier', kind: 'button', does: 'Opens the New supplier panel.', permission: 'area:scProcurement:edit' }],
  },
  {
    // engine/frontend/src/pages/scm-v2/PurchaseOrdersListV2.tsx
    path: '/procurement/purchase-orders', title: 'Purchase orders', company: 'dream_crafter', detail: 'full',
    purpose: 'Purchase orders to suppliers and contractors, their delivery and receipt status.',
    sidebar: 'SUPPLY CHAIN > Procurement > Purchase orders',
    sections: [],
    keywords: ['PO', '采购单', 'pesanan belian'],
    actions: [{ label: 'New Purchase Order', kind: 'button', does: 'Opens New purchase order.', permission: 'area:scProcurement:edit' }],
  },
  {
    // engine/frontend/src/conts/Commission.tsx
    path: '/supply/my-commission', title: 'My commission', company: 'dream_crafter', detail: 'full', // vocab-ok: renovation sales commission, not the channel fee
    purpose: "A salesperson's commission on their renovation contracts: can claim now, earned, paid, and how each order adds up.", // vocab-ok: renovation sales commission, not the channel fee
    sidebar: 'HOME > My commission', // vocab-ok: renovation sales commission, not the channel fee
    sections: ['Can claim now', 'Earned so far', 'Paid'],
    keywords: ['commission', '佣金', 'komisen'], // vocab-ok: renovation sales commission
    actions: [],
  },
];
