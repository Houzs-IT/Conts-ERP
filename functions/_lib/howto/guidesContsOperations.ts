/**
 * howto/guidesContsOperations.ts: process help for The Conts' operations: cleaning jobs, maintenance jobs (with the
 * owner's approval of a quote) and blocking nights on the calendar. Written from the real screens:
 *   src/pages/CleaningPage.tsx (Board, cleaner picker, Add cleaning job)
 *   src/pages/MaintenancePage.tsx + src/components/ops/OpsUi.tsx (Add maintenance job, the job panel, Mark job done)
 *   src/pages/CalendarPage.tsx + src/components/calendar/CalendarModals.tsx (Block nights)
 * and the handlers they call (functions/api/housekeeping/*, maintenance/issues*, blocks.ts). Rules are cited in code
 * comments beside the text.
 */
import type { HowToGuide } from './types';

export const GUIDES: HowToGuide[] = [
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'assign-cleaning-job',
    title: 'Assign a cleaning job to a cleaner (and add one by hand)',
    keywords: [
      'assign cleaner', 'cleaning job', 'housekeeping', 'add cleaning job', 'deep clean', 'turnover', 'who cleans', // vocab-ok: search keywords staff type
      '安排清洁', '派清洁工', '清洁', '打扫', '加清洁单',
      'tugaskan pembersih', 'kerja pembersihan', 'cuci',
    ],
    module: 'Operations',
    companies: ['conts'],
    purpose:
      'Give each cleaning job to a cleaner so they see it in their app. Cleaning jobs are created by themselves for every checkout; add one by hand for a deep clean, a refresh or an outside address.',
    prerequisites: [
      'The cleaner is on the active roster (HR > Employees, a cleaning position).',
      'The cleaning job exists for the day (planned from the checkout), or you add it.',
    ],
    who: 'Cleaning supervisor / operations.',
    // functions/api/housekeeping/tasks/[id]/assign.ts:13 — field roles refused; middleware gates the Cleaning area at edit
    permission: ['POST /api/housekeeping/tasks/x/assign'], // vocab-ok: an API path, not a word on screen
    page: '/operations/cleaning',
    sidebar: 'OPERATIONS > Cleaning',
    steps: [
      {
        do: 'Open OPERATIONS > Cleaning. On the "Board" pick the "Day" ("Today", "Tomorrow" or "Pick date").',
        then: 'Each unit with a cleaning job that day is a card, with the guest out / next check-in times.',
      },
      {
        do: 'On the card click "Assign cleaner", tick one or more cleaners (the least busy are at the top) and click "Apply".',
        highlight: 'Assign cleaner',
        // functions/api/housekeeping/tasks/[id]/assign.ts:20 — every cleaner must be on the active roster
        check: 'The first person ticked is the main cleaner. A finished or in-progress job cannot be reassigned from the card.',
        then: 'Toast <unit>: given to <name>. The cleaner sees the job in their app.',
      },
      {
        do: 'Many jobs at once: tick the cards, then click "Assign" in the bar at the top and pick the cleaners.',
        highlight: 'Assign',
      },
      {
        do: 'To add a job by hand: click "Add cleaning job", pick the "Unit" (or "External (not one of our units)"), the "Type", the day, the "Cleaners (optional)" and "Notes for the cleaner (optional)", then save.',
        highlight: 'Add cleaning job',
        fields: [
          { label: 'Unit', required: true, value: 'The unit, or "External (not one of our units)" for an outside address (then "Address" and the charge are asked).', example: "'Vertica A-12-03'" },
          // functions/api/housekeeping/tasks/[id].ts:146 — Basic, deep or light clean
          { label: 'Type', required: true, value: '"Basic clean (BC)", "Deep clean (DC)" or "Light clean".', example: "'Deep clean (DC)'" },
          { label: 'Cleaners (optional)', required: false, value: 'Who does it; can be assigned later.', example: "'Siti Aminah'" },
          { label: 'Notes for the cleaner (optional)', required: false, value: 'What they must know.', example: "'Owner arriving at 18:00, change all linen'" },
        ],
      },
    ],
    checkBefore: ['The right day on the board.', 'The cleaner is free at that time (the picker shows how busy each cleaner is).'],
    result: 'The cleaning job shows the cleaner on the board and in the cleaner\'s app; when they finish it shows "Done" with their After photos.',
    warnings: [
      // functions/api/housekeeping/tasks/[id].ts:105 — a finished job cannot be moved
      'A finished cleaning job cannot be moved or reassigned.',
      'Deleting a job ("Delete job") removes it from the cleaner\'s app at once.',
    ],
    undo: 'Open the cleaner picker on the card again, change who is ticked and click "Apply" ("Take everyone off" removes them all).',
    commonMistakes: [
      { mistake: 'Assigning before the guest has left, so the cleaner arrives at an occupied unit.', fix: 'Watch the "Out" time on the card; mark "Guest left" first (check-in-check-out).' }, // vocab-ok: a guide id, not a word on screen
      { mistake: 'Adding a hand job for a normal checkout.', fix: 'Checkout cleaning jobs appear by themselves; delete the duplicate.' },
    ],
    workedExample: "Today, 'Vertica A-12-03' has a checkout clean: Cleaning > Board > Today > card A-12-03 > Assign cleaner > tick 'Siti Aminah' > Apply.",
    related: ['check-in-check-out', 'add-maintenance-job'],
    contact: 'Cleaning supervisor / operations manager.',
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'add-maintenance-job',
    title: "Open a maintenance job, get the owner's approval of the quote and close it",
    keywords: [
      'maintenance job', 'repair', 'report damage', 'aircon', 'quote', 'owner approval', 'technician', 'contractor', 'fix', 'broken',
      '维修', '报修', '修理', '坏了', '报价', '业主批准', '冷气',
      'baiki', 'kerosakan', 'penyelenggaraan', 'sebut harga',
    ],
    module: 'Operations',
    companies: ['conts'],
    purpose:
      'Record a problem in a unit (or the building), send the repair to a technician or contractor, ask the owner to approve the quote when they pay, and close the job with its final cost so it lands on the owner statement.',
    prerequisites: ['The unit exists.', 'For an owner-paid repair over the approval rules: a quote amount.'],
    who: 'Operations / maintenance coordinator; finance or management records an owner\'s approval and closes jobs.',
    // functions/api/maintenance/issues.ts POST — Maintenance area at edit; complete.ts:18 closing needs Full (session.manage)
    permission: ['POST /api/maintenance/issues'],
    page: '/operations/maintenance',
    sidebar: 'OPERATIONS > Maintenance',
    steps: [
      { do: 'Open OPERATIONS > Maintenance and click "Add maintenance job".', highlight: 'Add maintenance job', then: 'The "Add maintenance job" window opens.' },
      {
        do: 'Fill the form.',
        fields: [
          // functions/api/maintenance/issues.ts:147-157 — a unit or a building, not both; unit must exist
          { label: 'Unit', required: true, value: 'Type the building or unit, e.g. agile 13a. Pick the in-building option for the lobby, lift or a corridor (The Conts pays).', example: "'Agile 13A'" },
          // functions/api/maintenance/issues.ts:165
          { label: 'Problem category', required: true, value: 'Pick one category.', example: "'Aircon'" },
          // functions/api/maintenance/issues.ts:168
          { label: 'Job type', required: true, value: '"Urgent" affects the next guest and is done first; "Normal" is done in date order.', example: "'Urgent'" },
          { label: 'Severity', required: true, value: '"Minor" or "Major". Management\'s approval rules can ask the owner first for major jobs.', example: "'Major'" },
          // functions/api/maintenance/issues.ts:162 — Owner (sharing) / Company / Guest (from the deposit)
          { label: 'Who pays', required: true, value: '"Owner (sharing)", "Company" or "Guest (from the deposit)". Can be changed later on the job.', example: "'Owner (sharing)'" },
          { label: 'Due (optional)', required: false, value: 'Normal jobs are worked one by one in this order.', example: "'2026-12-03'" },
          // functions/api/maintenance/issues.ts:145 — a short title is required (max 160)
          { label: 'What is wrong', required: true, value: 'A short title, up to 160 characters.', example: "'Aircon not cooling, guest complained'" },
          { label: 'Details (optional)', required: false, value: 'Where it is, what you saw (up to 2000 characters).', example: "'Master bedroom unit, drips water'" },
          { label: 'Who fixes it (optional)', required: false, value: 'An in-house technician or a contractor; leave empty to assign later.', example: "'Ah Seng Aircon Services'" },
          { label: 'Repair window (optional)', required: false, value: 'When the technician may enter, Malaysia time. A window over a reservation warns you.', example: "'2026-12-02 10:00 to 12:00'" },
        ],
      },
      {
        do: 'Click "Add maintenance job" at the bottom.',
        highlight: 'Add maintenance job',
        then: 'The job opens in the list. Photos you added are attached under the problem.',
      },
      {
        do: 'Open the job. Under "Quote and billing" type the "Quote, RM" and click "Save". If the owner pays and should agree first, click "Send to owner for approval".',
        highlight: 'Send to owner for approval',
        // functions/api/maintenance/issues/[id]/request-approval.ts — owner told on the owner portal
        then: 'The owner sees the quote on the owner portal. The technicians do not see the job until the owner approves (and the parts arrive, when "Needs parts or stock" is ticked).',
      },
      {
        do: 'If the owner agreed by phone or chat (or has no portal login), finance or management clicks "Record owner\'s approval".',
        highlight: "Record owner's approval",
        // functions/api/maintenance/issues/[id]/approve.ts:21 — only the owner or a Full (finance / management) role decides; :24 quote changed
        check: 'The quote has not changed since the owner saw it; otherwise the system refuses and the owner must see the new amount.',
      },
      {
        do: 'When the repair is finished, click "Mark done", type the "Final cost, RM (required)" (type 0 if it cost nothing), check "Who pays" and the "Billing date", and click "Mark done".',
        highlight: 'Mark done',
        // functions/api/maintenance/issues/[id]/complete.ts:18,23,36,45
        check: 'Closing needs Full on Maintenance. An owner-paid job whose quote the owner has not approved cannot be closed as owner-paid. A month whose owner statement is final cannot take the cost.',
        then: 'The cost is recorded as a maintenance expense on the unit for the billing month (RM 0 records nothing), and a blocked unit goes back to ready.',
      },
    ],
    checkBefore: ['Right unit and "Who pays".', 'The final cost matches the technician\'s claim.', 'The billing month is not already final for owner statements.'],
    result: 'The job moves from open to done; its cost shows under the unit\'s costs and on that month\'s owner statement when the owner pays.',
    warnings: [
      'An owner-paid quote waits for the owner\'s approval before technicians can start.',
      // functions/api/maintenance/issues/[id]/complete.ts:45
      "If that month's owner statement is already final, the cost is refused (PERIOD_LOCKED): ask finance which month to bill.",
      'Deleting a job ("Delete job") cannot be undone.',
    ],
    undo: 'Before it is done: change any field on the job and save. After "Mark done": "Reopen" on the job (Full on Maintenance), unless the cost sits in a month that is final.',
    approvals: "Owner-paid repairs: the owner's approval of the quote, by the owner portal or recorded by finance / management. Management's \"Approval rules\" decide which jobs need it.",
    commonMistakes: [
      { mistake: 'Leaving "Who pays" on "Owner (sharing)" for damage caused by a guest.', fix: 'Change it to "Guest (from the deposit)" on the job before closing.' },
      { mistake: 'Closing with an empty final cost.', fix: 'Type the real cost, or 0 if nothing was spent: the job does not close without it.' },
    ],
    workedExample:
      "Aircon in 'Agile 13A' not cooling: Add maintenance job > Unit 'Agile 13A' > Aircon > Urgent > Major > Owner (sharing) > What is wrong 'Aircon not cooling' > Add maintenance job > Quote 350.00 > Save > Send to owner for approval > owner approves on the portal > technician fixes it > Mark done > Final cost 350.00 > Mark done.",
    related: ['assign-cleaning-job', 'block-dates-calendar', 'owner-statement-generate'],
    contact: 'Operations manager.',
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'block-dates-calendar',
    title: 'Block nights on the calendar (repair, owner stay or other)',
    keywords: [
      'block dates', 'block nights', 'close dates', 'not available', 'owner block', 'repair block', 'calendar',
      '封房', '关房', '锁日期', '日历',
      'sekat tarikh', 'tutup tarikh', 'kalendar',
    ],
    module: 'Reservations',
    companies: ['conts'],
    purpose: 'Stop anyone reserving a unit for some nights, on every channel at once, for a repair, an owner stay or another reason.',
    prerequisites: ['The nights are free (a block cannot sit on top of a reservation).'],
    who: 'Reservations and operations staff.',
    // functions/api/blocks.ts — the Calendar area (api 'blocks') at edit; field roles refused (:20)
    permission: ['POST /api/blocks'],
    page: '/reservations/calendar',
    sidebar: 'RESERVATIONS > Calendar',
    steps: [
      { do: 'Open RESERVATIONS > Calendar and click "Block nights".', highlight: 'Block nights', then: 'The "Block nights" window opens. (You can also drag over the nights of a unit and choose "Block".)' },
      {
        do: 'Pick the unit, the nights and the reason.',
        fields: [
          { label: 'Unit', required: true, value: 'The unit to block.', example: "'Vertica A-12-03'" },
          // src/components/calendar/CalendarModals.tsx:54; functions/api/blocks.ts:40 — end after start
          { label: 'Nights', required: true, value: 'From the first blocked night to the checkout day (the end must be after the start).', example: "'2026-12-10 to 2026-12-12'" },
          // functions/api/blocks.ts:28,30 — maintenance, owner stay or other; other needs a note
          { label: 'Reason', required: true, value: '"Repair", "Owner stay" or "Other". "Other" needs a note.', example: "'Repair'" },
          { label: 'Note (optional)', required: false, value: 'Shown on the blocked nights. Required ("Note") when the reason is Other.', example: "'Plumbing works'" },
        ],
      },
      { do: 'Click "Block nights" at the bottom of the window.', highlight: 'Block nights', then: 'The nights show as blocked on the calendar and are blocked on the channels the unit is linked to.' },
    ],
    checkBefore: ['The checkout day is the day after the last blocked night.', 'The right unit.'],
    result: 'The nights show as blocked (or as an owner stay) on the calendar; no channel can sell them.',
    warnings: ['A blocked unit earns nothing those nights: check with the owner before long blocks.'],
    undo: 'Click the blocked nights on the calendar and use "Remove block" (or "Remove owner stay") in the drawer, or "Change dates" to shorten it.',
    commonMistakes: [{ mistake: 'Choosing the last night as the end, so one night too few is blocked.', fix: 'The end is the checkout day: pick the day after the last night.' }],
    workedExample: "Plumbing in 'Vertica A-12-03' on the nights of 10 and 11 December: Calendar > Block nights > unit A-12-03 > Nights 10 Dec to 12 Dec > Repair > Note 'Plumbing works' > Block nights.",
    related: ['create-reservation', 'add-maintenance-job', 'set-nightly-prices'],
    contact: 'Reservations lead.',
  },
];
