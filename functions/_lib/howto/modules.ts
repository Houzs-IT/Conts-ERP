/**
 * howto/modules.ts: module_overview data, one entry per sidebar section (src/lib/navigation.ts NAV). Page names are
 * the menu labels and paths the menu addresses; src/lib/mcpHowto.test.mjs checks both against navigation.ts and the
 * router. `area` is the permission area the page opens under (canOpen follows the person's level on it).
 */
import type { HowToModule } from './types';

export const MODULES: HowToModule[] = [
  {
    id: 'home', section: 'HOME', company: 'conts',
    oneLine: 'Dashboard, portfolio and performance at a glance; My claims.',
    purpose: "The day's figures (occupancy, income, what needs someone now), the portfolio of units and the performance analytics; plus your own claims.",
    usedBy: 'Management, operations managers, finance; everyone for My claims.',
    pages: [
      { name: 'Dashboard', path: '/', area: 'dashboard' },
      { name: 'My claims', path: '/my-claims' },
      { name: 'Portfolio', path: '/portfolio', area: 'portfolio' },
      { name: 'Performance', path: '/performance/analytics', area: 'performance' },
    ],
    links: ['Reads reservations, cleaning, maintenance and finance.', 'My claims go to finance (FINANCE > To approve).'],
    guides: ['hand-in-claim'],
  },
  {
    id: 'reservations', section: 'RESERVATIONS', company: 'conts',
    oneLine: 'Calendar, reservations and guests.',
    purpose: 'Every reservation from Airbnb, Booking.com, Agoda and direct guests: the calendar per unit, the list with its money, and the guest records.',
    usedBy: 'Reservations / front desk, operations; finance for payments.',
    pages: [
      { name: 'Calendar', path: '/reservations/calendar', area: 'calendar' },
      { name: 'Reservations', path: '/reservations/bookings', area: 'reservations' },
      { name: 'Guests', path: '/reservations/guests', area: 'guests' },
    ],
    links: ['A reservation plans its cleaning job (OPERATIONS > Cleaning).', 'Its income lands on the owner statement (UNITS > Owners).', 'Dates are held on the channels by themselves.'],
    guides: ['create-reservation', 'change-or-cancel-reservation', 'record-guest-payment', 'block-dates-calendar'],
  },
  {
    id: 'operations', section: 'OPERATIONS', company: 'conts',
    oneLine: "Today's check-ins and checkouts, cleaning jobs and maintenance jobs.",
    purpose: 'The day on the ground: who arrives and leaves, which units are cleaned by whom, and repairs from report to done.',
    usedBy: 'Operations, cleaning supervisors, maintenance coordinators.',
    pages: [
      { name: 'Today', path: '/operations/today', area: 'operations' },
      { name: 'Cleaning', path: '/operations/cleaning', area: 'cleaning' },
      { name: 'Maintenance', path: '/operations/maintenance', area: 'maintenance' },
    ],
    links: ['Cleaning and repair costs go on the unit and the owner statement.', 'Cleaners and technicians come from HR > Employees.'],
    guides: ['check-in-check-out', 'assign-cleaning-job', 'add-maintenance-job'],
  },
  {
    id: 'hr', section: 'HR', company: 'conts',
    oneLine: 'Employees: field staff records, attendance, leave and payroll.',
    purpose: "Field staff's HR records (IC, bank, salary, statutory), attendance, leave and payroll.",
    usedBy: 'HR.',
    pages: [{ name: 'Employees', path: '/hr/employees', area: 'hr' }],
    links: ['Cleaners and technicians on the roster are picked on Cleaning and Maintenance jobs.'],
    guides: [],
  },
  {
    id: 'units', section: 'UNITS', company: 'conts',
    oneLine: 'Units, owners, contracts, owner statements and payouts, unit reports.',
    purpose: 'Every unit and its owner and contract; the monthly owner statements and payouts; agent-to-let tenancies; the yearly and monthly unit reports.',
    usedBy: 'Operations managers, finance, management.',
    pages: [
      { name: 'Units', path: '/properties/units', area: 'properties' },
      { name: 'Agent to let', path: '/properties/agent-to-let', area: 'agentToLet' },
      { name: 'Owners', path: '/owners', area: 'owners' },
      { name: 'Owner statements', path: '/owners/statements', area: 'finance' },
      { name: 'Owner payouts', path: '/owners/payouts', area: 'finance' },
      { name: 'Contracts', path: '/owners/contracts', area: 'contracts' },
      { name: 'Unit report', path: '/portfolio/owner-report', area: 'portfolio' },
    ],
    links: ['Statements read reservations, cleaning, maintenance and bills of the month.', 'Payouts are made from sent statements.'],
    guides: ['add-unit', 'add-owner', 'record-letting', 'owner-statement-generate', 'owner-payout-run'],
  },
  {
    id: 'finance', section: 'FINANCE', company: 'both',
    oneLine: 'Approvals, supplier payments, rental bills, billing, collections, bank and reports.',
    purpose: "The company's books: what waits for approval, suppliers and payment vouchers, the units' bills, invoices and receipts, bank reconciliation and the reports (P&L, balance sheet, commission).", // vocab-ok: renovation sales commission report
    usedBy: 'Finance; management.',
    pages: [
      { name: 'Accounts payable', path: '/finance/payables', area: 'finance' },
      { name: 'Utility bills', path: '/finance/utility-bills', area: 'finance' },
      { name: 'Approvals', path: '/finance/approvals', area: 'finance' },
      { name: 'Payment vouchers', path: '/finance/payment-vouchers', area: 'ledger' },
      { name: 'Commission', path: '/finance/commission', area: 'ledger' },
    ],
    links: ['Owner-paid bills are deducted on owner statements.', 'Payment vouchers pay supplier invoices (Dream Crafter procurement).'],
    guides: ['add-utility-bill', 'dc-pay-supplier', 'dc-commission'],
  },
  {
    id: 'growth', section: 'GROWTH', company: 'conts',
    oneLine: 'Pricing, reviews, guest messages and automations.',
    purpose: 'Nightly prices per unit and channel, guest reviews (and reviewing guests on Airbnb), the guest message inbox and automatic messages.',
    usedBy: 'Pricing manager, guest relations, operations.',
    pages: [
      { name: 'Pricing', path: '/performance/pricing', area: 'pricing' },
      { name: 'Reviews', path: '/performance/reviews', area: 'reviews' },
      { name: 'Messages', path: '/communication/inbox', area: 'comms' },
      { name: 'Automations', path: '/communication/automations', area: 'automations' },
    ],
    links: ['Prices go to the channels by themselves.', 'Reviews are matched to reservations and cleaners.'],
    guides: ['set-nightly-prices', 'review-guest-airbnb'],
  },
  {
    id: 'mail', section: 'MAIL', company: 'both',
    oneLine: "Mail Center: the company's shared email inboxes.",
    purpose: 'Read and answer the shared mailboxes; Mailboxes sets who reads and sends from each.',
    usedBy: 'Anyone given Mail Center access.',
    pages: [
      { name: 'Mail center', path: '/mail', area: 'mail' },
      { name: 'Mailboxes', path: '/mail/mailboxes', area: 'mail' },
    ],
    links: ['The AI Connector can prepare a reply for you to confirm (when switched on).'],
    guides: ['reply-mail-center'],
  },
  {
    id: 'system', section: 'SYSTEM', company: 'both',
    oneLine: 'Users and roles, settings, integrations, system health, IT Support, meetings, AI Connector.',
    purpose: "Who can do what (Users and roles > Permissions), the company's settings, channel integrations, health, IT requests, meeting rooms and the AI Connector.", // vocab-ok: meeting rooms, not rental units
    usedBy: 'Management and admins; everyone for IT Support and Meetings.',
    pages: [
      { name: 'Users and roles', path: '/system/users', area: 'users' },
      { name: 'Integrations', path: '/system/integrations', area: 'integrations' },
      { name: 'System health', path: '/system/health', area: 'health' },
      { name: 'IT Support', path: '/system/it-support' },
      { name: 'Meetings', path: '/system/meetings' },
      { name: 'AI Connector', path: '/system/ai-connector' },
    ],
    links: ['Permissions decide every screen and every canDo in these guides.'],
    guides: [],
  },
  {
    id: 'service-cases', section: 'SERVICE CASES', company: 'dream_crafter',
    oneLine: 'After-sales service cases and their quality metrics.',
    purpose: "Customers' after-sales cases from report to closing, with time-allowed metrics and the case settings.",
    usedBy: 'After-sales / service team.',
    pages: [
      { name: 'Service cases', path: '/service/cases', area: 'serviceCases' },
      { name: 'Quality metrics', path: '/service/metrics', area: 'serviceMetrics' },
      { name: 'My cases', path: '/service/my-cases', area: 'serviceMyCases' },
    ],
    links: ['A case can come from a renovation project after handover.'],
    guides: [],
  },
  {
    id: 'projects', section: 'PROJECTS', company: 'dream_crafter',
    oneLine: 'Renovation projects: list, calendar, defects, handover, finances and settings.',
    purpose: 'Every renovation project from Signed to Closed, its schedule, defects and handover; cost and profit for Full on Finances.',
    usedBy: 'Project coordinators, designers, site supervisors, sales; management.',
    pages: [
      { name: 'Projects', path: '/projects/list', area: 'projects' },
      { name: 'Calendar', path: '/projects/calendar', area: 'projects' },
      { name: 'Defects', path: '/projects/defects', area: 'projectDefects' },
      { name: 'Handover checklists', path: '/projects/handover-checklists', area: 'projectHandover' },
      { name: 'Finances', path: '/projects/finances', area: 'projectFinances' },
      { name: 'Project settings', path: '/projects/maintenance', area: 'projectSettings' },
    ],
    links: ['A project runs on its renovation sales order (SUPPLY CHAIN > Sales order).', 'Purchases and supplier payments are costs of the project.'],
    guides: ['dc-create-project', 'dc-project-stages', 'dc-defects-handover'],
  },
  {
    id: 'supply-chain', section: 'SUPPLY CHAIN', company: 'dream_crafter',
    oneLine: 'Quotations, sales orders, VOs, invoices; procurement, production, transport and warehouse.',
    purpose: 'The renovation sales documents (quotation, sales order / contract, VO, sales invoice) and the supply side (suppliers, POs, goods receipts, purchase invoices, stock, delivery).',
    usedBy: 'Sales, procurement, warehouse, finance.',
    pages: [
      { name: 'Quotations', path: '/sales/quotations', area: 'scSales' },
      { name: 'Sales orders', path: '/sales/orders', area: 'scSales' },
      { name: 'VO', path: '/sales/amendments', area: 'scSales' },
      { name: 'Sales invoices', path: '/sales/invoices', area: 'scInvoices' },
      { name: 'Suppliers', path: '/procurement/suppliers', area: 'scProcurement' },
      { name: 'Purchase orders', path: '/procurement/purchase-orders', area: 'scProcurement' },
      { name: 'Purchase invoices', path: '/procurement/purchase-invoices', area: 'scInvoices' },
      { name: 'Stock', path: '/procurement/stock', area: 'scWarehouse' },
    ],
    links: ['A converted quotation becomes the project\'s contract.', 'Payments on the contract move the project stages and release commission.'], // vocab-ok: renovation sales commission
    guides: ['dc-create-quotation', 'dc-convert-quotation', 'dc-variation-order', 'dc-bill-instalment', 'dc-collect-payment', 'dc-add-supplier', 'dc-purchase-order', 'dc-purchase-invoice'],
  },
  {
    id: 'dc-home', section: 'HOME', company: 'dream_crafter',
    oneLine: 'My claims and My commission (Dream Crafter side).', // vocab-ok: renovation sales commission
    purpose: 'Your claims to finance and, for salespeople, your commission on renovation contracts.', // vocab-ok: renovation sales commission
    usedBy: 'Everyone (claims); salespeople (commission).', // vocab-ok: renovation sales commission
    pages: [
      { name: 'My claims', path: '/supply/my-claims' },
      { name: 'My commission', path: '/supply/my-commission', area: 'myCommission' },
    ],
    links: ['Commission follows the contracts, VOs and money collected.'], // vocab-ok: renovation sales commission
    guides: ['hand-in-claim', 'dc-commission'],
  },
  {
    id: 'dc-operations', section: 'OPERATIONS', company: 'dream_crafter',
    oneLine: 'Renovation site tasks.',
    purpose: "The renovation crews' site tasks across projects.",
    usedBy: 'Site supervisors and crews.',
    pages: [{ name: 'Renovation', path: '/supply/operations/renovation', area: 'projects' }],
    links: ['Tasks belong to the projects under PROJECTS.'],
    guides: ['dc-project-stages'],
  },
];
