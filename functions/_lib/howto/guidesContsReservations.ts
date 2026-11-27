/**
 * howto/guidesContsReservations.ts: process help for The Conts' reservations: create one, check guests in and out,
 * take a guest payment and issue the receipt, change dates or cancel. Written from the real screens:
 *   src/pages/BookingsPage.tsx (Reservations list, Create reservation modal)
 *   src/components/booking/BookingDrawer.tsx (the reservation drawer: money, documents, dates, status)
 *   src/components/booking/GuestDocuments.tsx (Issue invoice / Issue receipt / Void)
 *   src/pages/OperationsTodayPage.tsx (Guest arrived / Guest left)
 * and the handlers they call (functions/api/reservations/*, housekeeping/guest-left.ts, guest-documents/*,
 * _lib/bookingLifecycle.ts). Every enforced rule carries a code citation in a comment beside it; the text the person
 * reads never cites code.
 */
import type { HowToGuide } from './types';

export const GUIDES: HowToGuide[] = [
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'create-reservation',
    title: 'Create a reservation (direct guest, missed channel reservation or owner stay)',
    keywords: [
      'create reservation', 'new reservation', 'add reservation', 'direct reservation', 'walk in', 'owner stay', 'book a unit',
      'booking', 'new booking', // vocab-ok: words staff type when they ask, matched as search keywords only
      '订房', '新订单', '开订单', '直接订房', '业主自住',
      'tempahan baru', 'buat tempahan',
    ],
    module: 'Reservations',
    companies: ['conts'],
    purpose:
      'Record a reservation that did not come in from a channel by itself: a direct guest, a channel reservation that failed to arrive, or an owner staying in their own unit. The dates are held on the calendar and blocked on every channel the unit is listed on.',
    prerequisites: [
      'The unit exists under UNITS > Units and is a rental unit (showrooms and warehouses take no reservations).',
      'The dates are free: the system refuses a reservation that overlaps another reservation of the same unit.',
      'For a direct guest: the guest name, and ideally a phone number or email.',
    ],
    who: 'Reservations / front-desk staff and operations.',
    // functions/api/reservations/index.ts:92 onRequestPost: session middleware gates POST /api/reservations on the
    // Reservations area at edit or above; field roles (cleaners, technicians) are refused outright (:95).
    permission: ['POST /api/reservations'],
    page: '/reservations/bookings',
    sidebar: 'RESERVATIONS > Reservations',
    steps: [
      {
        do: 'Open RESERVATIONS > Reservations and click "Create reservation" at the top right.',
        highlight: 'Create reservation',
        then: 'The "Create reservation" window opens.',
      },
      {
        do: 'Choose what kind of stay it is under "What is this", then pick the unit.',
        fields: [
          {
            label: 'What is this',
            required: true,
            // src/pages/BookingsPage.tsx:671 — Direct / From a channel / Owner stay
            value: '"Direct" for a guest who pays us; "From a channel" for an Airbnb, Booking.com or Agoda reservation that did not arrive by itself; "Owner stay" when the owner (or someone they send) stays free.',
            example: "'Direct'",
          },
          {
            label: 'Unit',
            required: true,
            // functions/api/reservations/index.ts:109,111 — unit must exist and be a rental unit
            value: 'Type the building or unit number and pick it. Nothing is chosen for you, so pick carefully: a wrong unit blocks the wrong dates.',
            example: "'Vertica A-12-03'",
          },
        ],
      },
      {
        do: 'For "From a channel" only: pick the channel and type its reference.',
        fields: [
          { label: 'Channel', required: true, value: 'Airbnb, Booking.com or Agoda.', example: "'Booking.com'" },
          {
            label: 'Channel reference',
            required: false,
            // functions/api/reservations/index.ts:119,124 — a channel reference is kept as the reservation number (max 60 characters)
            value: "The reservation code from the channel's own email. It becomes the reservation number; without it the system gives the next number.",
            example: "'HMF4323EHS'",
          },
        ],
      },
      {
        do: 'Type the guest details, the dates and the money.',
        fields: [
          {
            label: 'Guest name',
            required: true,
            // src/pages/BookingsPage.tsx:648-651 — required unless Owner stay ("Who is staying (optional)")
            value: 'Full name. For an owner stay the box is "Who is staying (optional)" and defaults to the owner.',
            example: "'Jane Tan'",
          },
          {
            label: 'Phone',
            required: false,
            // functions/api/reservations/index.ts:104 — checkPhone: must be a valid phone number when given
            value: 'A valid phone number with country code; an existing guest with the same phone or email is reused.',
            example: "'+60 12-345 6789'",
          },
          { label: 'Email', required: false, value: 'The guest email.', example: "'jane@example.com'" },
          {
            label: 'Stay',
            required: true,
            // functions/api/reservations/index.ts:106 — checkout must be after check-in; :1001 min = yesterday
            value: 'Check-in and checkout dates. Checkout must be after check-in (at least one night).',
            example: "'2026-12-05 to 2026-12-08'",
          },
          {
            label: 'Check-in from',
            required: false,
            // functions/api/reservations/index.ts:112 — times are HH:MM; default 15:00 / 11:00
            value: 'HH:MM, default 15:00. Earlier for an early check-in.',
            example: "'15:00'",
          },
          { label: 'Checkout by', required: false, value: 'HH:MM, default 11:00. Later for a late checkout.', example: "'11:00'" },
          {
            label: 'Guests',
            required: true,
            // src/pages/BookingsPage.tsx:697 — stepper 1-16; functions/api/reservations/index.ts:103 — at least 1
            value: 'Number of guests, 1 to 16.',
            example: "'2'",
          },
          {
            label: 'Guest total for the stay (RM)',
            required: false,
            // functions/api/reservations/index.ts:105,128 — checkSen; owner stays are saved at 0
            value: 'What the guest pays for the whole stay, in RM with two decimals. Not shown for an owner stay (it earns nothing).',
            example: "'780.00'",
          },
          { label: 'Notes (optional)', required: false, value: 'Up to 2000 characters, kept as staff notes on the reservation.', example: "'Arrives late, around 21:00'" },
        ],
      },
      {
        do: 'Click "Create reservation" (for an owner stay the button is "Save owner stay").',
        highlight: 'Create reservation',
        check: 'The unit, the dates and the guest total are right. The button stays disabled until a unit, a guest name (not for an owner stay), valid dates and the number of guests are filled.',
        // functions/api/reservations/index.ts:115-131 — saved as confirmed, channel hold queued, turnover clean ensured
        then: 'A toast says Reservation <number> created. and the reservation opens in its drawer. The dates show on the calendar, a cleaning job is planned for the checkout, and the dates are blocked on the channels the unit is listed on.',
      },
    ],
    checkBefore: [
      'The right unit (building and unit number), not a showroom or warehouse.',
      'Check-in and checkout dates, and the times if the guest arrives early or leaves late.',
      'The guest total is for the whole stay, not per night.',
    ],
    result:
      'A confirmed reservation in RESERVATIONS > Reservations and on RESERVATIONS > Calendar, with a cleaning job planned on the checkout day. A direct reservation counts in income for its months at once; an owner stay holds the nights and earns nothing.',
    warnings: [
      // functions/api/reservations/index.ts:130 holdOnChannels
      'The dates are blocked on Airbnb, Booking.com and Agoda for that unit straight away.',
      // functions/api/reservations/index.ts:117 findClash — DATE_CONFLICT
      'An overlapping reservation on the same unit is refused with (Blocked. This unit already has <guest> on those dates.)',
      // functions/api/reservations/index.ts:134 incomeNotice
      'If the month is already locked for owner statements, a notice says so: the income lands in a locked month and finance must know.',
    ],
    // functions/api/reservations/[id]/dates.ts — Change dates; _lib/bookingLifecycle.ts:62 — Cancel reservation needs a reason
    undo:
      'Open the reservation and use "Change dates" to move it, or "Cancel reservation" (a reason is required) to release the dates. Reinstating a cancelled reservation is management only.',
    commonMistakes: [
      { mistake: 'Typing a channel reservation in as "Direct".', fix: 'Choose "From a channel" and type the "Channel reference", so it is not counted as our own guest and its money is the channel\'s.' },
      { mistake: 'Entering the nightly price in "Guest total for the stay (RM)".', fix: 'Type the total for all nights; "Change dates" on the reservation can correct it while it is not yet past.' },
      { mistake: 'Picking the wrong unit from a similar number.', fix: 'Cancel the reservation (with the reason "wrong unit") and create it again on the right unit.' },
    ],
    workedExample:
      "Direct guest 'Jane Tan', 2 guests, 5 to 8 December in 'Vertica A-12-03' for RM 780.00: Create reservation > What is this 'Direct' > unit 'Vertica A-12-03' > Guest name 'Jane Tan' > Phone '+60 12-345 6789' > Stay 5 Dec to 8 Dec > Guests 2 > Guest total 780.00 > Create reservation.",
    related: ['record-guest-payment', 'check-in-check-out', 'change-or-cancel-reservation', 'block-dates-calendar'],
    nextStep: 'When the guest pays, record the payment and issue the receipt (record-guest-payment).',
    contact: 'Reservations lead / operations manager.',
    variants: [
      {
        case: 'Owner stay',
        differences: [
          'Pick "Owner stay"; the name box becomes "Who is staying (optional)" and there is no guest total.',
          'The button is "Save owner stay". Owner stays show on the calendar and the unit page, not in the Reservations list.',
        ],
      },
      {
        case: 'Many reservations at once',
        differences: ['"Import" on the Reservations list reads a CSV with the columns unit, guest, channel, checkin, checkout (optional: guests, rate, phone, reference) and shows the rows before importing.'],
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'check-in-check-out',
    title: 'Check a guest in and out (Guest arrived / Guest left)',
    keywords: [
      'check in', 'check-in', 'check out', 'checkout', 'guest arrived', 'guest left', 'mark guest out', 'currently hosting',
      '入住', '退房', '客人到了', '客人走了', '办理入住',
      'daftar masuk', 'daftar keluar', 'tetamu keluar',
    ],
    module: 'Operations',
    companies: ['conts'],
    purpose:
      'Tell the system the guest is in the unit (it shows "Currently hosting") and, on the last day, that the guest has left so the cleaners see the unit is ready to clean.',
    prerequisites: [
      'A confirmed reservation checking in (or out) today.',
      // functions/_lib/bookingLifecycle.ts:72-76 — Check in only from the check-in day until before the checkout day
      'Check-in can be marked only from the check-in day until the day before checkout.',
    ],
    who: 'Front desk, operations and the cleaning team lead.',
    // src/pages/OperationsTodayPage.tsx:92 PATCH /api/reservations/:id {state: checked_in}; :83 POST /api/housekeeping/guest-left
    permission: ['PATCH /api/reservations/x'],
    permissionAny: ['POST /api/housekeeping/guest-left'], // vocab-ok: an API path, not a word on screen
    page: '/operations/today',
    sidebar: 'OPERATIONS > Today',
    steps: [
      {
        do: 'Open OPERATIONS > Today. Keep "Today" selected at the top (not "Tomorrow").',
        then: 'You see the "Check-ins" and "Checkouts" panels for today, each unit with its guest and time.',
      },
      {
        do: 'When a guest arrives, find them under "Check-ins" and click "Guest arrived".',
        highlight: 'Guest arrived',
        // src/pages/OperationsTodayPage.tsx:158 — only today, only a confirmed reservation, not an owner stay
        check: 'The button shows only today, for a confirmed reservation (not an owner stay). If the unit badge says cleaning is not finished, check the unit before handing over the keys.',
        then: 'Toast <unit>: guest checked in. The line shows "Currently hosting" and the time the guest arrived.',
      },
      {
        do: 'If the guest comes early or late, click "Change check-in time" on their line, set the time and click "Save time".',
        highlight: 'Change check-in time',
      },
      {
        do: 'When the guest leaves, find them under "Checkouts" and click "Guest left".',
        highlight: 'Guest left',
        // functions/api/housekeeping/guest-left.ts:38 — refused before the checkout day
        check: 'Only on the checkout day; before that the system refuses (This guest checks out on ...).',
        then: 'Toast <unit>: guest out. The cleaning job for that unit shows ready to clean on OPERATIONS > Cleaning.',
      },
    ],
    checkBefore: ['It is the right unit and guest (two units in the same building can have similar numbers).', 'For "Guest left": the guest really has gone and returned the keys.'],
    result:
      'Check-in: the reservation moves to Checked in ("Currently hosting"). Guest left: the cleaning job for the checkout is marked guest out, so the cleaners can start; the reservation itself is checked out from its drawer ("Check out").',
    warnings: [
      // functions/_lib/bookingLifecycle.ts:84-86 — Undo check-in management only, same day
      'Undoing a check-in or a checkout is management only, and only on the same day.',
      'Marking a guest out too early sends a cleaner into an occupied unit.',
    ],
    // functions/api/housekeeping/guest-left.ts:41-56 — undo (office only) while the job has not finished; _lib/bookingLifecycle.ts:84-96
    undo:
      'Guest left marked by mistake: on OPERATIONS > Cleaning the office can undo it while the cleaning job is not finished. Check-in by mistake: management can use "Undo check-in" in the reservation drawer on the same day.',
    deadlines: 'Check-in can be marked from the check-in day; Guest left only on the checkout day.',
    commonMistakes: [
      { mistake: 'Looking for "Guest arrived" on tomorrow\'s list.', fix: 'Switch the day back to "Today": check-ins are marked only on the day.' },
      { mistake: 'A guest left a day early and "Guest left" is refused.', fix: "Change the reservation's dates first (\"Change dates\" in the drawer), then mark them out." },
    ],
    workedExample:
      "Jane Tan arrives at 14:10 at 'Vertica A-12-03': Today > Check-ins > A-12-03 > Guest arrived. On 8 December she leaves at 10:30: Today > Checkouts > A-12-03 > Guest left; Cleaning shows A-12-03 ready to clean.",
    related: ['create-reservation', 'assign-cleaning-job', 'change-or-cancel-reservation'],
    nextStep: 'The cleaning team does the cleaning job (assign-cleaning-job).',
    contact: 'Operations manager.',
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'record-guest-payment',
    title: 'Record a guest payment or host payout and issue the receipt',
    keywords: [
      'record payment', 'guest paid', 'payment received', 'receipt', 'issue receipt', 'official receipt', 'guest invoice', 'refund guest', 'host payout received',
      '收款', '客人付款', '开收据', '收据', '发票', '退款',
      'rekod bayaran', 'resit', 'bayaran tetamu',
    ],
    module: 'Reservations',
    companies: ['conts'],
    purpose:
      "Record money received for a reservation (from a direct guest, or the channel's host payout), so the balance due is right, and issue the guest an official receipt or invoice.",
    prerequisites: [
      'The reservation exists (not a block or an owner stay: those take no payments).',
      // functions/api/reservations/[id]/payments.ts:28 — Finance edit
      'You have Finance access at edit level: recording payments and issuing receipts is finance work.',
    ],
    who: 'Finance staff.',
    // access.ts ROUTE_AREAS — POST /api/reservations/:id/payments and POST /api/guest-documents follow the Finance area
    permission: ['POST /api/reservations/x/payments'],
    page: '/reservations/bookings',
    sidebar: 'RESERVATIONS > Reservations',
    steps: [
      {
        do: 'Open RESERVATIONS > Reservations, search the guest name, phone or reference, and click the reservation to open its drawer.',
        then: 'The drawer shows "Guest paid" or "Host payout" with "Payments", "Received earlier" and "Balance due".',
      },
      {
        do: 'Click "Record payment".',
        highlight: 'Record payment',
        fields: [
          {
            label: 'What is this',
            required: true,
            // src/components/booking/BookingDrawer.tsx:468 — From the guest / Host payout / Refund
            value: '"From the guest" for a direct guest\'s money, "Host payout" for what Airbnb / Booking.com / Agoda paid us, "Refund" for money given back.',
            example: "'From the guest'",
          },
          {
            label: 'Amount (RM)',
            required: true,
            // src/components/booking/BookingDrawer.tsx:443 — at least RM 0.01; a refund at most what was received
            value: 'Pre-filled with what is still outstanding. At least 0.01; a refund can be at most what was received.',
            example: "'780.00'",
          },
          { label: 'Received on', required: true, value: 'The date the money arrived; not in the future. For a refund the box is "Refunded on".', example: "'2026-12-05'" },
          { label: 'Method', required: true, value: 'How it was paid, e.g. bank transfer or cash.', example: "'Bank transfer'" },
          { label: 'Reference (optional)', required: false, value: 'Bank or receipt reference.', example: "'MBB 0412 7781'" },
          { label: 'Note (optional)', required: false, value: 'e.g. deposit or balance at check-in.', example: "'Balance at check-in'" },
        ],
        check: 'The amount and date match the bank statement.',
        then: 'Toast Payment of RM ... recorded. with what is still outstanding. The payment is listed under "Payments".',
      },
      {
        do: 'Under "Documents" click "Issue receipt" on that payment (one receipt per payment), or "Issue invoice" for an invoice of the stay.',
        highlight: 'Issue receipt',
        // functions/api/guest-documents/index.ts:63 — a receipt is for a payment the guest made
        check: 'Receipts are for payments "From the guest" only; a host payout has no receipt.',
        then: 'Toast Receipt <number> issued. Click "View" to print it or save it as PDF and send it to the guest.',
      },
    ],
    checkBefore: ['Right reservation (guest name and dates).', 'Amount, date and method match the money that really arrived.'],
    result:
      'The payment shows in the reservation drawer and the balance due drops; the receipt or invoice gets the next number and appears under "Documents".',
    warnings: [
      // functions/api/reservations/[id]/payments.ts:54 — refunds with approvals on need a reason and wait for approval
      'When approval rules are on, a refund is not recorded at once: it waits for a second person on FINANCE > Approvals, and you must give the reason.',
      // src/components/booking/GuestDocuments.tsx:99 — void keeps the number
      'A voided receipt or invoice keeps its number, struck through; the number is never issued again.',
      'If the month is already locked for owner statements, a notice says the payment lands in a locked month.',
    ],
    // functions/api/reservations/[id]/payments/[paymentId].ts:19 — void the receipt before removing its payment
    undo:
      'Wrong document: "Void" it with a reason, then issue a new one. Wrong payment: void its receipt first, then remove the payment with "Remove this payment" (Finance edit). Payment lines that came from the owner workbook cannot be removed here.',
    approvals: 'Refunds need a second person\'s approval when Settings > Approval rules says money going out waits for approval.',
    commonMistakes: [
      { mistake: 'Recording an Airbnb payout as "From the guest".', fix: 'Remove the payment and record it again as "Host payout".' },
      { mistake: 'Trying to remove a payment that has a receipt.', fix: 'Void the receipt first ("Void" > reason > "Void document"), then remove the payment.' },
    ],
    workedExample:
      "Jane Tan paid RM 780.00 by bank transfer on 5 December: open her reservation > Record payment > From the guest > Amount 780.00 > Received on 2026-12-05 > Method Bank transfer > Reference 'MBB 0412 7781' > Record payment > Issue receipt > View > print.",
    related: ['create-reservation', 'owner-statement-generate'],
    contact: 'Finance lead.',
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'change-or-cancel-reservation',
    title: 'Change the dates of a reservation or cancel it',
    keywords: [
      'change dates', 'extend stay', 'move reservation', 'cancel reservation', 'no show', 'shorten stay', 'reinstate',
      '改日期', '延长', '取消订单', '取消订房', '没来',
      'tukar tarikh', 'batal tempahan',
    ],
    module: 'Reservations',
    companies: ['conts'],
    purpose: 'Move or extend a direct reservation, or cancel one (or mark a no-show) so the dates are free again.',
    prerequisites: [
      // functions/api/reservations/[id]/dates.ts:45 — OTA_LOCKED
      'Dates of a channel reservation (Airbnb, Booking.com, Agoda) are changed on the channel; they come back by themselves.',
      // functions/api/reservations/[id]/dates.ts:40
      'Past, cancelled and no-show reservations cannot change dates.',
    ],
    who: 'Reservations staff and operations.',
    // functions/api/reservations/[id]/dates.ts (PATCH /api/reservations/:id/dates); PATCH /api/reservations/:id for status moves
    permission: ['PATCH /api/reservations/x/dates'],
    page: '/reservations/bookings',
    sidebar: 'RESERVATIONS > Reservations',
    steps: [
      { do: 'Open RESERVATIONS > Reservations and click the reservation.', then: 'The reservation drawer opens.' },
      {
        do: 'To move it: click "Change dates", pick the "New dates" and check the "Guest total (RM)", then click "Save new dates".',
        highlight: 'Change dates',
        fields: [
          // functions/api/reservations/[id]/dates.ts:34,47 — checkout after check-in; once the guest is in only the checkout moves
          { label: 'New dates', required: true, value: 'Check-in and checkout; checkout after check-in. Once the guest is in, only the "Checkout" date can change.', example: "'2026-12-05 to 2026-12-10'" },
          // functions/api/reservations/[id]/dates.ts:51-53 — channel price cannot change here; zero or more
          { label: 'Guest total (RM)', required: true, value: 'Stays the same unless you change it; zero or more. A channel sets its own price.', example: "'1,300.00'" },
        ],
        check: 'If an invoice was issued, the window warns that saving voids it and issues a new invoice for the new dates.',
        then: 'The new dates are checked against the other reservations of the unit and saved; the guest is not messaged.',
      },
      {
        do: 'To cancel: click "Cancel reservation", type the reason and confirm.',
        highlight: 'Cancel reservation',
        // functions/_lib/bookingLifecycle.ts:173 — reason required; src/components/booking/BookingDrawer.tsx:1035
        check: 'A guest who is already in cannot be cancelled; check them out instead.',
        then: 'The reservation shows Cancelled and its dates are free again on the calendar and the channels.',
      },
    ],
    checkBefore: ['The right reservation.', 'For a cancellation: whether the guest is owed a refund (record it with record-guest-payment).'],
    result: 'Dates moved (cleaning job and channel blocks follow), or the reservation is cancelled and the dates released.',
    warnings: [
      'Cancelling releases the dates on every channel straight away.',
      // functions/_lib/bookingLifecycle.ts:96-100 — reinstate management only
      'Only management can reinstate a cancelled or no-show reservation, and only before its dates have passed.',
    ],
    undo: 'Dates: change them again. Cancellation: ask management to use "Reinstate reservation" in the drawer (holds the dates again if they are still free).',
    commonMistakes: [
      { mistake: 'Trying to change the dates of an Airbnb reservation here.', fix: 'Change it on Airbnb; the change comes back to the ERP by itself.' },
      { mistake: 'Cancelling a guest who has already arrived.', fix: 'Use "Check out" in the drawer, or shorten the stay with "Change dates".' },
    ],
    workedExample: "Jane Tan extends 2 nights: open her reservation > Change dates > New dates 5 Dec to 10 Dec > Guest total 1,300.00 > Save new dates.",
    related: ['create-reservation', 'record-guest-payment', 'block-dates-calendar'],
    contact: 'Reservations lead.',
  },
];
