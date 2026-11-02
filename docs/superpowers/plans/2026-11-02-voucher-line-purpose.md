# Payment Voucher: Each Line Says What It Is For — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A payment voucher no longer starts with "For: Rental / Renovation / Company / Mixed". Each line says what it is for: **a unit**, **a project** or **the company**. The department follows from that choice, and every line can name its own project.

**Architecture:**
- **Engine frontend:**
  - `conts/voucherPurpose.ts` is rewritten around a per-line choice.
  - `PaymentVoucherNew.tsx` and `PaymentVoucherDetail.tsx` lose the For switch, the per-line department select and the single project field. Each line gets a "For" choice with its picker and a read-only department tag.
- **Engine backend:**
  - `scm/routes/payment-vouchers.ts` takes `projectId` on each line.
  - The department of a line naming a unit or a project is worked out on the server.
  - A plain voucher's lines keep their own projects, on create and on edit.
- **Unchanged:**
  - A voucher that pays bills (AP payment): its project still comes from the bills, one per voucher.
  - Posting (`acc/rules.ts pvLines`) and the project limit (`checkVoucherLimit`) already work per line.

**Tech Stack:** Engine React (Vite, vitest + Testing Library), Hono + PostgREST, vitest.

**Spec:** chew, 2 Nov 2026:
- "每一行选部门了还需要选 unit 或 project，然后整张 voucher 只要 project";
- "b 和 c 也是" (B: Rental, renovation and company mixed in one voucher are hard to tell apart; C: the layout is cluttered);
- "我发现这样我每个 payment 都需要先选是 rental, renovation, company, mixed";
- the proposal played back and approved ("可以，开始写计划"): each line picks unit / project / company, the department is automatic, the project is per line, and old vouchers still open and edit;
- earlier the same day: a Rental voucher may name an internal project ("可以").

## Global Constraints

**Each line's "For"** is one of three, shown as a small segmented choice on the line:

| For | Picker on the line | Department saved | Tag shown |
|---|---|---|---|
| Unit | `UnitPicker` (required) | `rental` | Rental |
| Project | `ProjectPicker` (required) | customer project → `supply`; internal project → its `internal_department` (`rental` or `supply`), or `supply` when that is empty | Renovation, or Rental for an internal rental project |
| Company | none | `shared` | Company |

**New lines and old vouchers**
- A new line copies the For and the unit or project of the line above (as `nextLineUnit` does today for units); the first line starts on Company.
- An old voucher loads line by line:
  - a unit → Unit;
  - a project → Project;
  - `shared` → Company;
  - `rental` without a unit → Unit with the unit empty;
  - `supply` without a project → Project with the project empty.
- An empty unit or project is asked for only when that line is saved.

**AP payments** (paying bills) keep today's behaviour: one project for the voucher, from the bills, shown read-only on every line.

**Copy:** British English. Tags read "Rental", "Renovation", "Company". The line control is labelled "For"; pickers read "Pick the unit" / "Pick the project".

**Server rules**
- `unitId` on a line → department `rental`.
- `projectId` on a line → department from the project as in the table.
- Neither → the department sent (Company sends `shared`).
- A line naming both a unit and a project is refused (`unit_and_project`).
- A project that is not the company's is refused (`project_invalid`).

**My calls (chew can overrule)**
- **An internal project follows its own department** (`internal_department`, set when the project is made: rental for a unit to rent out, supply for the showroom). This replaces what I told chew in chat ("公司自己的项目算公司的"). The SOP (§6) puts in-house renovation costs on Supply chain, and the project already says which side it is.
- **A Project line names no unit.**

## Review Focus

1. **An old Mixed or Renovation voucher opened and saved without changes keeps every line's department, unit and project.** Edits must no longer stamp one project on all lines.
2. **A voucher made from a payment request or a petty cash top-up** (lines already carry their own project and unit) keeps them when edited.
3. **The project limit counts each line against its own project.** Two lines on two projects each check their own limit; a line over its project's limit is refused with that project's name.
4. **An AP payment still refuses bills of two projects and a named project that differs from the bills'.**
5. **Switching a line between Unit, Project and Company drops what no longer applies** (the unit or the project), shows the new tag at once, and never sends a hidden value.

---

### Task 1: Server — a project and a department per line

**Files:**
- Modify: `engine/backend/src/scm/routes/payment-vouchers.ts`:
  - `buildLines` (around line 248) accepts `projectId`;
  - create (around 732–786) and edit (around 980–1034) stop writing one `voucherProject` on every line of a plain voucher;
- Modify: `engine/backend/src/conts/project-limit.ts`: export `lineDepartmentOfProject`.
- Test: `engine/backend/tests/paymentVoucherLinePurpose.test.ts` (new), using the route test setup of the existing payment voucher tests.

**Interfaces:**
- Produces: `buildLines(raw)` rows carry `project_id?: number | null` (absent = unchanged on an edit, as `unit_id` is today).
- Produces: `lineDepartmentOfProject(p: { funding: string | null; internal_department: string | null }): 'rental' | 'supply'`.
- Produces (HTTP):
  - `POST /payment-vouchers` and `PATCH /payment-vouchers/:id` accept `lines[].projectId`;
  - a header `projectId` is used only by an AP payment (bills allocated). On a plain voucher it fills only lines that name neither a unit nor a project, so older callers still work.

- [ ] **Step 1: Failing tests:**
  - two lines on two projects → each line saved with its own `project_id`, and each project's limit checked separately;
  - a line on an internal project whose `internal_department` is `rental` → department `rental`;
  - a customer project → `supply`;
  - a unit → `rental` whatever department was sent;
  - unit and project on one line → 400 `unit_and_project`;
  - another company's project → 400 `project_invalid`;
  - editing a voucher whose lines carry different projects, without sending them → each line keeps its own (Review Focus 1–2);
  - AP payment with bills of two projects → still 409 `many_projects` (Review Focus 4).
- [ ] **Step 2:** Run `npx vitest run --config vitest.light.config.mts tests/paymentVoucherLinePurpose.test.ts`. Expect FAIL; implement; expect PASS.
  - Load the line projects in one query (`public.projects`: `id, funding, internal_department`).
  - Keep `resolveVoucherProject` for the AP payment path only.
- [ ] **Step 3:** Run the full backend suite (known failures: doStockLeavesOnConfirm, renovationRecords, renovationTimeline, settlementRoutes, soLineFreezeRoutes, specialsRecordedNeverPriced; journalClasses and journalEntryEdit only under full-suite load), then `npx tsc -b`.
- [ ] **Step 4: Commit** `feat(vouchers): each line names its own unit or project; the department follows`.

### Task 2: The per-line rules (frontend, pure)

**Files:**
- Rewrite: `engine/frontend/src/conts/voucherPurpose.ts` and `voucherPurpose.test.ts`.
- Delete: `engine/frontend/src/conts/VoucherForSwitch.tsx` (no other user; confirm with a search).

**Interfaces:**
- Produces: `type LineFor = 'unit' | 'project' | 'company'`.
- Produces: `lineForOf(l: { department: Department | ''; unitId: string | null; projectId: number | null }): LineFor`, with the old-voucher mapping of Global Constraints.
- Produces: `departmentOf(f: LineFor, project?: { funding: string | null; internalDepartment: string | null } | null): Department`.
- Produces: `switchLine<T>(l: T, f: LineFor): T`, which drops the unit or project that no longer applies.
- Produces: `nextLine(lines): { for: LineFor; unitId: string | null; projectId: number | null }`, which copies the line above, Company when there is none.
- Produces: `TAG: Record<Department, string>` = Rental / Renovation / Company.
- Removes: `VoucherFor`, `forOfLines`, `applyFor`, `whatSwitchingDrops`, `projectShown`, `departmentFor`.

- [ ] **Step 1: Failing tests:**
  - the table of Global Constraints;
  - the old-voucher mapping (five cases);
  - switching Unit→Project drops the unit, and Project→Company drops the project;
  - a new line copies the line above.
- [ ] **Step 2:** Run → FAIL; implement; → PASS.
- [ ] **Step 3: Commit** `feat(vouchers): per-line For rules`.

### Task 3: The voucher screens

**Files:**
- Modify: `engine/frontend/src/pages/scm-v2/PaymentVoucherNew.tsx`:
  - remove the For switch (around 764) and `chooseFor` (385);
  - remove the project field (767) on plain vouchers;
  - remove the department select (1002) and the rental-only unit picker (1009);
  - fix the save checks (583) and the payload (607, 626);
  - copy-from now carries each line's project.
- Modify: `engine/frontend/src/pages/scm-v2/PaymentVoucherDetail.tsx`:
  - the same in the edit form (788, 791, 891, 898, 452, 489, 504);
  - the read-only view (707, 843) shows each line's tag and its unit or project.
- Projects for the pickers: `ProjectPicker` already lists projects; add `funding` and `internalDepartment` to its rows if they are missing (`conts/pickerRows.ts`), so the tag can be shown before saving.
- Tests: `PaymentVoucherNew.test.tsx` (replace the block "departments on a plain voucher", around 565–640) and `PaymentVoucherDetail.test.tsx`.

- [ ] **Step 1: Failing tests:**
  - New: no For switch is shown;
  - a line set to Unit with a unit picked saves `{ department: 'rental', unitId }`;
  - Project saves `{ projectId, department: 'supply' }`, or `rental` for an internal rental project;
  - Company saves `{ department: 'shared' }` with no unit or project;
  - two lines on two projects save both;
  - saving a Unit line with no unit says "Pick the unit";
  - Detail: an old Mixed voucher loads each line's For as in Global Constraints and saves unchanged;
  - an AP payment still shows its one project read-only.
- [ ] **Step 2:** Run `npx vitest run src/pages/scm-v2/PaymentVoucherNew.test.tsx src/pages/scm-v2/PaymentVoucherDetail.test.tsx src/conts` → FAIL; implement; → PASS.
- [ ] **Step 3: Layout:**
  - each line reads, left to right: For (segmented) · Unit or Project picker · Account · Description · Amount · tag;
  - columns line up across lines;
  - on a phone the line wraps into two rows, with no page scroll.
- [ ] **Step 4:** Check in the Browser pane against the local engine (launch config `engine-api` + `engine-web`):
  - create a voucher with one Unit line, one Project line on two different projects, and one Company line; save; reopen;
  - open an older Mixed voucher and save it unchanged;
  - take screenshots at desktop and phone width.
- [ ] **Step 5:** Run `npx tsc -b` (engine/frontend), then the frontend suite (known failures: routeManifestDrift ×3).
- [ ] **Step 6: Commit** `feat(vouchers): each line says what it is for; no For switch`.

### Task 4: Ship

- [ ] **Step 1:** A fresh opus reviewer goes over the branch against this plan's Review Focus. Fix the findings test-first.
- [ ] **Step 2:** Open the PR on `Houzs-IT/Conts-ERP`, merge with `--merge` after its checks, and watch the deploy with `scratchpad/wait-deploy.sh <sha>`.
- [ ] **Step 3:** Update `docs/finance/FINANCE-SOP.md` §3.2:
  - the For switch is gone; each line names a unit, a project or the company;
  - an internal project follows its own department;
  - a Rental line may name an internal project (chew, 2 Nov 2026).

  Then tell chew in Chinese.
