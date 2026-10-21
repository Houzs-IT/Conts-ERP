# 财务第 1 期：公司总账开始用 engine — 开发计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让财务从上线日起在 engine 的总账里记账：一个 Finance 入口（两边侧边栏都有），开账日期保护旧单据，会计权限独立，付款凭证一个人完成，部门维度，财政年度报表，入账规则设定，期初余额导入。

**Architecture:** 总账用 engine（`engine/backend`、`engine/frontend`，schema `scm`）现有的会计功能，只补缺口；Property OS（`src/`、`functions/`）只加菜单、权限区域和旧页面转址。Conts 专用的 engine 逻辑放在 `engine/backend/src/conts/`、`engine/frontend/src/conts/`；Houzs 原本的流程不变。分 8 个 PR，做好一个合并一个，会计的东西都藏在「会计」权限后面。

**Tech Stack:** engine 后端 TypeScript + Hono（Cloudflare Worker，数据库经 Supabase REST），测试 vitest 4（`vitest.light.config.mts` 纯逻辑、`vitest.config.mts` Workers），假数据库 `fakeSb`（`engine/backend/src/scm/lib/fake-postgrest.ts`）；engine 前端 React + vitest（jsdom）；Property OS React/Vite + Cloudflare Pages Functions，没有单元测试框架，用 `scripts/api-checks/*.mjs` 和 `npm run check`。

**Spec:** `docs/superpowers/specs/2026-10-20-finance-phase1-ledger-design.md`（业务规则：`docs/finance/FINANCE-SOP.md`）

**执行方式（财务选择 2026-10-21，方式 C）：** 由同一个 AI 照这份计划逐个任务实作（superpowers:executing-plans）；**每个 PR 合并前**另外派一个新的 AI 独立检查整个 PR（superpowers:requesting-code-review），检查通过、财务同意后才合并。push、开 PR、合并、碰 Cloudflare 或正式数据库之前都先问财务。PR 3（打开 engine 会计页面）要等财务确认老板同意重新打开会计功能（设计文件 D1）。

## Global Constraints

- 金额一律整数 sen。
- 不在本地跑 engine、不用 staging（财务决定 2026-10-21）：合并前跑完全部自动检查；需要本地 engine 的脚本（`scm-engine-access.mjs` 等）不跑，靠 vitest。
- 每个 PR 开一个分支 `feat/finance-ledger-<n>-<slug>`，从最新的 `origin/main` 开；合并前先 `git pull`，有冲突先解决。
- 合并由财务决定；合并就直接上正式环境，engine 没有 CI。
- 合并前一定要跑：Property OS `npm run typecheck`、`npm run build`、`npm run check`、`node scripts/api-checks/nav-engine-map.mjs`；engine 在 `engine/` 跑 `npm run typecheck`、`npm run lint`，在 `engine/backend`、`engine/frontend` 跑 `npm test`，在 `engine/frontend` 跑 `npm run build`。
- Migration 放在根目录 `migrations-pg/`，编号 = 开工当时 `origin/main` 最大编号 + 1（2026-10-21 时是 0133 起），先跟团队说；文件开头照 `0119_document_attachments.sql`：`-- REVERSAL:` 一行、说明、`-- APPLY: by hand ...`、`set local search_path = scm, public, extensions;`、SQL 小写。需要 migration 的 PR：先套用到正式数据库，再合并代码。
- 界面文字用英文，英式拼写（ageing），句首大写，菜单 1 到 3 个字；`src/` 里不能有中文（english-only 检查）；要通过 `npm run check` 的 vocabulary 检查。
- 在正式 ERP 上不开测试的付款凭证、收款、分录，不上传测试月结单。
- 会计专用的 engine 路径都要求明确拥有 `scm.ledger.use`（`*` 不算）。

## Review Focus

1. 开账日期以前的单据（开账后再编辑、作废、补入账）不能写任何分录，也不能写冲销 → Task 2 的测试。
2. 8 个 Supply chain 区域全 Full、但没有会计权限的人（例如运营经理），engine 角色跟今天完全一样（还是 `*` 角色） → Task 4 的测试。
3. 销售同事用的正式收据（`/accounting` 底下的 official receipt 路径）没有会计权限也照常能用 → Task 4 的测试。
4. 期初未收、未付单据之后收到钱或付钱时，照常入账、账龄照常减少 → Task 15 的测试。
5. 同一个 engine 页面有 Rental、Supply chain 两个菜单网址：在哪一边打开，就留在哪一边，侧边栏不跳 → Task 6 的检查。

---

## PR 1：开账日期（engine）

### Task 1: 会计设定（开账日期、财政年度结束月份）

**Files:**
- Create: `migrations-pg/NNNN_acc_ledger_settings.sql`
- Create: `engine/backend/src/acc/ledger-settings.ts`
- Modify: `engine/backend/src/scm/routes/accounting.ts`（在 `/roles` 路由旁，约 :293-335）
- Test: `engine/backend/src/acc/ledger-settings.test.ts`

**Interfaces:**
- Produces:
  - `interface LedgerSettings { ledgerStartDate: string | null; fiscalYearEndMonth: number }`
  - `const LEDGER_DEFAULTS: LedgerSettings = { ledgerStartDate: null, fiscalYearEndMonth: 8 }`
  - `loadLedgerSettings(sb: any, companyId: number | null): Promise<{ ok: true; settings: LedgerSettings } | { ok: false }>`（companyId 为 null 时照 `masters-company.ts` 读 company 1；没有资料行回传默认值；读取失败回传 `{ ok: false }`）
  - `saveLedgerSettings(sb: any, companyId: number, patch: Partial<LedgerSettings>, actor: string): Promise<{ ok: true } | { ok: false; error: string }>`（只 upsert 自己的两栏和 `updated_at`、`updated_by`，`onConflict: 'company_id'`）
  - `isBeforeLedgerStart(date: string, s: LedgerSettings): boolean`
  - 路由 `GET /api/scm/accounting/settings/ledger` → `LedgerSettings`；`PUT` 同路径，body `{ ledgerStartDate?: string | null; fiscalYearEndMonth?: number }`，权限同 BANK_DEFAULT（`requireGlPost` + `requireActiveCompanyId`）

- [ ] **Step 1: 写 migration**：`alter table scm.acc_company_settings add column if not exists ledger_start_date date, add column if not exists fiscal_year_end_month smallint not null default 8 check (fiscal_year_end_month between 1 and 12);`（说明写：Conts FYE 8 月，财务 2026-10-21；表的权限 0044/0047 已有，不用另外 grant）
- [ ] **Step 2: 写失败的测试** `ledger-settings.test.ts`（light，用 `fakeSb`）：
  - `returns defaults when the company has no settings row` → `{ ledgerStartDate: null, fiscalYearEndMonth: 8 }`
  - `fails closed when the read fails` → `missing: { acc_company_settings: ['ledger_start_date'] }` 时 `ok === false`
  - `saving keeps the deposit-invoice and performance columns` → 先放 `deposit_invoice_enabled: true` 的行，存开账日期后该栏还是 `true`
  - `isBeforeLedgerStart('2026-11-30', { ledgerStartDate: '2026-12-01', … }) === true`；`'2026-12-01'` 为 `false`；`ledgerStartDate: null` 永远 `false`
- [ ] **Step 3: 跑测试确认失败**：`cd engine/backend && npx vitest run --config vitest.light.config.mts src/acc/ledger-settings.test.ts`，预期 FAIL（模块不存在）
- [ ] **Step 4: 实作** `ledger-settings.ts`，照 `acc/deposit-invoices.ts:75-110` 的 load/save 写法；路由加进 `accounting.ts`；PUT 验证日期格式 `YYYY-MM-DD`、月份 1 到 12，错误回 400 `{ error: 'Enter a date like 2026-12-01.' }` 或 `{ error: 'Choose a month from 1 to 12.' }`
- [ ] **Step 5: 跑测试确认通过**（同 Step 3 指令），再跑 `cd engine && npm run typecheck`
- [ ] **Step 6: Commit**：`git add migrations-pg/NNNN_acc_ledger_settings.sql engine/backend/src/acc/ledger-settings.ts engine/backend/src/acc/ledger-settings.test.ts engine/backend/src/scm/routes/accounting.ts && git commit -m "feat(ledger): ledger start date and fiscal year end settings"`

### Task 2: 开账日期以前的单据不入账、不冲销

**Files:**
- Modify: `engine/backend/src/acc/engine.ts`（`PostJournalErr` :59-75、`postJournal` :172 起、`ReverseJournalInput` :305-320、`reverseJournal` :330 起）
- Modify: `engine/backend/src/scm/lib/post-si-revenue.ts`（`postSiRevenue`、`reverseSiRevenue` :156）
- Modify: `engine/backend/src/acc/payments.ts`、`engine/backend/src/acc/deposit-invoices.ts`（best-effort 的跳过清单）
- Modify: `engine/backend/src/scm/routes/payment-vouchers.ts`（:1069-1083）、`engine/backend/src/scm/routes/accounting.ts`（手动分录 :477-498）
- Test: `engine/backend/src/acc/engine.test.ts`、`engine/backend/src/scm/lib/post-si-revenue.test.ts`（没有就新建）

**Interfaces:**
- Consumes: `loadLedgerSettings`、`isBeforeLedgerStart`（Task 1）
- Produces: `PostJournalErr.status` 多两个值 `'before_ledger_start'`、`'ledger_settings_failed'`；`ReverseJournalInput` 多 `sourceDate?: string`；`reverseJournal` 在找不到原分录、而且 `sourceDate` 早于开账日期时回传 `{ ok: true, status: 'before_ledger_start' }`，不写任何东西

- [ ] **Step 1: 写失败的测试**（加进 `engine.test.ts`，用现有的 `world()`，另外放 `acc_company_settings: [{ company_id: 1, ledger_start_date: '2026-12-01', fiscal_year_end_month: 8 }]`）：
  - `refuses a journal dated before the ledger start` → `entryDate: '2026-11-30', sourceType: 'SI'` 回 `status: 'before_ledger_start'`，`sb.tables.journal_entries` 没有新行
  - `posts an OPENING journal dated before the ledger start` → `sourceType: 'OPENING', entryDate: '2026-11-30'` 回 `posted`
  - `posts on the ledger start date` → `entryDate: '2026-12-01'` 回 `posted`
  - `fails closed when the settings read fails` → 回 `ledger_settings_failed`，没有新行
  - `writes no reversal for a pre-start document that was never posted` → `reverseJournal({ sourceType: 'SI', sourceDocNo: 'X', sourceDate: '2026-11-15', fallbackLines: [...] })` 回 `before_ledger_start`，没有新行
  - `post-si-revenue.test.ts`：`skips a pre-start invoice without logging` → 回 `ok: true`（跳过），`console.error` 没被呼叫
- [ ] **Step 2: 跑测试确认失败**：`cd engine/backend && npx vitest run --config vitest.light.config.mts src/acc/engine.test.ts src/scm/lib/post-si-revenue.test.ts`
- [ ] **Step 3: 实作**：在 `postJournal` 定好日期之后、检查科目之前读设定；`sourceType === 'OPENING'` 豁免。`reverseSiRevenue` 呼叫 `reverseJournal` 时带 `sourceDate: invoice_date`。用 `grep -rn "postJournal(" engine/backend/src` 列出全部呼叫的地方，逐一处理：best-effort 的（销售发票收入、客户付款、订金发票等）把 `before_ledger_start` 当成跳过、不记 log；会把错误回给使用者的（付款凭证、手动分录、`POST /post/si`）回 409 `{ error: 'This date is before the books start on <date>.' }`
- [ ] **Step 4: 跑测试确认通过**，再跑 `cd engine/backend && npm test`
- [ ] **Step 5: Commit**：`git commit -am "feat(ledger): no posting or reversal before the ledger start date"`（把新测试档 `git add` 进去）

---

## PR 2：会计权限（先 Property OS，再 engine）

### Task 3: Property OS 新增「会计」区域

**Files:**
- Modify: `functions/_lib/access.ts`（`AREAS` :27-52）
- Modify: `functions/_lib/scmEngine.ts`（`ENGINE_AREAS` :6）
- Modify: `src/lib/navigation.ts`（`DENY` :177-184）

**Interfaces:**
- Produces: 区域 key `'ledger'`；sign-on 的 `access` 多一个 `ledger` 等级

- [ ] **Step 1: 加区域**：`{ key: 'ledger', label: 'Ledger', group: 'Finance', api: [], managed: true, strictRead: true, defaults: { operations_manager: 'none', operations_staff: 'none' } }`（`api: []` 表示只给 engine 用，不影响 Property OS 的路由权限）
- [ ] **Step 2: `ENGINE_AREAS` 加 `'ledger'`；`DENY` 里没有 finance 的角色也拒绝 `'ledger'`**
- [ ] **Step 3: 跑检查**：`npm run typecheck && npm run build && npm run check`，预期全部通过；`require-permission.mjs` 不会因为 `api: []` 报错
- [ ] **Step 4: Commit**：`git commit -am "feat(access): Ledger area, sent to the engine at sign-on"`

### Task 4: engine 的会计权限 `scm.ledger.use`

**Files:**
- Modify: `engine/backend/src/services/permissions.ts`（`PERMISSIONS` :28-327）
- Create: `engine/backend/src/conts/ledger-access.ts`
- Modify: `engine/backend/src/conts/access.ts`（`ContsAccess`、`parseContsAccess` :33-42、`contsPermissions` :62-76、`contsPageAccess` :48-59）
- Modify: `engine/backend/src/conts/sso.ts`（`roleIdFor` :40-62）
- Modify: `engine/backend/src/scm/index.ts`（:609-662 的挂载）
- Create: `engine/frontend/src/conts/ledger.ts`、`engine/frontend/src/conts/ContsLedgerGate.tsx`
- Modify: `engine/frontend/src/App.tsx`（:725-774 的会计路由）
- Test: `engine/backend/tests/contsLedgerAccess.test.ts`、`engine/frontend/src/conts/ledger.test.ts`

**Interfaces:**
- Produces（backend `conts/ledger-access.ts`）：
  - `const LEDGER_KEY = 'scm.ledger.use'`
  - `ledgerPermissions(level: Level): string[]`：`none` → `[]`；`view` → `[LEDGER_KEY]`；`edit` → 再加 `scm.payment_voucher.create`、`scm.payment_voucher.write`；`full` → 再加 `scm.payment_voucher.check`、`.approve`、`.post`、`.cancel`
  - `requireLedgerAccess(opts?: { except?: readonly string[] }): MiddlewareHandler`：使用者没有「明确拥有」`LEDGER_KEY`（用 `holdsHouzsPermLiterally` 的规则，`*` 不算）就回 403 `{ error: 'Your role cannot open the accounts.' }`；路径在 `except` 里就放行
  - `OFFICIAL_RECEIPT_PATHS: readonly string[]`：照 `scm/routes/accounting-receipts*.ts` 和 `officialReceiptAttachments` 定义的路径列出
- Produces（frontend `conts/ledger.ts`）：`canUseLedger(permissions: readonly string[] | undefined): boolean`（只认明确拥有，`'*'` 不算）；`ContsLedgerGate`：没有就转去 `CONTS_HOME`

- [ ] **Step 1: 写失败的测试** `contsLedgerAccess.test.ts`（照 `pvDraftNumbering.test.ts` 的写法）：
  - `parseContsAccess treats a missing ledger as none`（只给 8 个区域也能登入）
  - `ledgerPermissions grants the payment voucher keys by level`（三个等级各断言一次）
  - `a role Full in the eight supply areas without ledger keeps the * role`（`roleIdFor` 回传的角色权限等于原本 `*` 角色的权限，一字不差）
  - `a role Full everywhere with ledger Full gets the * role permissions plus the ledger keys`（原本 `*` 角色上的明确核准权限，例如 `projects.approve`，也要保留）
  - `requireLedgerAccess refuses * without the ledger key` → 403；`lets the ledger key through` → next
  - `official receipt paths stay open without the ledger key`
  - frontend `ledger.test.ts`：`canUseLedger(['*']) === false`、`canUseLedger(['*', 'scm.ledger.use']) === true`、`canUseLedger(undefined) === false`
- [ ] **Step 2: 跑测试确认失败**：`cd engine/backend && npx vitest run tests/contsLedgerAccess.test.ts`；`cd engine/frontend && npx vitest run src/conts/ledger.test.ts`
- [ ] **Step 3: 实作**：`PERMISSIONS` 加 `{ key: 'scm.ledger.use', resource: 'scm.ledger', verb: 'use', label: 'Use the ledger', description: 'Accounts, payment vouchers, receipts and bank reconciliation. Never implied by *.' }`（`permissionCatalogueDrift.test.ts` 要跟着过）。`roleIdFor`：8 区全 Full 时，没有会计 → 原本的 `*` 角色不变；有会计 → 角色「Conts: full + ledger」，权限 = 原本 `*` 角色的权限 + `ledgerPermissions(level)`，每次登入重写。其他角色：`contsPermissions` 加上 `ledgerPermissions`；`contsPageAccess` 的 `scm.finance.accounting` 取原本的值和会计等级较高的那个。`scm/index.ts`：`/payment-vouchers/*`、`/receipts/*` 挂 `requireLedgerAccess()`；`/accounting/*` 挂 `requireLedgerAccess({ except: OFFICIAL_RECEIPT_PATHS })`，都放在原本的 `scmAreaGuard` 后面。前端 `App.tsx` 用 `ContsLedgerGate` 包住 `/scm/accounting`、`/scm/chart-of-accounts`、`/scm/payment-vouchers*`、`/scm/receipts`、`/scm/bank-recon`、`/scm/daily-bank`（正式收据的路由不包）
- [ ] **Step 4: 跑测试确认通过**，再跑全部 engine 检查（Global Constraints）
- [ ] **Step 5: Commit**：`git commit -am "feat(engine): ledger access needs scm.ledger.use, never implied by *"`（新档案 `git add`）
- [ ] **Step 6: 上线顺序**：Task 3 的 PR 先合并上线，再合并这个；合并后马上用运营经理、财务两个角色各开一次 Supply chain 的销售订单、采购单，确认正常；有问题马上 revert 这个 PR

---

## PR 3：菜单和页面

### Task 5: 两边侧边栏的 Finance 组、打开 engine 会计页面、关掉旧版页面

**Files:**
- Modify: `engine/frontend/src/conts/navOnly.ts`（`CONTS_HIDDEN_PATHS` :16-22）、`engine/frontend/src/conts/navOnly.test.ts`
- Modify: `src/lib/scmEngine.ts`（`ENGINE_PATH` :4-49）
- Modify: `src/lib/navigation.ts`（FINANCE 组 :77-83、`ENGINE_ONLY_AREAS` :194、`SUPPLY_OFF_MENU` :256-275）
- Modify: `src/App.tsx`（:257、:294，以及 IT Support 那种双网址路由 :331-332 的写法）
- Modify: `scripts/api-checks/nav-engine-map.mjs`

**Interfaces:**
- Produces（`src/lib/scmEngine.ts`）：
  - `interface LedgerScreen { slug: string; label: string; enginePath: string }`
  - `LEDGER_SCREENS: readonly LedgerScreen[]`，内容固定如下：

| slug | label | enginePath |
|---|---|---|
| payment-vouchers | Payment vouchers | /scm/payment-vouchers |
| money-received | Money received | /scm/receipts |
| bank-reconciliation | Bank reconciliation | /scm/bank-recon |
| journal-entries | Journal entries | /scm/accounting?tab=je |
| general-ledger | General ledger | /scm/accounting?tab=gl |
| trial-balance | Trial balance | /scm/accounting?tab=tb |
| profit-and-loss | Profit and loss | /scm/accounting?tab=pnl |
| balance-sheet | Balance sheet | /scm/accounting?tab=bs |
| debtor-ageing | Debtor ageing | /scm/accounting?tab=ar |
| creditor-ageing | Creditor ageing | /scm/accounting?tab=ap |
| chart-of-accounts | Chart of accounts | /scm/chart-of-accounts |
| item-group-accounts | Item group accounts | /scm/accounting?tab=groups |
| ledger-setup | Ledger setup | /scm/ledger-setup |

  - `ENGINE_PATH` 由 `LEDGER_SCREENS` 产生两组：`/finance/<slug>` 和 `/supply/finance/<slug>`
- Produces（`src/lib/navigation.ts`）：`financeItems(prefix: '/finance' | '/supply/finance', keySuffix: '' | 'Supply'): NavItem[]` = 现有的 Accounts payable、Utility bills、Approvals（area `finance`）+ `LEDGER_SCREENS` 的项目（area `ledger`）；Rental 的 FINANCE 组和新的 Supply chain FINANCE 组（`workspace: 'supply'`、`phone: false`）都用它

- [ ] **Step 1: engine 打开会计页面**：`CONTS_HIDDEN_PATHS` 拿掉 `"/scm/accounting"`、`"/scm/chart-of-accounts"`；`navOnly.test.ts` 的隐藏样本改用 `"/scm/forecast"`、`"/scm/forecast?x=1"`，并断言 `isContsHiddenPath("/scm/accounting?tab=gl") === false`
- [ ] **Step 2: Property OS 菜单**：照上面的 Interfaces 加 `LEDGER_SCREENS`、`financeItems`、Supply chain 的 FINANCE 组；`ENGINE_ONLY_AREAS` 加 `'ledger'`；`SUPPLY_OFF_MENU` 拿掉 `/procurement/payment-vouchers`、`/accounting`
- [ ] **Step 3: 路由**：`/supply/finance/payables`、`/supply/finance/utility-bills`、`/supply/finance/approvals` 用跟 Rental 一样的页面元件；`/procurement/payment-vouchers` 改成 `<Moved to="/finance/payment-vouchers" />`，`/accounting` 改成 `<Moved to="/finance/creditor-ageing" />`
- [ ] **Step 4: 更新 `nav-engine-map.mjs`**：允许不走 engine 的 Supply chain 网址清单改成 `/supply/it-support`、`/supply/finance/payables`、`/supply/finance/utility-bills`、`/supply/finance/approvals`；新增检查「每个 `LEDGER_SCREENS` 在两边都有菜单项目、area 是 `ledger`、都有 `ENGINE_PATH`」；修正第 37-38 行过时的 Project monitor 检查（见 Task 6）
- [ ] **Step 5: 跑检查**：`npm run typecheck && npm run build && npm run check && node scripts/api-checks/nav-engine-map.mjs`；`cd engine/frontend && npx vitest run src/conts/navOnly.test.ts`
- [ ] **Step 6: Commit**：`git commit -am "feat(nav): Finance in both sidebars with the engine ledger screens"`

### Task 6: 同一个 engine 页面有两个菜单网址时，留在目前这一边

**Files:**
- Modify: `src/lib/scmEngine.ts`（`menuPathFor` :51-62；`ENGINE_PATH` 的 `/projects/monitor`）
- Modify: `src/components/SupplyChainEngine.tsx`（:65-67）
- Modify: `src/App.tsx`（加 `/projects/monitor` 的转址）
- Modify: `scripts/api-checks/nav-engine-map.mjs`

**Interfaces:**
- Produces: `menuPathFor(enginePath: string, current?: string | null): string | null`：长度一样（同一个 engine 页面）时，`current` 在候选里就回传 `current`

- [ ] **Step 1: 在 `nav-engine-map.mjs` 写失败的检查**：
  - `menuPathFor('/scm/payment-vouchers/abc', '/supply/finance/payment-vouchers') === '/supply/finance/payment-vouchers'`
  - `menuPathFor('/scm/payment-vouchers/abc', '/finance/payment-vouchers') === '/finance/payment-vouchers'`
  - `menuPathFor('/scm/accounting?tab=tb', '/supply/finance/trial-balance') === '/supply/finance/trial-balance'`
  - `/projects/monitor` 不在 `ENGINE_PATH`
- [ ] **Step 2: 跑检查确认失败**：`node scripts/api-checks/nav-engine-map.mjs`
- [ ] **Step 3: 实作**：同长度而且 `best === current` 时跳过（保留 current）；`SupplyChainEngine.tsx` 传 `here.current`；`ENGINE_PATH` 拿掉 `/projects/monitor`，`App.tsx` 加 `<Route path="/projects/monitor" element={<Moved to="/projects/calendar" />} />`
- [ ] **Step 4: 跑检查确认通过**，再跑 `npm run typecheck && npm run build`
- [ ] **Step 5: Commit**：`git commit -am "fix(nav): an engine screen opened from either sidebar stays in that sidebar"`

---

## PR 4：付款凭证一个人完成、银行明细分页

### Task 7: 「Post now」直接入账

**Files:**
- Create: `engine/backend/src/conts/pv-post-now.ts`
- Modify: `engine/backend/src/scm/routes/payment-vouchers.ts`（只加一行路由和 import）
- Modify: `engine/frontend/src/pages/scm-v2/PaymentVoucherDetail.tsx`（按钮区 :525-622）、`engine/frontend/src/vendor/scm/lib/payment-voucher-queries.ts`（:182-198 旁）
- Test: `engine/backend/tests/pvPostNow.test.ts`

**Interfaces:**
- Consumes: 已经 export 的 `submitPaymentVoucherHandler`、`checkPaymentVoucherHandler`、`approvePaymentVoucherHandler`（`payment-vouchers.ts`）；`canUseLedger`（Task 4）
- Produces: `postNowHandler(c: Context): Promise<Response>`；路由 `POST /api/scm/payment-vouchers/:id/post-now`

- [ ] **Step 1: 写失败的测试**（bare Hono + `fakeSb`，照 `pvDraftNumbering.test.ts`）：
  - `posts a draft voucher in one request` → 回 200，`submitted_at`、`checked_at`、`approved_at` 都有值，`pv_number` 是正式号码，状态 POSTED，有一张分录
  - `skips steps already done` → 已经 `checked_at` 的不再核对，号码不变
  - `stops when the bank has no letter` → 回 409 `bank_letter_missing`，没有分录，状态还是 DRAFT
  - `refuses a user without write, check and approve` → 403
- [ ] **Step 2: 跑测试确认失败**：`cd engine/backend && npx vitest run tests/pvPostNow.test.ts`
- [ ] **Step 3: 实作**：依序呼叫 submit（已 `submitted_at` 就跳过）、check（已 `checked_at` 就跳过）、approve（会自己入账）；遇到第一个不是 2xx 的回应就直接回传；先检查 `.write`、`.check`、`.approve` 三个权限。在 `payment-vouchers.ts` 加 `paymentVouchers.post('/:id/post-now', postNowHandler);`。前端：草稿、而且有 write/check/approve 和 `canUseLedger` 时显示「Post now」按钮，先出确认框「Prepare, check, approve and post this voucher now?」
- [ ] **Step 4: 跑测试确认通过**，再跑全部 engine 检查
- [ ] **Step 5: Commit**：`git commit -am "feat(engine): post a payment voucher in one step for ledger users"`

### Task 8: 银行对账读明细超过 1,000 笔会被截掉

**Files:**
- Modify: `engine/backend/src/acc/bank.ts`（`loadAccountLedger` :230-238）
- Test: `engine/backend/src/acc/bank.test.ts`（没有就新建）

- [ ] **Step 1: 写失败的测试** `loads every ledger line past 1,000`：`fakeSb` 放 2,500 行 `v_gl_entries`（用 `maxRows` 参数设 1,000），断言回传 2,500 行、照 `line_id` 排序
- [ ] **Step 2: 跑测试确认失败**：`cd engine/backend && npx vitest run --config vitest.light.config.mts src/acc/bank.test.ts`
- [ ] **Step 3: 实作**：改用 `paginateAll((f, t) => … .order('line_id').range(f, t))`（`scm/lib/paginate-all.ts`）
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: Commit**：`git commit -am "fix(engine): bank reconciliation reads the whole account ledger"`

---

## PR 5：部门维度

### Task 9: 分录、付款凭证、收款的每一行有部门

**Files:**
- Create: `migrations-pg/NNNN_gl_department.sql`
- Modify: `engine/backend/src/acc/rules.ts`（`RuleLine` :169-177、付款凭证的分录行 :357-390、收款的分录行）
- Modify: `engine/backend/src/acc/engine.ts`（写入分录行 :233-285）
- Modify: 付款凭证和收款建立、编辑时存行的地方（`payment-vouchers.ts`、`receipts.ts`）
- Test: `engine/backend/src/acc/engine.test.ts`

**Interfaces:**
- Produces: `type Department = 'rental' | 'supply' | 'shared'`（`rules.ts`）；`RuleLine.department?: Department`；分录行没给部门时写 `'supply'`

- [ ] **Step 1: 写 migration**：`scm.journal_entry_lines`、`scm.payment_voucher_lines`、`scm.acc_receipt_lines` 各加 `department text check (department in ('rental','supply','shared'))`；用 `create or replace view` 重建 `scm.v_gl_entries`，在最后加上 `department` 栏（照目前的 view 定义复制，只加一栏）
- [ ] **Step 2: 写失败的测试**：`keeps each line's department`；`defaults to supply when a line has none`；`refuses an unknown department` → `bad_line`
- [ ] **Step 3: 跑测试确认失败**：`cd engine/backend && npx vitest run --config vitest.light.config.mts src/acc/engine.test.ts`
- [ ] **Step 4: 实作**：`engine.ts` 写入 `department`；付款凭证、收款的行把部门带进分录行
- [ ] **Step 5: 跑测试确认通过**，再跑 `cd engine/backend && npm test`
- [ ] **Step 6: Commit**：`git commit -am "feat(ledger): department on every journal line"`（新档案 `git add`）

### Task 10: 填部门、按部门看报表

**Files:**
- Modify: `engine/frontend/src/pages/scm-v2/JournalEntryCards.tsx`（:122-240）、付款凭证行的编辑元件（`PaymentVoucherNew.tsx`、`PaymentVoucherDetail.tsx`）、收款页（`engine/frontend/src/App.tsx:764` 的 `/scm/receipts` 用的元件）的行编辑
- Modify: `engine/backend/src/scm/routes/accounting-reports.ts`（`loadSums` :88-104、P&L 路由 :327-340）、`engine/backend/src/scm/routes/accounting.ts`（`/balances` :920-930、`/gl` :889-914）
- Modify: 试算表、损益表、总账明细的分页（加部门筛选）
- Test: `engine/backend/src/scm/routes/accounting-reports.test.ts`（没有就新建）

**Interfaces:**
- Consumes: `Department`（Task 9）
- Produces: `loadSums(sb, companyId, from, to, department?: Department | null)`；报表路由接受 `?department=rental|supply|shared`

- [ ] **Step 1: 写失败的测试** `the profit and loss counts only the chosen department`：`v_gl_entries` 放 rental、supply 各一笔收入，`department=rental` 只算 rental 那笔
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实作**：每一行加选单「Rental / Supply chain / Shared」，手动分录必填，预设带出上一行的选择；报表加筛选
- [ ] **Step 4: 跑测试确认通过**，再跑全部 engine 检查
- [ ] **Step 5: Commit**：`git commit -am "feat(ledger): choose a department on each line and filter reports by it"`

---

## PR 6：财政年度和报表

### Task 11: 试算表可以选日期

**Files:**
- Modify: `engine/backend/src/scm/routes/accounting.ts`（`/balances`）、`engine/backend/src/scm/routes/accounting-reports.ts`
- Modify: 前端试算表分页（`engine/frontend/src/vendor/scm/lib/accounting-queries.ts:236` 和试算表元件）
- Test: `engine/backend/src/scm/routes/accounting-reports.test.ts`

**Interfaces:**
- Produces: `trialBalanceForRange(sb: any, companyId: number, from: string | null, to: string)`，回传的每一行跟现在 `/balances`（`v_account_balances`）的行格式一样，前端不用改读法（用 `loadSums` + `loadAccounts`，没有交易的科目也列出）；`/balances?from=&to=` 有给日期时用它，没给就照旧用 view

- [ ] **Step 1: 写失败的测试** `the trial balance stops at the chosen date`：两笔分录，一笔 11-30、一笔 12-02，`to=2026-12-01` 只算第一笔；借贷总数相等
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实作**；前端加「From / To」日期，预设本财政年度开始到今天
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: Commit**：`git commit -am "feat(ledger): trial balance for a date range"`

### Task 12: 财政年度：资产负债表分开保留盈余、损益表预设本年度、会计设定页

**Files:**
- Modify: `engine/backend/src/acc/ledger-settings.ts`
- Modify: `engine/backend/src/scm/routes/accounting-reports.ts`（`ReportSources` :160-169、`dbSources` :172、`buildBalanceSheet` :355-412）、`engine/backend/src/scm/routes/accounting-dashboard.ts`（:263-274）
- Create: `engine/frontend/src/conts/LedgerSetup.tsx`
- Modify: `engine/frontend/src/App.tsx`（路由 `/scm/ledger-setup`，用 `ContsLedgerGate` 和 `scm.finance.accounting` 的 `ScmGuard` 包住）、资产负债表和损益表的前端
- Test: `engine/backend/src/acc/ledger-settings.test.ts`、`engine/backend/src/scm/routes/accounting-reports.test.ts`

**Interfaces:**
- Produces: `fiscalYearStart(asOf: string, fyEndMonth: number): string`；`ReportSources.ledger(): Promise<LedgerSettings>`；资产负债表 `totals` 多 `retainedEarningsSen`、`currentYearEarningsSen`（两个加起来等于原本的 earnings）

- [ ] **Step 1: 写失败的测试**：
  - `fiscalYearStart('2026-12-15', 8) === '2026-09-01'`；`('2026-08-31', 8) === '2025-09-01'`；`('2026-09-01', 8) === '2026-09-01'`；`('2026-03-10', 12) === '2026-01-01'`
  - `the balance sheet splits earnings at the fiscal year start`：8 月一笔收入 RM 100、9 月一笔 RM 50，asOf 2026-12-31、FYE 8 → retained 10000 sen、current year 5000 sen，自我检查 `checkSen === 0`
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实作**：保留盈余 = 本年度开始前一天为止的 earnings（含期初存货）；本年度 = 本年度开始到 asOf；`dbSources` 和 dashboard 的 sources 都加 `ledger`。前端：损益表预设本财政年度；资产负债表显示两行「Retained earnings」「Profit this year」。`LedgerSetup.tsx` 第一个区块「Books」：开账日期、财政年度结束月份（用 Task 1 的路由）
- [ ] **Step 4: 跑测试确认通过**，再跑全部 engine 检查
- [ ] **Step 5: Commit**：`git commit -am "feat(ledger): fiscal year end, retained earnings and the ledger setup page"`

---

## PR 7：入账规则设定

### Task 13: 每一条入账规则都可以选科目，加一个「准备好了没」的检查

**Files:**
- Modify: `engine/backend/src/scm/routes/accounting.ts`（`/roles` :293-335）
- Create: `engine/backend/src/conts/ledger-setup-status.ts`
- Test: `engine/backend/tests/ledgerSetupStatus.test.ts`

**Interfaces:**
- Produces:
  - `PUT /api/scm/accounting/roles/:role`：`:role` 可以是任何 `AccountRole`（不只 BANK_DEFAULT）；科目要存在、启用、不是上层科目；`CASH`、`BANK_DEFAULT`、`TRANSIT_EDC`、`TRANSIT_ONLINE` 要是银行或现金科目（`acc_money`）
  - `ledgerSetupStatus(sb: any, companyId: number): Promise<LedgerSetupStatus>`，`interface LedgerSetupStatus { ready: boolean; roles: { role: string; accountCode: string; problem: null | 'missing_account' | 'inactive' | 'not_money' }[]; itemGroups: { group: string; missing: ('sales_account' | 'sales_return_account' | 'purchase_account' | 'purchase_return_account')[] }[]; banksWithoutLetter: string[]; ledgerStartDate: string | null }`
  - `GET /api/scm/accounting/setup-status` → `LedgerSetupStatus`

- [ ] **Step 1: 写失败的测试**：
  - `a role pointing at a code that is not in the chart is a problem` → `missing_account`，`ready === false`
  - `the bank role must be a money account` → `not_money`
  - `ready when every role, item group binding, bank letter and the ledger start are set` → `ready === true`
  - `PUT /roles/AR saves any role`；`PUT /roles/CASH refuses a non-money account` → 400
- [ ] **Step 2: 跑测试确认失败**：`cd engine/backend && npx vitest run tests/ledgerSetupStatus.test.ts`
- [ ] **Step 3: 实作**：把 BANK_DEFAULT 的处理改成通用；规则清单来自 `rules.ts` 的 `AccountRole` 和 `DEFAULT_ROLE_CODES`
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: Commit**：`git commit -am "feat(ledger): set every posting rule and check the ledger is ready"`

### Task 14: 会计设定页的「Posting rules」区块、RENOVATION 可以选负债科目

**Files:**
- Modify: `engine/frontend/src/conts/LedgerSetup.tsx`
- Modify: `engine/frontend/src/pages/scm-v2/ItemGroups.tsx`
- Test: `engine/frontend/src/pages/scm-v2/ItemGroups.test.tsx`（没有就新建）

**Interfaces:**
- Consumes: Task 13 的路由
- Produces: `accountsForBinding(group: string, column: 'sales_account' | 'sales_return_account' | 'purchase_account' | 'purchase_return_account', accounts: Account[]): Account[]`（`ItemGroups.tsx`）：一般照旧；`group === 'RENOVATION'` 而且是销售或销售退回时，收入科目 + 负债科目都列出

- [ ] **Step 1: 写失败的测试**：`RENOVATION sales can pick a liability account`；`other groups still list income accounts only`
- [ ] **Step 2: 跑测试确认失败**：`cd engine/frontend && npx vitest run src/pages/scm-v2/ItemGroups.test.tsx`
- [ ] **Step 3: 实作**：`LedgerSetup.tsx` 加区块「Posting rules」：每条规则一行，选科目，有问题的整行标红，上面显示「Ready」或「Not ready」和原因（来自 setup-status）；没有字母的银行列出来，连到 `/scm/settlement-setup` 的 Voucher numbering
- [ ] **Step 4: 跑测试确认通过**，再跑全部 engine 检查
- [ ] **Step 5: Commit**：`git commit -am "feat(ledger): posting rules on the ledger setup page; renovation billing can point at a liability"`

---

## PR 8：期初余额

### Task 15: 期初单据的标记，不入账但照常收付

**Files:**
- Create: `migrations-pg/NNNN_opening_balance_documents.sql`
- Modify: `engine/backend/src/scm/lib/post-si-revenue.ts`（:56-58）、`engine/backend/src/scm/routes/accounting.ts`（:658-660 发票入账检查、:1175 和 :1196 自我检查、:1280-1288 控制科目的来源清单）、采购发票入账的检查（同样读 `migrated_no_stock` 的地方）
- Modify: `engine/backend/src/acc/rules.ts`（`REVERSAL_SOURCE` :117）
- Test: `engine/backend/tests/openingDocuments.test.ts`

**Interfaces:**
- Produces: `scm.sales_invoices.opening_balance`、`scm.purchase_invoices.opening_balance`（boolean，预设 false）；`REVERSAL_SOURCE.OPENING === 'OPENING_REVERSAL'`

- [ ] **Step 1: 写 migration**：两张表加 `opening_balance boolean not null default false`；各加 unique index `(company_id, linked_ac_docno) where opening_balance`
- [ ] **Step 2: 写失败的测试**：
  - `an opening sales invoice posts no revenue`
  - `a payment on an opening sales invoice posts Dr bank Cr AR and lowers the debtor ageing`
  - `a payment voucher settling an opening purchase invoice posts and lowers the creditor ageing`
  - `the self-check does not flag OPENING lines on the control accounts`
- [ ] **Step 3: 跑测试确认失败**：`cd engine/backend && npx vitest run tests/openingDocuments.test.ts`
- [ ] **Step 4: 实作**：入账检查和自我检查改成 `migrated_no_stock || opening_balance`；付款、贷项、退款的跳过条件**不改**（照旧只看 `migrated_no_stock`），所以之后收付期初单据会照常入账
- [ ] **Step 5: 跑测试确认通过**，再跑 `cd engine/backend && npm test`
- [ ] **Step 6: Commit**：`git commit -am "feat(ledger): opening documents show in ageing and settle, without posting"`（新档案 `git add`）

### Task 16: 导入期初分录、期初未收、期初未付，以及核对

**Files:**
- Create: `engine/backend/src/acc/opening.ts`
- Modify: `engine/backend/src/scm/routes/accounting.ts`（加 `/opening/*` 路由，权限 `requireGlPost` + 会计 Full 的付款凭证 post 权限）
- Test: `engine/backend/src/acc/opening.test.ts`

**Interfaces:**
- Consumes: `loadLedgerSettings`（Task 1）、`postJournal`（`sourceType: 'OPENING'` 豁免开账日期检查，Task 2）、`opening_balance`（Task 15）
- Produces:
  - `interface OpeningLine { accountCode: string; debitSen: number; creditSen: number }`
  - `interface OpeningArRow { docNo: string; debtorName: string; invoiceDate: string; dueDate: string; outstandingSen: number }`
  - `interface OpeningApRow { docNo: string; supplierCode: string; invoiceDate: string; dueDate: string; outstandingSen: number }`
  - `importOpeningJournal(sb, companyId: number, lines: OpeningLine[], actor: string): Promise<{ ok: true; jeNo: string } | { ok: false; error: string }>`：日期 = 开账日期前一天；没设开账日期、已经有一张没冲销的 OPENING、借贷不平，都拒绝；**可以**记应收应付控制科目
  - `importOpeningReceivables(sb, companyId, rows: OpeningArRow[], actor): Promise<{ created: number; skipped: number; errors: { docNo: string; error: string }[] }>`：建 `sales_invoices`（`opening_balance = true`、状态 SENT、金额 = 未收余额、`linked_ac_docno = docNo`）；同一个 docNo 第二次导入就跳过
  - `importOpeningPayables(sb, companyId, rows: OpeningApRow[], actor)`：同样的回传；建 `purchase_invoices`（`opening_balance = true`、状态 POSTED）；找不到供应商代码的那一行列为错误
  - `openingCheck(sb, companyId): Promise<{ balanced: boolean; arControlSen: number; arDocumentsSen: number; apControlSen: number; apDocumentsSen: number; banks: { accountCode: string; name: string; balanceSen: number }[] }>`（数字取开账日期前一天）
  - 路由：`POST /api/scm/accounting/opening/journal`、`/opening/receivables`、`/opening/payables`，`GET /opening/check`

- [ ] **Step 1: 写失败的测试**：
  - `posts one OPENING journal the day before the ledger start`
  - `the opening journal may touch AR and AP`
  - `refuses a second opening journal while one is active`
  - `refuses an unbalanced opening journal`
  - `refuses when the ledger start is not set`
  - `imports receivables once and skips the same docNo the second time`
  - `reports an unknown supplier code as a row error`
  - `the check matches the AR control to the opening documents`
- [ ] **Step 2: 跑测试确认失败**：`cd engine/backend && npx vitest run --config vitest.light.config.mts src/acc/opening.test.ts`
- [ ] **Step 3: 实作**
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: Commit**：`git commit -am "feat(ledger): import opening balances and check them"`（新档案 `git add`）

### Task 17: 会计设定页的「Opening balances」区块

**Files:**
- Modify: `engine/frontend/src/conts/LedgerSetup.tsx`
- Test: `engine/frontend/src/conts/LedgerSetup.test.tsx`

**Interfaces:**
- Consumes: Task 16 的路由；Excel 解析照 `ChartOfAccounts.tsx` 的 `XLSX` 用法
- Produces: 三个上传，范本的栏位名称固定：
  - 期初分录：`Account`、`Debit`、`Credit`（RM，两位小数）
  - 期初未收：`Invoice no`、`Customer`、`Invoice date`、`Due date`、`Outstanding`
  - 期初未付：`Bill no`、`Supplier code`、`Bill date`、`Due date`、`Outstanding`

- [ ] **Step 1: 写失败的测试**：`parses the opening journal sheet into sen`（`"1,234.56"` → `123456`）；`flags a row with both debit and credit`；`shows the check in red when AR does not match`
- [ ] **Step 2: 跑测试确认失败**：`cd engine/frontend && npx vitest run src/conts/LedgerSetup.test.tsx`
- [ ] **Step 3: 实作**：上传 → 预览（有错的行标红）→ 按「Import」→ 显示核对结果，对得上绿色、对不上红色
- [ ] **Step 4: 跑测试确认通过**，再跑全部 engine 检查
- [ ] **Step 5: Commit**：`git commit -am "feat(ledger): opening balances section on the ledger setup page"`

---

## 每个 PR 合并后、在正式 ERP 上

- 用有会计权限的账号看新的页面（不开测试单据），确认菜单、页面、权限正常。
- PR 2（权限）合并后，照 Task 4 Step 6 用运营经理、财务各检查一次 Supply chain。
- 开账前的设定和导入照设计文件第 7 节「上线清单」，每一步先问财务。

## 全部做完以后

- 更新 `CLAUDE.md`、`GETTING-STARTED.md`、`TODO.md`：engine 的会计功能重新打开（要老板确认 D1 后才写）、Cloudflare 已是 Workers Paid、engine 合并即自动上线、会计权限 `scm.ledger.use`。
