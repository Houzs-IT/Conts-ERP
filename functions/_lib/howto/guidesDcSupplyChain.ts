/**
 * howto/guidesDcSupplyChain.ts: process help for Dream Crafter, the RENOVATION business on this system (owner, 27 Nov
 * 2026). Its screens are the supply chain engine's (Houzs's code run as its own site, embedded in the ERP: scmEngine.ts
 * ENGINE_PATH maps each menu address to the engine screen). Written from the engine's real screens:
 *   engine/frontend/src/pages/renovation-beta/* (Projects: All projects, the project workspace, Defects, Hand over)
 *   engine/frontend/src/pages/projects/renovation/CreateRenovationPanel.tsx (New renovation project)
 *   engine/frontend/src/pages/renovation/QuotationsList.tsx + scm-v2/SalesOrderNew.tsx (asQuotation) +
 *     scm-v2/renovationQuotationChrome.tsx (Mark sent / Accepted / Convert to sales order)
 *   engine/frontend/src/pages/renovation/RenovationSalesOrder.tsx (Progress billing, Bill, New VO) +
 *     renovation/VariationOrderEditor.tsx (VO)
 *   engine/frontend/src/pages/scm-v2/{Suppliers,PurchaseOrderNew,PurchaseOrdersListV2,PurchaseInvoicesListV2,
 *     PaymentVouchers,PaymentVoucherNew,SalesOrderDetail}.tsx, vendor/scm/components/PaymentsTable.tsx
 *   engine/frontend/src/conts/Commission.tsx (Commission, My commission)
 * and the engine's rules (engine/backend/src/services/renovation/flow.ts stages, projectBrand.ts brands,
 * scm/lib/renovation-so.ts convert, scm/lib/renovation-billing.ts instalments, scm/shared/renovation-commission.ts).
 *
 * Permissions: the engine opens its screens from the levels The Conts sends at sign-on
 * (engine/backend/src/conts/access.ts contsPermissions): quoting and VOs need Sales order at edit, approving a VO
 * Sales order at full; POs need Procurement at edit; billing needs Invoices and payments at edit (or Sales order at edit
 * for one's own contracts); payment vouchers need the Ledger at edit; projects need Projects at edit. So canDo here is
 * the person's level on that area ("area:<key>:<level>").
 *
 * Brands (the "project brand side"): a renovation project and its quotation carry a brand, Dream Crafter or The Conts
 * (in-house renovation of The Conts' own units); the brand picks the letterhead and the finance type. Both brands work
 * in these same screens, so the brand is a variant, not a separate guide.
 */
import type { HowToGuide } from './types';

const BRAND_VARIANT = {
  case: 'The Conts brand (in-house renovation of a unit The Conts manages)',
  companies: ['dream_crafter' as const],
  differences: [
    // engine/backend/src/services/renovation/projectBrand.ts — Dream Crafter → RENOVATION, The Conts → INHOUSE_RENOVATION
    'Pick "The Conts" as the brand instead of Dream Crafter: the documents print under The Conts\' letterhead and the money counts as in-house renovation. The brand can change until there is a contract.',
  ],
};

export const GUIDES: HowToGuide[] = [
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'dc-create-project',
    title: 'Open a new renovation project',
    keywords: ['new project', 'renovation project', 'create project', 'open project', 'reno project', '新项目', '开项目', '装修项目', 'projek baru', 'projek renovasi'],
    module: 'Projects',
    companies: ['dream_crafter'],
    purpose: 'Open the project that the quotation, contract, design, purchases, site work, defects and handover of one renovation all hang on.',
    prerequisites: ['The customer (or owner) name and the property: building and unit, or the site address.'],
    who: 'Sales, project coordinators and management.',
    // engine/frontend/src/pages/renovation-beta/RenovationBetaHome.tsx:266 — "+ New project" needs projects.write
    // (engine/backend/src/conts/access.ts:118 — Projects at edit)
    permission: ['area:projects:edit'],
    page: '/projects/list',
    sidebar: 'PROJECTS > Projects',
    steps: [
      { do: 'Switch the sidebar to Dream Crafter and open PROJECTS > Projects ("All projects"), then click "+ New project" at the top right.', highlight: '+ New project', then: 'The "New renovation project" window opens.' },
      {
        do: 'Fill the project.',
        fields: [
          { label: 'Project type', required: true, value: 'Pick the kind of renovation (the list kept under Project settings).', example: "'Full renovation'" },
          // CreateRenovationPanel.tsx:56 — customer or internal
          { label: 'Funding', required: true, value: '"Customer project", or "Internal (our own money)" for a unit to rent out or the showroom.', example: "'Customer project'" },
          // CreateRenovationPanel.tsx:57 — internal needs "Counts to" and a budget
          { label: 'Counts to', required: false, value: 'Internal only: "Rental (a unit to rent out)" or "Renovation (showroom)".', example: "'Rental (a unit to rent out)'" },
          // CreateRenovationPanel.tsx:59 — every customer project names its brand
          { label: 'Brand', required: true, value: 'Dream Crafter or The Conts (not asked for an internal Rental project).', example: "'Dream Crafter'" },
          { label: 'Budget (RM)', required: false, value: 'Internal only: required, above 0.', example: "'45,000.00'" },
          // CreateRenovationPanel.tsx:60-61 — customer name and the required property fields
          { label: 'Customer name', required: true, value: 'The customer or owner (customer projects); the property fields the form marks are required too.', example: "'Tan Mei Ling'" },
          { label: 'Project PIC', required: false, value: 'The person in charge.', example: "'Jason Lee'" },
          { label: 'Planned handover', required: false, value: 'The date you promise the keys back.', example: "'2027-03-31'" },
        ],
      },
      { do: 'Click "Create project".', then: 'The project opens with its code (RN-YYMM-NNN) at the first stage, "Signed", waiting for a sales order and its first payment.' },
    ],
    checkBefore: ['The right brand: it decides the letterhead and the finance type.', 'Customer name and property spelled right (they print on every document).'],
    result: 'A new project on "All projects", with its stages, checklist and template tasks created together.',
    warnings: ['The project moves on from "Signed" only when a sales order is linked AND its first payment is received.'],
    undo: 'Open the project and change its details (Overview "Edit"); a project opened by mistake can be deleted from the project while it has no documents.',
    commonMistakes: [{ mistake: 'Choosing the wrong brand for a The Conts unit.', fix: 'Change the brand on the project before the contract is made; after that it is fixed.' }],
    workedExample: "Customer 'Tan Mei Ling', unit 12-03 at Vertica, full renovation by Dream Crafter: Projects > + New project > Project type 'Full renovation' > Funding 'Customer project' > Brand 'Dream Crafter' > Customer name 'Tan Mei Ling' > building and unit > Planned handover 2027-03-31 > Create project.",
    related: ['dc-create-quotation', 'dc-project-stages'],
    nextStep: 'Quote the customer (dc-create-quotation).',
    contact: 'Project manager / sales manager.',
    variants: [BRAND_VARIANT],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'dc-create-quotation',
    title: 'Make a renovation quotation and get it accepted',
    keywords: ['quotation', 'quote', 'new quotation', 'renovation quote', 'mark sent', 'accepted', 'revision', '报价', '报价单', '开报价', 'sebut harga', 'quotation renovasi'],
    module: 'Sales',
    companies: ['dream_crafter'],
    purpose: 'Price the renovation room by room for the customer, send it, and record their acceptance so it can become the contract (sales order).',
    prerequisites: ['The project exists (or pick the customer in the quotation).', 'The products / packages you quote are in the catalog.'],
    who: 'Sales / designers.',
    // engine/backend/src/scm/routes/renovation.ts:129 POST /quotations — PERM.quote = scm.renovation.quote (Sales order at edit)
    permission: ['area:scSales:edit'],
    page: '/sales/quotations',
    sidebar: 'SUPPLY CHAIN > Sales order > Quotations',
    steps: [
      { do: 'Open SUPPLY CHAIN > Sales order > Quotations and click "New Quotation".', highlight: 'New Quotation', then: 'The "New quotation" page opens.' },
      {
        do: 'Pick the project or customer, the letterhead brand, then add the rooms and their lines (from a package or one by one), and the payment terms.',
        fields: [
          { label: 'Customer name', required: true, value: 'Filled from the project, or typed.', example: "'Tan Mei Ling'" },
          { label: 'Description', required: true, value: 'Each priced line needs a product picked (use the generic RN- product for free text).', example: "'Kitchen cabinet, top and bottom, 12 ft'" },
          { label: 'Qty', required: true, value: 'Quantity; decimals allowed on a quotation.', example: "'12'" },
        ],
        // SalesOrderNew.tsx:1638 — "Choose the letterhead": a quotation prints under one brand
        check: 'Choose the letterhead (brand): a quotation prints under one brand.',
      },
      { do: 'Click "Save as Draft".', highlight: 'Save as Draft', then: 'The quotation is saved with its number as a draft; you can "Print PDF" it.' },
      {
        do: 'When you have sent it to the customer, open it and click "Mark sent". When they agree, click "Accepted" and confirm.',
        highlight: 'Accepted',
        // scm/lib/renovation-quotation.ts:328 — only allowed status moves
        check: 'A draft must be marked sent first; a change after sending is a "New revision", not an edit.',
      },
    ],
    checkBefore: ['Every priced line has a product picked.', 'The payment terms add up and match what was agreed.', 'The right brand / letterhead.'],
    result: 'An accepted quotation (with its revisions kept), ready to convert to a sales order.',
    warnings: ['"Accepted" is the customer\'s yes on that exact revision.', 'Once converted, the quotation is locked.'],
    undo: '"Undo accept" while it is not converted; "Rejected" for a lost quotation; "Copy as new" to start another one from it.',
    commonMistakes: [{ mistake: 'Editing a quotation the customer already has.', fix: 'Use "New revision" so the sent revision stays on record.' }],
    workedExample: "Tan Mei Ling's kitchen and two bedrooms: Quotations > New Quotation > project 'Vertica 12-03' > brand Dream Crafter > rooms Kitchen, Bedroom 1, Bedroom 2 with their lines > payment terms 10/40/40/10 > Save as Draft > Print PDF > send > Mark sent > Accepted.",
    related: ['dc-create-project', 'dc-convert-quotation'],
    nextStep: 'Convert it to the sales order (dc-convert-quotation).',
    contact: 'Sales manager.',
    variants: [BRAND_VARIANT],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'dc-convert-quotation',
    title: 'Convert an accepted quotation into the sales order (the contract)',
    keywords: ['convert to sales order', 'contract', 'sales order', 'confirm quotation', '转销售单', '合约', '签约', 'tukar ke pesanan jualan', 'kontrak'],
    module: 'Sales',
    companies: ['dream_crafter'],
    purpose: 'Turn the accepted quotation into the renovation sales order: the contract that billing, purchasing, VOs, commission and the project stages run on.',
    prerequisites: [
      // scm/lib/renovation-so.ts:163,168,173 — accepted, payment terms, every priced line has a product
      'The quotation is "Accepted", has payment terms, and every priced line has a product.',
    ],
    who: 'Sales.',
    // engine/backend/src/scm/routes/renovation.ts:170 POST /quotations/:id/convert — PERM.quote (Sales order at edit)
    permission: ['area:scSales:edit'],
    page: '/sales/quotations',
    sidebar: 'SUPPLY CHAIN > Sales order > Quotations',
    steps: [
      { do: 'Open SUPPLY CHAIN > Sales order > Quotations and open the accepted quotation.' },
      { do: 'Click "Convert to sales order".', highlight: 'Convert to sales order', then: 'The sales order is created from the accepted revision; the quotation is locked and shows the sales order number. Finance\'s journal for the contract is posted after it.' },
      { do: 'Open the sales order: it lists "Progress billing" (the instalments from the payment terms) and "Variation orders".', page: '/sales/orders' },
    ],
    checkBefore: ['It is the revision the customer signed.', 'The contract total equals the quotation total.'],
    result: 'A live renovation sales order linked to the project; the project stays at "Signed" until the first payment comes in.',
    warnings: [
      // scm/lib/renovation-so.ts:162 — already converted
      'A quotation converts once; a second try says it is already that sales order.',
      'From now on, changes to the contract are variation orders (VO), not edits.',
    ],
    undo: 'Changes after conversion go through a VO (dc-variation-order). A contract cancelled by mistake is management\'s to sort out.',
    commonMistakes: [{ mistake: 'Converting before the payment terms are in.', fix: 'Add the payment terms to the quotation, then convert.' }],
    workedExample: "Tan Mei Ling's accepted quotation RQ-2611-008 R2: open it > Convert to sales order > sales order TC-SO-2611-031 with four instalments.",
    related: ['dc-create-quotation', 'dc-bill-instalment', 'dc-variation-order', 'dc-commission'],
    nextStep: 'Bill the first instalment and collect it (dc-bill-instalment, dc-collect-payment).',
    contact: 'Sales manager.',
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'dc-variation-order',
    title: 'Record a variation order (VO) on a renovation contract',
    keywords: ['variation order', 'vo', 'new vo', 'change contract', 'add on', 'omit', '加减单', '追加', '变更单', 'perubahan kerja', 'vo baru'],
    module: 'Sales',
    companies: ['dream_crafter'],
    purpose: 'Add or omit work on a signed contract with the customer\'s signature, so the contract sum, billing, purchasing and commission follow.',
    prerequisites: ['A live renovation sales order.'],
    who: 'Sales records it; someone with Full on Sales order approves and applies it.',
    // renovation.ts:509 create — PERM.quote (edit); :561 approve — PERM.voApply = scm.renovation.vo.apply (Sales order at full)
    permission: ['area:scSales:edit'],
    page: '/sales/orders',
    sidebar: 'SUPPLY CHAIN > Sales order > Sales orders',
    steps: [
      { do: 'Open the renovation sales order and, in "Variation orders", click "New VO".', highlight: 'New VO', then: 'The VO opens.' },
      {
        do: 'Give it a "Title" and "Date", add the new lines ("From package" or one by one) and tick the lines to omit under "Omit from the contract".',
        fields: [
          { label: 'Title', required: true, value: 'What changes.', example: "'Extra wardrobe in bedroom 2'" },
          { label: 'Date', required: true, value: 'The VO date: it decides which month it counts in for commission.', example: "'2026-12-02'" },
          { label: 'Omit qty', required: false, value: 'How much of a contract line is taken out.', example: "'1'" },
        ],
      },
      { do: 'Click "Save", then "Mark sent for signature" and give it to the customer.', highlight: 'Mark sent for signature' },
      {
        do: 'When the customer has signed, click "Approve and apply" and type "Signed by (customer)".',
        highlight: 'Approve and apply',
        check: 'Approving needs Full on Sales order. If someone else changed the VO, reload first.',
        then: 'The contract sum changes; the next instalments are recalculated and the project moves to "Ordering" if it was before it.',
      },
    ],
    checkBefore: ['Added and omitted lines and the net change are right.', 'The customer has signed.'],
    result: 'An applied VO on the sales order; the revised contract sum feeds billing (Progress billing), purchasing and commission.',
    warnings: ['Applying changes the contract sum at once; instalments not yet billed move with it.', 'A VO dated in a month counts in that month\'s commission tier.'],
    undo: 'Before it is applied: "Back to draft" or "Cancel VO". After: record another VO that reverses it.',
    approvals: 'Approve and apply needs Full on Sales order (the engine key scm.renovation.vo.apply).',
    commonMistakes: [{ mistake: 'Changing a contract line price directly on the sales order.', fix: 'Use "New VO": a renovation contract\'s lines change only through a VO.' }],
    workedExample: "Tan Mei Ling adds a wardrobe (RM 3,200): her sales order > New VO > Title 'Extra wardrobe in bedroom 2' > Date 2026-12-02 > add the wardrobe line > Save > Mark sent for signature > customer signs > Approve and apply > Signed by (customer) 'Tan Mei Ling'.",
    related: ['dc-convert-quotation', 'dc-bill-instalment', 'dc-commission'],
    contact: 'Sales manager.',
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'dc-project-stages',
    title: 'Move a renovation project through its stages (Signed to Closed)',
    keywords: ['project stage', 'stages', 'design', 'ordering', 'renovation stage', 'handover', 'close project', 'start date', '项目阶段', '进度', '开工', 'peringkat projek'],
    module: 'Projects',
    companies: ['dream_crafter'],
    purpose: 'Know what moves a project from one stage to the next, so the board shows where each renovation really is.',
    prerequisites: ['The project exists.'],
    who: 'Project coordinators and managers.',
    // services/renovation/flow.ts — stages derived from the facts; projects.write (Projects at edit) to change project data
    permission: ['area:projects:edit'],
    page: '/projects/list',
    sidebar: 'PROJECTS > Projects',
    steps: [
      {
        do: 'Open PROJECTS > Projects and click the project. The bar at the top ("Project stages") shows Signed, Design, Ordering, Renovation, Handover, Closed.',
        // flow.ts:4-11 — what completes each stage
        then: 'Signed completes when a sales order is linked; the project moves to Design only after the FIRST payment on that order.',
      },
      { do: 'Set the "Project start date" on the project (it schedules the package lines and their production days).' },
      { do: 'Design completes when every design step is done; Ordering when the sales order has a VO that is not cancelled (open the "VO" tab).', highlight: 'VO' },
      { do: 'Renovation completes when every product category on the sales order is complete (site work on the "Site & photos" tab).', highlight: 'Site & photos' },
      { do: 'On the "Defects" tab close every defect, then "Hand over" (dc-defects-handover). Closed needs Close pressed AND the contract fully paid (received at least the revised contract sum).', highlight: 'Defects' },
    ],
    checkBefore: ['The first payment really arrived before expecting Design.', 'Every defect is closed before handover.'],
    result: 'The project shows the stage the facts say; the board, the calendar and the late warnings follow.',
    warnings: ['A stage set by hand holds only until the data moves past it.', 'A project cannot be Closed while money is still owed on the contract.'],
    undo: 'Stages follow the data: fix the data (link the sales order, record the payment, cancel a wrong VO) and the stage follows.',
    deadlines: 'Each stage may have a number of days allowed (Project settings); late projects show red on the board.',
    commonMistakes: [{ mistake: 'Expecting Design while the deposit has not been recorded.', fix: 'Record the first payment on the sales order (dc-collect-payment).' }],
    workedExample: 'Tan Mei Ling paid the 10% deposit: the project moves from Signed to Design; after the design steps and the wardrobe VO it is in Ordering; when all categories are done it is in Renovation, then Hand over after the last defect is closed.',
    related: ['dc-create-project', 'dc-collect-payment', 'dc-variation-order', 'dc-defects-handover'],
    contact: 'Project manager.',
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'dc-defects-handover',
    title: 'Report a defect, get it fixed and hand the project over',
    keywords: ['defect', 'snag', 'touch up', 'handover', 'hand over', 'keys', 'customer signature', '缺陷', '补修', '交屋', '交钥匙', 'kecacatan', 'serah kunci'],
    module: 'Projects',
    companies: ['dream_crafter'],
    purpose: 'Track every defect found on site from report to fix to check, then hand the keys over with the customer\'s signature.',
    prerequisites: ['The project is on site (Renovation / Handover stage).'],
    who: 'Site supervisors and project coordinators.',
    // engine Defects tab writes with projects.write; the Defects page is its own area (projectDefects)
    permission: ['area:projects:edit'],
    page: '/projects/list',
    sidebar: 'PROJECTS > Projects (project) > Defects; all defects: PROJECTS > Defects',
    steps: [
      { do: 'Open the project and its "Defects" tab, then click "Report a problem".', highlight: 'Report a problem' },
      {
        do: 'Add photos, say what is wrong, who fixes it and by when, then click "Add to “To fix”".',
        fields: [
          // BetaDefectsTab.tsx:195-196 — a photo or video and the description are required
          { label: 'Photos or videos of the problem', required: true, value: 'At least one photo or video.', example: "'IMG_2041.jpg'" },
          { label: "What's wrong", required: true, value: 'One line.', example: "'cabinet door not aligned'" },
          { label: 'Who fixes it', required: false, value: 'The contractor or staff member.', example: "'Ah Hock Carpentry'" },
          { label: 'Fix by', required: false, value: 'Due date.', example: "'2027-03-20'" },
        ],
        then: 'The defect moves To fix > Check > Done as the contractor fixes it and you check and close it.',
      },
      {
        do: 'When every defect is closed, click "Hand over", type "Signed by" and "Keys handed over", get the "Customer signature" and confirm with "Hand over".',
        highlight: 'Hand over',
        // BetaDefectsTab.tsx:123 — disabled until every defect is closed ("Close every defect first")
        check: '"Hand over" stays disabled until every defect is closed.',
        then: 'The project shows Handed over on <date>; tasks not finished stay open.',
      },
    ],
    checkBefore: ['Every defect closed and checked.', 'The customer signs in person.'],
    result: 'Handover recorded with the signature and the number of keys; the project moves to Handover complete, then Closed when fully paid.',
    warnings: ['The handover signature is the customer\'s acceptance of the work.'],
    undo: 'A defect closed by mistake can be reopened from it; a handover is a signed record and is not undone here.',
    commonMistakes: [{ mistake: 'Reporting a defect without a photo.', fix: 'Add a photo or video: the form does not save without one.' }],
    workedExample: "At the final walk-through: Defects > Report a problem > photo > What's wrong 'cabinet door not aligned' > Who fixes it 'Ah Hock Carpentry' > Fix by 2027-03-20 > Add to “To fix”; once fixed and checked: Hand over > Signed by 'Tan Mei Ling' > Keys handed over 3 > signature > Hand over.",
    related: ['dc-project-stages'],
    contact: 'Project manager.',
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'dc-bill-instalment',
    title: 'Bill the next instalment of a renovation contract (sales invoice)',
    keywords: ['bill instalment', 'progress billing', 'progress claim', 'sales invoice', 'invoice customer', '开发票', '进度款', '请款', 'invois', 'tuntutan kemajuan'],
    module: 'Sales invoices',
    companies: ['dream_crafter'],
    purpose: 'Raise the sales invoice for the next payment of the contract, at least what the schedule asks and at most the rest of the contract.',
    prerequisites: ['A live renovation sales order with payment terms.'],
    who: 'Finance, or the salesperson for their own contracts.',
    // renovation.ts:478 — scm.renovation.bill (Invoices and payments at edit) or bill_own (Sales order at edit, own contracts)
    permission: [],
    permissionAny: ['area:scInvoices:edit', 'area:scSales:edit'],
    page: '/sales/orders',
    sidebar: 'SUPPLY CHAIN > Sales order > Sales orders',
    steps: [
      { do: 'Open the renovation sales order. Under "Progress billing" the next instalment is highlighted.' },
      {
        do: 'Click "Bill" on that instalment (on a phone: "Bill this instalment").',
        highlight: 'Bill',
        fields: [
          // renovation-billing.ts:404,408 — at least the schedule, at most the rest of the contract
          { label: 'Amount', required: true, value: 'Pre-filled with what the schedule asks; you may bill more, up to the rest of the contract, never less.', example: "'25,600.00'" },
        ],
        // renovation-billing.ts:386 — instalments are billed in order
        check: 'Instalments are billed in order; if a VO changed the contract since you opened the screen, the new amount is shown and you bill again.',
        then: 'The sales invoice (or, for a negative instalment after an omission, a credit note) is created and its journal posted. Click "Done".',
      },
    ],
    checkBefore: ['The stage the instalment is tied to is really reached.', 'The amount matches what you tell the customer.'],
    result: 'A sales invoice for the instalment on SUPPLY CHAIN > Sales order > Sales invoices, linked to the contract; the customer owes it.',
    warnings: ['A billed instalment cannot be billed again.', 'An e-invoice warning may appear when the customer\'s details are incomplete.'],
    undo: 'A wrong invoice is reversed with a "Credit note" on the sales order (Invoices and payments at edit).',
    commonMistakes: [{ mistake: 'Trying to bill instalment 3 before 2.', fix: 'Bill them in order: the system names the one to bill first.' }],
    workedExample: "Tan Mei Ling's contract RM 64,000, second instalment 40%: her sales order > Progress billing > instalment 2 > Bill > Amount 25,600.00 > confirm > sales invoice created > Done.",
    related: ['dc-convert-quotation', 'dc-collect-payment', 'dc-variation-order'],
    nextStep: 'Collect the money (dc-collect-payment).',
    contact: 'Finance lead.',
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'dc-collect-payment',
    title: "Record a customer's payment on a renovation sales order",
    keywords: ['collect payment', 'customer payment', 'deposit', 'payment received', 'official receipt', '收款', '收订金', '客户付款', 'terima bayaran', 'deposit pelanggan'],
    module: 'Sales',
    companies: ['dream_crafter'],
    purpose: 'Record money the customer paid against the contract; the first payment moves the project from Signed to Design and payments release commission.',
    prerequisites: ['The renovation sales order exists.'],
    who: 'Finance and sales.',
    // SalesOrderDetail.tsx:2405 — Collect payment is offered by the payments ledger's own gate (Sales order at edit)
    permission: ['area:scSales:edit'],
    page: '/sales/orders',
    sidebar: 'SUPPLY CHAIN > Sales order > Sales orders',
    steps: [
      { do: 'Open the sales order and click "Collect payment".', highlight: 'Collect payment', then: 'The payments card opens.' },
      {
        do: 'Add the payment line.',
        fields: [
          { label: 'Date', required: true, value: 'The day the money arrived.', example: "'2026-12-01'" },
          { label: 'Method', required: true, value: 'How it was paid (transfer, card, cash...).', example: "'Online transfer'" },
          { label: 'Amount', required: true, value: 'What was received, in RM.', example: "'6,400.00'" },
          { label: 'Slip', required: false, value: 'Attach the bank slip.', example: "'slip-0112.jpg'" },
        ],
      },
      { do: 'Click "Done" to save the payments.', then: 'The payment shows on the order; the project moves to Design on the first one.' },
    ],
    checkBefore: ['The amount matches the bank statement.'],
    result: 'The payment is on the sales order; finance confirms it and the commission release follows the collected share.',
    warnings: ['Commission is released from money finance has confirmed, not from what is typed here alone.'],
    undo: 'Finance corrects or removes a wrong payment line on the order before it is confirmed.',
    commonMistakes: [{ mistake: 'Recording the deposit on the quotation instead of the sales order.', fix: 'Convert the quotation first, then collect the payment on the sales order.' }],
    workedExample: "Tan Mei Ling paid the 10% deposit RM 6,400 by transfer on 1 December: her sales order > Collect payment > Date 2026-12-01 > Method Online transfer > Amount 6,400.00 > Slip > Done.",
    related: ['dc-bill-instalment', 'dc-project-stages', 'dc-commission'],
    contact: 'Finance lead.',
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'dc-add-supplier',
    title: 'Add a supplier or contractor',
    keywords: ['new supplier', 'add supplier', 'contractor', 'subcontractor', 'vendor', '新供应商', '加供应商', '承包商', '师傅', 'pembekal baru', 'kontraktor'],
    module: 'Procurement',
    companies: ['dream_crafter'],
    purpose: 'Create the supplier or contractor record that purchase orders, purchase invoices and payment vouchers are made out to.',
    prerequisites: ['The company name; ideally TIN and registration numbers for e-invoicing.'],
    who: 'Procurement staff.',
    // engine/backend/src/scm/routes/suppliers.ts:582 POST / — the Procurement area at edit (engine page scm.procurement)
    permission: ['area:scProcurement:edit'],
    page: '/procurement/suppliers',
    sidebar: 'SUPPLY CHAIN > Procurement > Suppliers',
    steps: [
      { do: 'Open SUPPLY CHAIN > Procurement > Suppliers and click "New Supplier".', highlight: 'New Supplier', then: 'The "New supplier" panel opens.' },
      {
        do: 'Fill the supplier.',
        fields: [
          // suppliers.ts:495 — name required
          { label: 'Company Name *', required: true, value: 'The registered name.', example: "'Ah Hock Carpentry Sdn Bhd'" },
          { label: 'Supplier Type', required: false, value: 'e.g. contractor or material supplier.', example: "'Contractor'" },
          { label: 'TIN Number', required: false, value: 'Tax number, for e-invoices.', example: "'C2345678901'" },
          { label: 'Business Reg No', required: false, value: 'SSM number.', example: "'201901012345'" },
          { label: 'Contact Person', required: false, value: 'Who to call.', example: "'Mr Lim'" },
          { label: 'Phone', required: false, value: 'Office phone.', example: "'03-7788 1122'" },
          { label: 'Email', required: false, value: 'Where POs are emailed.', example: "'orders@ahhock.my'" },
        ],
      },
      { do: 'Click "Create".', then: 'The supplier is listed and can be picked on purchase orders and payment vouchers.' },
    ],
    checkBefore: ['The supplier is not already on the list under another spelling.'],
    result: 'A new supplier with its own creditor account.',
    warnings: ['Bank details on the supplier decide where payments go: check them.'],
    undo: 'Open the supplier and edit it.',
    commonMistakes: [{ mistake: 'Adding the same contractor twice.', fix: 'Search the list first; edit the existing one.' }],
    workedExample: "New carpentry contractor: Suppliers > New Supplier > Company Name 'Ah Hock Carpentry Sdn Bhd' > Supplier Type 'Contractor' > Contact Person 'Mr Lim' > Phone > Create.",
    related: ['dc-purchase-order', 'dc-pay-supplier'],
    contact: 'Procurement lead.',
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'dc-purchase-order',
    title: 'Raise a purchase order to a supplier or contractor',
    keywords: ['purchase order', 'po', 'new po', 'order material', 'order from supplier', '采购单', '开PO', '下单', 'pesanan belian'],
    module: 'Procurement',
    companies: ['dream_crafter'],
    purpose: 'Order materials or contract work for a renovation from one supplier, so the goods receipt, purchase invoice and payment are matched against it.',
    prerequisites: ['The supplier exists (dc-add-supplier).'],
    who: 'Procurement staff.',
    // engine/backend/src/conts/access.ts:126 — POs with Procurement at edit
    permission: ['area:scProcurement:edit'],
    page: '/procurement/purchase-orders',
    sidebar: 'SUPPLY CHAIN > Procurement > Purchase orders',
    steps: [
      { do: 'Open SUPPLY CHAIN > Procurement > Purchase orders and click "New Purchase Order".', highlight: 'New Purchase Order', then: 'The "New purchase order" page opens.' },
      { do: 'In "Header" pick the supplier (creditor), the "Expected Delivery" date, the warehouse ("Pick a warehouse") and any "Notes".' },
      { do: 'Add the lines: item, quantity and price (the supplier\'s bound price fills in).' },
      { do: 'Click "Create Purchase Order".', highlight: 'Create Purchase Order', then: 'The PO is saved with its number and listed on Purchase orders.' },
    ],
    checkBefore: ['Right supplier, quantities and prices.', 'Lines tied to the right project when asked.'],
    result: 'A purchase order on the list; goods received against it later (Goods receipt), then the supplier\'s invoice.',
    warnings: ['Emailing or printing the PO sends it to the supplier.'],
    undo: 'Edit the PO while nothing is received; ask for a cancellation (Cancellation requests) after that.',
    commonMistakes: [{ mistake: 'Ordering from a supplier the item is not bound to.', fix: 'Pick the supplier first: the item list follows; a one-off purchase can use any creditor.' }],
    workedExample: "Order 20 sheets of 18 mm plywood from 'Ah Hock Carpentry Sdn Bhd' for Vertica 12-03: Purchase orders > New Purchase Order > supplier > Expected Delivery 2026-12-08 > line plywood 20 > Create Purchase Order.",
    related: ['dc-add-supplier', 'dc-purchase-invoice'],
    contact: 'Procurement lead.',
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'dc-purchase-invoice',
    title: "Record a supplier's purchase invoice",
    keywords: ['purchase invoice', 'supplier invoice', 'supplier bill', 'pi', '供应商发票', '进货单', '入账', 'invois pembekal'],
    module: 'Purchase invoices',
    companies: ['dream_crafter'],
    purpose: 'Record what the supplier billed, against the PO / goods receipt, so it can be paid and the project cost is right.',
    prerequisites: ['The supplier exists; ideally the goods were received against a PO.'],
    who: 'Finance / procurement.',
    // engine/backend/src/conts/access.ts:41 INVOICE_PAGES — scm.procurement.pi follows Invoices and payments
    permission: ['area:scInvoices:edit'],
    page: '/procurement/purchase-invoices',
    sidebar: 'SUPPLY CHAIN > Procurement > Purchase invoices',
    steps: [
      { do: 'Open SUPPLY CHAIN > Procurement > Purchase invoices and click "New Purchase Invoice".', highlight: 'New Purchase Invoice' },
      { do: 'Pick the supplier and the goods receipt (or the lines), type the supplier\'s invoice number, date and amounts; use "Account only, no stock item" for a non-stock line.' },
      { do: 'Save the invoice.', then: 'It is listed on Purchase invoices and waits for payment (dc-pay-supplier).' },
    ],
    checkBefore: ["The supplier's invoice number and total match the paper invoice.", 'It is not already recorded (duplicates are flagged).'],
    result: 'A purchase invoice the company owes, shown in the supplier ledger and creditor ageing.',
    warnings: ['The same supplier bill recorded twice would be paid twice.'],
    undo: 'Cancel the purchase invoice and record it again.',
    commonMistakes: [{ mistake: 'Typing the PO number as the supplier invoice number.', fix: "Use the number printed on the supplier's invoice." }],
    workedExample: "Ah Hock's invoice INV-7781 for the plywood: Purchase invoices > New Purchase Invoice > supplier > the goods receipt > invoice no 'INV-7781' > save.",
    related: ['dc-purchase-order', 'dc-pay-supplier'],
    contact: 'Finance lead.',
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'dc-pay-supplier',
    title: 'Pay a supplier or contractor with a payment voucher',
    keywords: ['payment voucher', 'pay supplier', 'pay contractor', 'pv', '付款单', '付供应商', '付款', 'baucar bayaran', 'bayar pembekal'],
    module: 'Finance',
    companies: ['dream_crafter'],
    purpose: 'Record a payment to a supplier or contractor (against their invoices) so the payables and the bank are right.',
    prerequisites: ['The supplier and their invoice exist.'],
    who: 'Finance; checking, approving and posting vouchers is for Full on the Ledger.',
    // engine/backend/src/conts/ledger-access.ts:17 — Ledger at edit creates vouchers; full checks / approves / posts
    permission: ['area:ledger:edit'],
    page: '/supply/finance/payment-vouchers',
    sidebar: 'FINANCE > Suppliers > Payment vouchers',
    steps: [
      { do: 'Open FINANCE > Suppliers > Payment vouchers and click "New Payment Voucher".', highlight: 'New Payment Voucher', then: 'The "New payment voucher" page opens.' },
      { do: 'Choose "Payment", pick the supplier (the payee fills in), the "Paid From" bank account and the invoices or lines being paid.', highlight: 'Payment' },
      { do: 'Click "Create Voucher".', highlight: 'Create Voucher', then: 'The voucher is saved and waits to be checked, approved and posted.' },
    ],
    checkBefore: ['Payee and amount match the invoice.', 'The right bank account under "Paid From".'],
    result: 'A payment voucher on the list; once posted, the supplier\'s balance and the bank move.',
    warnings: ['The money itself is transferred at the bank.'],
    undo: 'Before posting, edit or cancel the voucher; cancelling a posted one needs Full on the Ledger.',
    approvals: 'Vouchers are checked and approved by people with Full on the Ledger before posting.',
    commonMistakes: [{ mistake: 'Paying from the wrong bank account.', fix: 'Change "Paid From" before the voucher is posted.' }],
    workedExample: "Pay Ah Hock RM 4,800 for INV-7781: Payment vouchers > New Payment Voucher > Payment > supplier Ah Hock > Paid From Maybank current > tick INV-7781 > Create Voucher.",
    related: ['dc-purchase-invoice', 'hand-in-claim'],
    contact: 'Finance lead.',
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'dc-commission',
    title: 'See and pay sales commission on renovation contracts',
    keywords: ['commission', 'my commission', 'sales commission', 'commission payout', '佣金', '我的佣金', '提成', 'komisen'],
    module: 'Commission',
    companies: ['dream_crafter'],
    purpose: 'Salespeople see what they earned and can claim; management records the payouts. Worked out from the contracts, their VOs and the money collected; nothing to type for the amounts.',
    prerequisites: ['A commission scheme for the brand (Settings on the Commission page).'],
    who: 'Salespeople (their own share); management (everyone, and payouts).',
    // engine/frontend/src/App.tsx:839 — /scm/commission management only (Full on the Ledger menu); /scm/my-commission own share
    permission: ['area:myCommission:view'],
    page: '/supply/my-commission',
    sidebar: 'HOME > My commission (salesperson); FINANCE > Reports > Commission (management)',
    steps: [
      {
        do: 'Salesperson: open HOME > My commission.',
        then: '"Can claim now", "Earned so far" and "Paid", and your orders with how each adds up ("Contract", "Collected", "Commission released", "Total commission").',
      },
      {
        do: 'Management: open FINANCE > Reports > Commission, pick a person and an order, and click "Record payout".',
        page: '/supply/finance/commission',
        highlight: 'Record payout',
        then: 'The payout is recorded against that order and person; "Take back" reverses one (never deleted).',
      },
    ],
    checkBefore: ['The collected money is confirmed by finance.'],
    result: 'Commission paid is shown under "Paid" for the person and the order.',
    // scm/shared/renovation-commission.ts:6-15 — tiers by month, manager rate, release in stages as the customer pays
    warnings: [
      "The salesperson's rate is the tier their sales reach in the month; a VO counts in the month it is dated.",
      'Commission is released in stages as the customer pays, from money finance has confirmed.',
    ],
    undo: '"Take back" a payout recorded by mistake ("Yes, take back").',
    commonMistakes: [{ mistake: 'Expecting commission on an order nobody has paid yet.', fix: 'It releases as the customer pays: collect the payment first.' }],
    workedExample: "Jason sold RM 110,000 in December (1% tier): My commission shows the orders; after the second payment half the commission is released and management clicks Record payout for it.",
    related: ['dc-convert-quotation', 'dc-variation-order', 'dc-collect-payment'],
    contact: 'Management.',
  },
];
