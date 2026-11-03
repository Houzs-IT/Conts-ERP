# 财务第 1.5 期：顾客和供应商名单、装修合约整笔入账、项目状态表、项目额度 — 开发计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每个顾客、供应商是一笔资料，挂在自己的 control 下面，入账自动记到它的 control 并注明代码；导入 AutoCount 科目表；装修合约成立就整笔入账到项目的预收款子户口，发票不入账；顾客 / 供应商明细账；项目状态表（栏位选择器、转收入按钮）；项目额度和内部项目预算。

**Architecture:** 全部在 engine（`engine/backend`、`engine/frontend`，schema `scm`）。新的 Conts 逻辑放 `engine/backend/src/conts/`、`engine/frontend/src/conts/`；Houzs 原本的函数只在入口改「用哪个 control」。顾客名单是新表 `scm.debtors`；供应商用现有 `scm.suppliers` 加 `control_account`。入账函数都已经吃 `roles`，所以按顾客选 control 的做法是在呼叫的地方传入改过 AR / AP 的 `roles`，不改每个 builder。分 6 个 PR（A 到 F），做好一个合并一个。

**Tech Stack:** engine 后端 TypeScript + Hono（Cloudflare Worker，Supabase REST），vitest（`vitest.light.config.mts`），假数据库 `fakeSb`（`engine/backend/src/scm/lib/fake-postgrest.ts`）；engine 前端 React + vitest（jsdom），表格用 `components/DataTable.tsx`（栏位选择器、`table_layouts` 存版面）。

**Spec:** `docs/superpowers/specs/2026-10-23-finance-debtors-contracts-design.md`（业务规则：`docs/finance/FINANCE-SOP.md` 2.1、3.4、4.2.1、4.2.3）

**执行方式：** 照第 1 期的方法 C：同一个 AI 逐个任务实作、先写测试；每个 PR 合并前派一个新的 AI 审查整个 PR，Critical / Important 先写测试再修；migration 先套用到正式数据库（只用 MCP `supabase-conts-prod`，project ref `cweomoenhsjvsxfsmiiw`），再合并。

## Global Constraints

- 金额一律整数 sen。
- 分支 `feat/finance-1b-<x>-<slug>`，从最新 `origin/main` 开。
- Migration 放根目录 `migrations-pg/`，编号 = 开工时 `origin/main` 最大 + 1（2026-10-24 是 0153 起）；开头照 `0136_opening_balance_documents.sql`：`-- REVERSAL:`、说明、`-- APPLY: by hand, to production before the code merges ...`、`set local search_path = scm, public, extensions;`、`set local lock_timeout = '5s';`、最后 `notify pgrst, 'reload schema';`。套用时同一个 transaction 写 `public.pos_migrations`（checksum = 档案 CRLF 转 LF 后 sha256 的前 16 个 hex）。
- 合并前跑：`engine/backend` light 测试、`npx tsc --noEmit -p .`；`engine/frontend` 测试、tsc、`npm run lint`（只允许已知的 baseline 失败，见 `.superpowers/sdd/2026-10-21-finance-phase1-ledger/progress.md`）；改到 Property OS 的 PR 另外跑根目录 `npm run typecheck`、`npm run check`、`node scripts/api-checks/nav-engine-map.mjs`。
- 会计画面和路由都要明确拥有 `scm.ledger.use`（`*` 不算），用 `ContsLedgerGate`、`/accounting/*` 的 `requireLedgerAccess`；写入要 `requireGlPost`（`scm.payment_voucher.post`）。
- 界面文字英文、英式拼写，句首大写；新文件不加 lint 警告（`as never`、多余的 `??` 等）。
- 开账日期以前的单据不入账（`isBeforeLedgerStart`，第 1 期）照旧适用于所有新的入账。

## Review Focus

1. 同一个顾客（同名同电话）下第二张单，不会再开一个 debtor，代码沿用 → Task B3 的测试。
2. 两张单同时为新顾客开 debtor，不会撞号也不会开两个 → Task B3 的测试（unique index + 重试）。
3. 装修合约取消、VO 减少到比已收还少时，Debtor 余额照样等于「合约还没收」（可以是负数＝多收），分录借贷平衡 → Task C3 的测试。
4. 开账日期以前就签、开账后才 VO 的合约，VO 记到它连接的旧子户口，不会另开一个 → Task C4 的测试。
5. 付款凭证被拒绝、取消、撤回后，预留的额度退回；同一张 PV 重复提交不会预留两次 → Task F2 的测试。

---

## PR A：科目表导入、顾客名单

### Task A1：导入程序读对栏位，SDR / SCR 分出来

**Files:**
- Modify: `engine/frontend/src/pages/scm-v2/ChartOfAccounts.tsx:37-95`（`parseChartXlsx`）
- Test: `engine/frontend/src/pages/scm-v2/ChartOfAccounts.test.tsx`

**Interfaces:**
- Produces:
  - `type ParsedParty = { code: string; name: string; controlCode: string; kind: 'DEBTOR' | 'CREDITOR' }`
  - `type ParsedChart = { rows: ChartImportRow[]; parties: ParsedParty[]; sections: string[]; unknownSections: string[] }`
  - `parseChartXlsx(wb, known)` 照旧签名

- [ ] **Step 1: 写失败的测试**（fixture 照 Conts 的真实格式：表头 `['Acc. No.', '', '', 'Description', ..., 'Currency'(col 9)]`，上一行 col 16 是 `'Special Acc Type'`；名称在 col 3，特殊类型在 col 16）：
  - `reads the name and special type by the header, not by position` → `310-0010` 的 name `HONG LEONG BANK`、`accMoney true`
  - `keeps reading the old layout` → 现有 fixture（name col 1、special col 8）结果不变
  - `SDR and SCR sub-accounts become parties under their control` → `301-M001`（SDR，在 `301-0000` 下）不在 `rows`，在 `parties`：`{ code: '301-M001', name: 'MS YAP', controlCode: '301-0000', kind: 'DEBTOR' }`；`400-A001`（SCR）→ `kind: 'CREDITOR'`, `controlCode: '400-0000'`
  - `a control keeps no children once its parties are taken out` → `rows` 里没有任何 `parentCode === '301-0000'` 的行
- [ ] **Step 2: 跑测试确认失败**：`cd engine/frontend && npx vitest run src/pages/scm-v2/ChartOfAccounts.test.tsx`
- [ ] **Step 3: 实作**：找有 `Description` 的表头行，记 code / name / currency 栏位；`Special Acc Type` 找所在栏（可能在上一行）；找不到就用旧位置 1 和 8。SDR / SCR 行进 `parties`，`controlCode` = 上一层的 code（`prevByDepth[depth-1]`，顶层的就取同前三码的 `xxx-0000`）。
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: Commit** `feat(chart): read the AutoCount export by its header; customer and supplier accounts become parties`

### Task A2：顾客名单表、供应商 control 栏、导入名单

**Files:**
- Create: `migrations-pg/0153_debtors_and_supplier_control.sql`
- Create: `engine/backend/src/conts/parties.ts`
- Modify: `engine/backend/src/scm/routes/accounting-chart.ts:209-304`（`chartImportHandler`：上限、parties）
- Modify: `engine/frontend/src/vendor/scm/lib/accounting-queries.ts:324-343`（`ChartImportRow` 旁加 parties）
- Modify: `engine/frontend/src/pages/scm-v2/ChartOfAccounts.tsx`（预览显示科目 / 顾客 / 供应商数量、供应商配对）
- Test: `engine/backend/src/conts/parties.test.ts`、`engine/backend/tests/accountingChart.test.ts`

**Interfaces:**
- Migration：
  - `create table scm.debtors (id uuid pk default gen_random_uuid(), company_id bigint not null references public.companies(id), code text not null, name text not null, control_account text not null, customer_id uuid null references scm.customers(id), phone text, email text, address text, notes text, is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (company_id, code))`；index `(company_id, control_account)`、`(company_id, customer_id)`；grant 照 `scm.acc_debtors`（0350）
  - `alter table scm.suppliers add column if not exists control_account text`
- Produces（`conts/parties.ts`）：
  - `importParties(sb, companyId: number, parties: ParsedParty[], supplierMatches: Record<string, string>): Promise<{ debtors: number; creditors: number; renamed: number; errors: { code: string; error: string }[] }>`：DEBTOR upsert `scm.debtors`（onConflict company_id,code，不覆盖财务改过的 name）；CREDITOR：`supplierMatches[code]` 有值 → 把那个 supplier 的 `code` 改成 AutoCount 的、填 `control_account`；没有 → 插入新 supplier（code、name、control_account）
  - `suggestSupplierMatches(existing: { id: string; code: string; name: string }[], parties: ParsedParty[]): Record<string, string>`（名称正规化后比对：大写、去 `SDN BHD` / `SDN. BHD.` / `(M)` / 标点；第一个字相同且其余字的重叠 ≥ 50% 才算）
  - 路由：`chartImportHandler` body 多 `parties?: ParsedParty[]`、`supplierMatches?: Record<string,string>`；上限 1000 → 3000（科目和 parties 合计）
- [ ] **Step 1: 写 migration**
- [ ] **Step 2: 写失败的测试**（`parties.test.ts`）：
  - `imports debtors under their control` → `scm.debtors` 有 `301-M001` / `control_account '301-0000'`
  - `a second import keeps a name finance changed` → 先改 name，再导入同一个 code，name 不变
  - `a matched supplier takes the AutoCount code and control` → `HOOKKA` 的 supplier 变 `code '400-H006'`, `control_account '400-0000'`，没有多一笔
  - `suggests HOOKKA INDUSTRIES for HOOKKA MANUFACTURING and nothing for DHI FLOOR`
  - `accountingChart.test.ts`：`accepts up to 3000 rows`、`parties are not written to accounts`
- [ ] **Step 3: 跑测试确认失败**：`cd engine/backend && npx vitest run --config vitest.light.config.mts src/conts/parties.test.ts tests/accountingChart.test.ts`
- [ ] **Step 4: 实作**（预览：三个数字 + 供应商配对表，每行一个下拉可以改配对或选「New supplier」；导入按钮送 `supplierMatches`）
- [ ] **Step 5: 跑测试确认通过**（前端加 `ChartOfAccounts.test.tsx`：`the preview counts accounts, customers and suppliers`）
- [ ] **Step 6: Commit** `feat(chart): import customers and suppliers as parties under their control`

---

## PR B：按顾客、供应商的 control 记账；Debtors 维护；自动开顾客

### Task B1：找顾客 / 供应商的 control

**Files:**
- Modify: `engine/backend/src/conts/parties.ts`
- Test: `engine/backend/src/conts/parties.test.ts`

**Interfaces:**
- Produces：
  - `debtorControl(sb, companyId: number, debtorCode: string | null): Promise<{ ok: true; control: string | null } | { ok: false; error: string }>`（停用的也照样回传；找不到 → `control: null`）
  - `rolesForDebtor(roles: RoleCodes, control: string | null): RoleCodes`（`control ?? roles.AR` 放进 AR）
  - `apControlFor(roles: RoleCodes, supplier: { code: string | null; control_account?: string | null }): string`（`control_account ?? roles[apControlRole(code)]`）
- [ ] **Step 1: 失败的测试**：`a debtor posts to its own control`、`an unknown debtor falls back to the AR rule`、`a supplier with a control uses it; one without keeps the 405- rule`
- [ ] **Step 2-4**：跑失败 → 实作 → 跑通过
- [ ] **Step 5: Commit** `feat(ledger): each customer and supplier names its own control`

### Task B2：所有应收、应付分录改用 B1

**Files:**
- Modify: `engine/backend/src/scm/lib/post-si-revenue.ts`（`siLines` 呼叫处 :126）、`engine/backend/src/acc/payments.ts`（:142 `postSoPayment`、:207 `postConvertedPayment`、:285 `postSiPayment`；`postSiPayment` 的 party 改用 `customerPartyCode(inv.debtor_code, inv.customer_id)`）、`engine/backend/src/acc/credit-notes.ts:122-124`、`engine/backend/src/acc/deposit-invoices.ts:274`、`engine/backend/src/scm/routes/payment-vouchers.ts`（:609 `supplierOwnControl`、:1090、:1113）、`engine/backend/src/scm/lib/pv-refund.ts:259-277`、`engine/backend/src/scm/routes/ap-invoices.ts:350,381`、`engine/backend/src/scm/routes/accounting.ts:923`（PI）、`engine/backend/src/acc/rules.ts`（`supplierCreditNoteLines`、`apInvoiceLines`、`piLines` 改吃 `apControlFor`）
- Modify: 前端 `engine/frontend/src/pages/scm-v2/PaymentVoucherNew.tsx:520`、`PaymentVoucherDetail.tsx:400`（显示用的 control 改读 supplier 的 `control_account`）
- Test: `engine/backend/tests/partyControlPosting.test.ts`

**Interfaces:**
- Consumes：B1 的三个函数

- [ ] **Step 1: 失败的测试**（每一种分录一个）：
  - `an invoice for 301-M001 debits 301-0000 and names the customer`
  - `a payment on that invoice credits 301-0000 and names the customer`（含 `debtor_code` 空、`customer_id` 有值的情况，party 一样）
  - `a credit note, a deposit invoice and a converted payment use the customer's control`
  - `a purchase invoice, an AP invoice and a supplier credit note credit the supplier's control`
  - `a payment voucher refuses the wrong control for a supplier with its own control`
- [ ] **Step 2-4**：跑失败 → 实作 → 跑通过；再跑 `npx vitest run --config vitest.light.config.mts tests/controlCheckPayments.test.ts src/acc` 确认旧测试不坏
- [ ] **Step 5: Commit** `feat(ledger): receivables and payables post to the party's own control`

### Task B3：所有 control 的检查；自动开顾客和编码

**Files:**
- Modify: `engine/backend/src/acc/engine.ts:163-174`（手动分录不能用：`CONTROL_ROLES` 的科目 + 科目表 `special_type` 是 `SDC` / `SCC` 的科目）
- Modify: `engine/backend/src/scm/routes/accounting.ts:1375-1551`（`controlCheckHandler`：每个 SDC / SCC 科目各跑一次 `runCheck`，AR 文件的 drift 按 debtor 的 control 分）
- Modify: `engine/backend/src/acc/opening.ts:224-317`（`ControlLine.role` 改成 `accountCode` 为主；AR 按 debtor 的 control 分组）
- Modify: `engine/backend/src/conts/ledger-setup-status.ts`（control 科目有子科目 → 标红，含 SDC / SCC 的）
- Modify: `engine/backend/src/conts/parties.ts`
- Create: `migrations-pg/0154_debtor_control_map.sql`（`create table scm.acc_debtor_control_map (company_id bigint, order_kind text check (order_kind in ('RENOVATION','INHOUSE_RENOVATION','STANDARD','RENTAL')), control_account text not null, primary key (company_id, order_kind))`；seed company 1：RENOVATION→301-0000、INHOUSE_RENOVATION→302-0000、RENTAL→303-0000；STANDARD 不填 = 用 AR 规则）
- Modify: `engine/backend/src/scm/routes/suppliers.ts:460-520`（POST 没有 code 时自动编码，不再 400）
- Modify: `engine/backend/src/scm/routes/mfg-sales-orders.ts:2697-2717,4075`（建单时找或开 debtor，写 `debtor_code`）、`engine/backend/src/scm/lib/renovation-so.ts:168-174`（`convertQuotationToSo` 写 `debtor_code`、`customer_id` = 项目的 `customer_id`）
- Test: `engine/backend/src/conts/parties.test.ts`、`engine/backend/tests/controlCheckPerControl.test.ts`

**Interfaces:**
- Produces：
  - `debtorLetter(name: string): string`（去掉开头的 `MR` `MS` `MRS` `MDM` `MISS` `DR` 和后面的 `.` `/` 后，个人一律 `M`；否则第一个英文字母大写；第一个字是数字 → `0`）
  - `nextPartyCode(prefix3: string, letter: string, existing: string[]): string`（同 `prefix3-letter` 最大号 + 1，至少三位：`['301-M154'] → '301-M155'`，`['301-M999'] → '301-M1000'`）
  - `ensureDebtor(sb, companyId: number, input: { name: string; phone: string | null; email?: string | null; customerId: string | null; orderKind: 'RENOVATION' | 'INHOUSE_RENOVATION' | 'STANDARD' | 'RENTAL' }): Promise<{ ok: true; code: string; created: boolean } | { ok: false; error: string }>`（先按 `customer_id`、再按名称 + 电话找；找不到就开；撞 unique → 重读后重试，最多 5 次）
- [ ] **Step 1: 写 migration**
- [ ] **Step 2: 失败的测试**：
  - `debtorLetter`：`'MS LEE' → 'M'`、`'MR. / MS. LEE SOH TENG' → 'M'`、`'HOOKKA MANUFACTURING' → 'H'`、`'2RIO SDN BHD' → '0'`
  - `nextPartyCode`：上面两例，加 `[] → '301-H001'`
  - `a new supplier with no code gets the next one under its control`（`POST /suppliers` 没有 code 时：`nextPartyCode(control 前三码, debtorLetter(name), 现有代码)`，control 默认 400-0000）
  - `the second order for the same customer reuses the debtor`
  - `two orders racing for a new customer get one debtor`（fakeSb unique index `(company_id, code)`）
  - `a renovation contract gets a 301 debtor`
  - `a manual journal cannot touch 301-0000 when it is a debtor control`
  - `the control check reports 301-0000 and 302-0000 separately`
  - `a control with sub-accounts is marked on Ledger setup`
- [ ] **Step 3-5**：跑失败 → 实作 → 跑通过
- [ ] **Step 6: Commit** `feat(ledger): new customers get a debtor under their order's control; every control is checked`

### Task B4：Debtors 维护画面

**Files:**
- Create: `engine/backend/src/conts/debtors-routes.ts`（`GET /accounting/debtors?control=&q=&active=`、`POST /accounting/debtors`、`PATCH /accounting/debtors/:id`；写入要 `requireGlPost`；改 control 要确认 body `confirm: true` 当这个 debtor 已有分录）
- Modify: `engine/backend/src/scm/routes/accounting.ts`（挂上路由）
- Create: `engine/frontend/src/conts/Debtors.tsx`、`engine/frontend/src/conts/debtors.ts`（hooks）
- Modify: `engine/frontend/src/App.tsx`（`/scm/debtors`，`ContsLedgerGate` + `ScmGuard area="scm.finance.accounting"`）、`engine/frontend/src/routing/routeManifest.ts` 和 `routeManifestDrift.test.ts` 的数目、`src/lib/scmEngine.ts`（`LEDGER_SCREENS` 加 `{ slug: 'debtors', label: 'Debtors', enginePath: '/scm/debtors' }`）、`src/lib/navigation.ts`（`LEDGER_ICON`）
- Modify: `engine/frontend/src/pages/scm-v2/Suppliers.tsx`（列表加「Control」栏；新增 / 修改表单可以选 control：400-0000 或 405-0000 或其他 SCC 科目；代码可以留空自动编）
- Test: `engine/backend/src/conts/debtors-routes.test.ts`、`engine/frontend/src/conts/Debtors.test.tsx`

- [ ] **Step 1: 失败的测试**：`lists debtors grouped by control`、`creating a debtor gives it the next code`、`renaming keeps the code`、`moving a debtor with postings asks first`、`refuses without the post key`、前端 `shows each control with its customers`、`a new debtor form proposes the code`
- [ ] **Step 2-4**：跑失败 → 实作（`DataTable`，`tableId="conts-debtors"`，`group` 栏位分组；表单照 `pages/scm-v2/DebtorPartyForm.tsx` 的样子）→ 跑通过
- [ ] **Step 5: Commit** `feat(ledger): Debtors — customers by control, maintained by finance`

---

## PR C：装修合约整笔入账

### Task C1：预收款子户口和品牌对照

**Files:**
- Create: `migrations-pg/0155_contract_accrual.sql`（`create table scm.acc_brand_accrual (company_id bigint, brand_id bigint references public.project_brands(id), accrual_parent text not null, primary key (company_id, brand_id))`；`alter table scm.reno_so_contracts add column if not exists accrual_account text, add column if not exists debtor_code text`）
- Create: `engine/backend/src/conts/contract-accrual.ts`
- Test: `engine/backend/src/conts/contract-accrual.test.ts`

**Interfaces:**
- Produces：
  - `projectAccrualName(project: { building: string | null; unit_no: string | null; name: string | null }): string`（`'SKYLINE A-12-06'`；缺资料时用项目名称）
  - `ensureAccrualAccount(sb, companyId: number, soDocNo: string): Promise<{ ok: true; code: string; created: boolean } | { ok: false; error: string }>`（合约已有 `accrual_account` → 用它；否则按品牌找 `accrual_parent`，用 `nextPartyCode(parent 前三码, 名称第一个字母, 现有子科目)` 开科目：type LIABILITY、`parent_code` = parent、section 同 parent，写回合约）
- [ ] **Step 1: 写 migration**（seed：Dreamcrafter → 480-0000、The Conts → 481-0000，按 `project_brands.name` 找 id）
- [ ] **Step 2: 失败的测试**：`opens 481-S018 SKYLINE A-12-06 under The Conts`、`reuses the account a contract already has`、`refuses when the brand has no accrual parent`（回传可读的错误）
- [ ] **Step 3-5**：跑失败 → 实作 → 跑通过
- [ ] **Step 6: Commit** `feat(reno): every contract opens its own accrual sub-account`

### Task C2：合约成立、VO、取消入账

**Files:**
- Modify: `engine/backend/src/conts/contract-accrual.ts`
- Modify: `engine/backend/src/acc/rules.ts`（`REVERSAL_SOURCE` 加 `CONTRACT: 'CONTRACT_REVERSAL'`、`CONTRACTVO: 'CONTRACTVO_REVERSAL'`）
- Modify: `engine/backend/src/scm/lib/renovation-so.ts`（`convertQuotationToSo` 成功后；`setContractStatus` 到 `CANCELLED` 时）、`engine/backend/src/scm/lib/renovation-vo.ts:292-302`（`applyVo` 有 `net_sen` 后）
- Modify: `engine/backend/src/scm/routes/accounting.ts`（`controlCheckHandler` 的 family 加 `CONTRACT`、`CONTRACT_REVERSAL`、`CONTRACTVO`、`CONTRACTVO_REVERSAL`）
- Test: `engine/backend/src/conts/contract-accrual.test.ts`

**Interfaces:**
- Produces：
  - `postContract(sb, companyId: number, soDocNo: string): Promise<{ ok: true; jeNo: string } | { ok: true; status: 'before_ledger_start' | 'already_posted' } | { ok: false; error: string }>`：`postJournal` source `CONTRACT`、docNo = 合约号、日期 = 合约日期；借 debtor control（party = debtor_code）/ 贷 accrual account，金额 = `revisedContractSen`
  - `postContractVo(sb, companyId: number, voId: string): Promise<...同上>`：source `CONTRACTVO`、docNo = VO id、金额 = `|net_sen|`，`net_sen > 0` 借 debtor / 贷 accrual，`< 0` 反过来，`= 0` 不写
  - `reverseContract(sb, companyId: number, soDocNo: string)`：冲销 CONTRACT 和所有 CONTRACTVO
- [ ] **Step 1: 失败的测试**：`a confirmed contract debits the customer's control and credits its accrual`、`a VO adds the difference; a VO that removes work credits the customer`、`cancelling reverses the contract and its VOs`、`a contract dated before the books start posts nothing`、`posting twice writes one entry`
- [ ] **Step 2-4**：跑失败 → 实作（入账失败不挡合约成立：照 `renovation.ts:304` 的 best-effort 方式，写 audit，Ledger setup 的控制核对会列出没入账的合约）→ 跑通过
- [ ] **Step 5: Commit** `feat(reno): a contract is posted whole when it is confirmed, its VOs as differences`

### Task C3：装修发票和负数一期不入账；收款贷 debtor

**Files:**
- Modify: `engine/backend/src/scm/lib/post-si-revenue.ts:61-69`（旁边加：SI 的订单 `so_kind = 'RENOVATION'` 且合约有 `accrual_account` → `{ ok: true, status: 'contract_billed' }`；`resyncSiRevenue`、`reverseSiRevenue` 同样跳过）
- Modify: `engine/backend/src/scm/lib/renovation-billing.ts:190-213`、`engine/backend/src/scm/routes/renovation.ts:306-312`（负数一期的 CN 不入账：CN 加 `contract_billed`，`postCreditNote` 跳过）
- Modify: `engine/backend/src/scm/routes/accounting.ts`（`controlCheckHandler`：`contract_billed` 的 SI 不算 drift）、所有判断 `status === 'migrated_source' || 'opening_document'` 的地方（`si-from-do.ts:580`、`sales-invoices.ts:860`）
- Test: `engine/backend/tests/contractBilling.test.ts`

- [ ] **Step 1: 失败的测试**：
  - `billing an instalment of a posted contract writes no journal`
  - `a payment on that invoice credits 301-0000 for the customer`
  - `a negative instalment's credit note writes no journal`
  - `after billing 9,000 and receiving 9,000 on a 30,000 contract the customer's balance is 21,000`（`v_gl_entries` 合计）
  - `a VO cutting the contract below what was received leaves a credit balance on the customer`
  - `the control check does not flag a contract-billed invoice`
- [ ] **Step 2-4**：跑失败 → 实作 → 跑通过
- [ ] **Step 5: Commit** `feat(reno): contract invoices are documents only; payments settle the customer`

### Task C4：开账前的合约连到旧子户口；设定画面

**Files:**
- Create: `engine/backend/src/conts/contract-accrual-routes.ts`（`GET /accounting/contract-accruals`：每个装修合约、它的 debtor、accrual account、有没有 CONTRACT 分录；`PUT /accounting/contract-accruals/:docNo` body `{ accrualAccount, debtorCode }`，只能选 480 / 481 下面的科目；`PUT /accounting/brand-accruals` 维护品牌对照）
- Modify: `engine/frontend/src/conts/LedgerSetup.tsx`（新区块「Contracts」：品牌 → 预收款总户口；没连到子户口的合约列表，每行选子户口和 debtor）
- Test: `engine/backend/src/conts/contract-accrual-routes.test.ts`、`engine/frontend/src/conts/LedgerSetup.test.tsx`

- [ ] **Step 1: 失败的测试**：`a pre-start contract linked to 481-S012 takes its VOs there`、`only accounts under the brand's accrual parent can be linked`、`a linked pre-start contract is not posted again`、前端 `lists contracts with no accrual account in red`
- [ ] **Step 2-4**：跑失败 → 实作 → 跑通过
- [ ] **Step 5: Commit** `feat(reno): link contracts signed before the books start to their AutoCount accrual accounts`

---

## PR D：Debtor / Creditor 明细账

### Task D1：按顾客 / 供应商的明细账

**Files:**
- Modify: `engine/backend/src/scm/routes/accounting-ledger.ts:92-242`（`ledgerReport` 加 `party` 参数：`.eq('party_code', party)`，select 加 `party_type, party_code`；有 party 时只看 SDC / SCC 科目的行）
- Create: `engine/frontend/src/conts/PartyLedger.tsx`（选 debtor / creditor、日期范围；表：日期、单据、说明、借、贷、余额，期初在最上面；单据号可以点开）
- Modify: `engine/frontend/src/App.tsx`（`/scm/party-ledger?kind=debtor|creditor&code=`）、routeManifest、`src/lib/scmEngine.ts`（`debtor-ledger`、`creditor-ledger` 两个菜单）、`src/lib/navigation.ts`
- Modify: `engine/frontend/src/conts/Debtors.tsx`（每行「Ledger」连结）
- Test: `engine/backend/tests/partyLedger.test.ts`、`engine/frontend/src/conts/PartyLedger.test.tsx`

- [ ] **Step 1: 失败的测试**：`one customer's ledger shows its contract, invoices left out, payments and a running balance`、`the opening balance is the sum before the from date`、`another customer's lines never show`、前端 `shows the running balance and the closing balance`
- [ ] **Step 2-4**：跑失败 → 实作 → 跑通过
- [ ] **Step 5: Commit** `feat(ledger): a ledger for each customer and supplier`

---

## PR E：项目状态表

### Task E1：每个项目的数字（后端）

**Files:**
- Create: `engine/backend/src/conts/project-status.ts`
- Modify: `engine/backend/src/scm/routes/accounting.ts`（`GET /accounting/project-status?asOf=`）
- Test: `engine/backend/src/conts/project-status.test.ts`

**Interfaces:**
- Produces：`projectStatusRows(sb, companyId: number, asOf: string): Promise<{ ok: true; rows: ProjectStatusRow[] } | { ok: false; error: string }>`，`ProjectStatusRow`：
  `projectId, projectName, debtorCode, debtorName, salesperson, brand, kind ('RENOVATION'|'INHOUSE_RENOVATION'|'INTERNAL'), step, plannedHandover, late: boolean, contractSen, voSen, contractTotalSen, receivedSen, outstandingSen, receivedPct, nextInstalment: { seq: number; amountSen: number; dueOn: string | null } | null, gapsByPayment: (number | null)[], gapsByInvoice: (number | null)[], recognisedSen, unrecognisedSen, completionPct, dueThisMonthSen, estimatedCostSen, costSpentSen, committedSen, costToGoSen, owedToSuppliersSen, overBudget: boolean, expectedGpPct, gpToDatePct, limitPct, limitAvailableSen, limitUsedSen, limitReservedSen, limitLeftSen, workAheadOfMoney: boolean`
  - `costSpentSen` = 项目的已入账 PI（经 `purchase_orders.project_id`）+ AP invoice 行 `project_id` 的成本，日期 ≤ asOf
  - `committedSen` = 项目 PO 行金额 − 已开 PI 的部分（经 `grn_items.invoiced_qty`）
  - `estimatedCostSen` = 合约订单行 `line_cost_sen` 合计（没取消的）
  - `completionPct` = min(costSpent ÷ estimatedCost, 99%)，交房后 100%
  - `dueThisMonthSen` = completionPct × contractTotal − 已转（项目预收款子户口借方合计）
  - `workAheadOfMoney` = completionPct − receivedPct > 20 个百分点
  - 额度栏位由 PR F 填，这里先回传 `null`
- [ ] **Step 1: 失败的测试**（例子照 SOP 4.2.1：合约 100,000、预算成本 65,000，10 月成本 20,000 → completion 30.77%、dueThisMonth 30,769）：
  - `works out completion and this month's revenue from cost`、`completion stops at 99% until handover`、`gaps count days between instalments, by payment and by invoice`、`committed cost is ordered minus invoiced`、`flags work ahead of money`、`a project with no contract shows no money figures`
- [ ] **Step 2-4**：跑失败 → 实作 → 跑通过
- [ ] **Step 5: Commit** `feat(reno): every project's money, progress and cost in one row`

### Task E2：转收入

**Files:**
- Modify: `engine/backend/src/conts/project-status.ts`
- Modify: `engine/backend/src/scm/routes/accounting.ts`（`POST /accounting/project-status/recognise` body `{ month: 'YYYY-MM', projectIds: string[] }`，要 `requireGlPost`）
- Test: `engine/backend/src/conts/project-status.test.ts`

**Interfaces:**
- Produces：`recogniseRevenue(sb, companyId: number, month: string, projectIds: string[], actor: string): Promise<{ posted: { projectId: string; jeNo: string; amountSen: number }[]; skipped: { projectId: string; reason: string }[] }>`：每个项目一笔 `postJournal` source `REVREC`、docNo `<合约号>-<YYYY-MM>`（同月不会两次）、日期 = 那个月最后一天；借 accrual account / 贷 RENOVATION 商品组的销售科目（`acc_item_group_accounts`，商品组 RENOVATION 的 `sales_account`，财务要把它设回「装修收入」）；金额 0 或负数跳过
- [ ] **Step 1: 失败的测试**：`recognises this month's amount from accrual to revenue`、`the same month twice posts once`、`a month before the books start is refused`、`REVREC lines on the accrual do not show as foreign in the control check`
- [ ] **Step 2-4**：跑失败 → 实作（`REVERSAL_SOURCE` 加 `REVREC`）→ 跑通过
- [ ] **Step 5: Commit** `feat(reno): recognise a month's revenue for chosen projects`

### Task E3：项目状态画面

**Files:**
- Create: `engine/frontend/src/conts/ProjectStatus.tsx`、`engine/frontend/src/conts/projectStatus.ts`（hooks）
- Modify: `engine/frontend/src/App.tsx`（`/scm/project-status`）、routeManifest、`src/lib/scmEngine.ts`（`project-status`）、`src/lib/navigation.ts`
- Test: `engine/frontend/src/conts/ProjectStatus.test.tsx`

- [ ] **Step 1: 先用 `dashboard-design` skill**（用户全域规则），照系统的颜色（`--c-secondary-a` 好、`--c-festive-b` 坏、`--line`、`--fg-muted`）
- [ ] **Step 2: 失败的测试**：`every column is in the column chooser, grouped as in the spec`（groups：Project、Amounts、Collection、Gaps、Revenue、Cost、Margin、Limit）、`overspent and work-ahead rows are marked`、`Recognise posts the chosen projects for the month and refreshes`、`only someone who can post sees Recognise`
- [ ] **Step 3-5**：跑失败 → 实作（`DataTable` `tableId="conts-project-status"`，每栏有 `group`；金额靠右、tabular nums；「Recognise」先确认：列出项目和金额）→ 跑通过
- [ ] **Step 6: Commit** `feat(reno): Project status — one row per project, columns of your choice`

---

## PR F：项目额度、内部项目预算

### Task F1：付款凭证连到项目；项目的上限和类型

**Files:**
- Create: `migrations-pg/0156_project_limit.sql`：
  - `alter table scm.payment_vouchers add column if not exists project_id uuid references public.projects(id)`
  - `alter table public.projects add column if not exists funding text not null default 'customer' check (funding in ('customer','internal')), add column if not exists limit_pct_bp integer, add column if not exists budget_sen bigint, add column if not exists internal_department text check (internal_department in ('rental','supply'))`
  - `alter table scm.acc_company_settings add column if not exists project_limit_pct_bp integer not null default 7000`
  - `alter table scm.accounts add column if not exists everyday_expense boolean not null default false`
  - `create table scm.project_limit_requests (id uuid pk, company_id bigint not null, project_id uuid not null references public.projects(id), kind text not null check (kind in ('amount','pct','budget')), amount_sen bigint, pct_bp integer, reason text not null, status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')), requested_by text not null, decided_by text, decided_at timestamptz, created_at timestamptz not null default now())`
- Create: `engine/backend/src/conts/project-limit.ts`
- Modify: `engine/backend/src/scm/routes/payment-vouchers.ts`（建立 / 修改时：settle 的 PI / AP invoice 连到同一个项目 → 自动填 `project_id`；连到两个以上项目 → 409 「一张付款凭证只能付一个项目」）
- Test: `engine/backend/src/conts/project-limit.test.ts`

**Interfaces:**
- Produces：
  - `projectOfBills(sb, companyId: number, bills: { kind: 'PI' | 'API'; id: string }[]): Promise<{ ok: true; projectId: string | null } | { ok: false; error: 'many_projects' | string }>`
  - `projectLimit(sb, companyId: number, projectId: string): Promise<{ ok: true; funding: 'customer' | 'internal'; limitSen: number; usedSen: number; reservedSen: number; leftSen: number; pctBp: number | null } | { ok: false; error: string }>`：顾客项目 `limitSen` = 已收（合约发票 `paid_sen` 合计，只算已核对的收款）× pct + 批准的 amount 请求；内部项目 `limitSen` = `budget_sen` + 批准的 budget 请求；`usedSen` = 这个项目 POSTED 的 PV 金额（`everyday_expense` 科目的行不算）；`reservedSen` = 已提交、还没入账也没被拒绝或取消的 PV（状态名照 `payment-vouchers.ts` 的 submit / check / approve 流程实际写入的值，实作前先读）
- [ ] **Step 1: 写 migration**
- [ ] **Step 2: 失败的测试**（照 SOP 3.4 的例子：额度 7,000，A 3,000、B 2,500 → 剩 1,500；拒绝 B → 剩 4,000）：`a voucher paying a project's bills names the project`、`a voucher paying two projects is refused`、`the limit is 70% of what the customer paid`、`an approved extra amount adds to the limit`、`an internal project uses its budget; everyday expense lines are not counted`
- [ ] **Step 3-5**：跑失败 → 实作 → 跑通过
- [ ] **Step 6: Commit** `feat(projects): payment vouchers belong to a project; its limit is worked out`

### Task F2：提交时检查、预留；额外额度申请和批准

**Files:**
- Modify: `engine/backend/src/scm/routes/payment-vouchers.ts`（`submitPaymentVoucherHandler` :1447、`postNowHandler` :1557：超出 → 409 `{ error: 'over_project_limit', leftSen, overSen }`；`reject` / `withdraw` / `cancel` 不用另外处理，因为预留是从状态算的）
- Create: `engine/backend/src/conts/project-limit-routes.ts`（`GET /accounting/projects/:id/limit`、`POST /accounting/projects/:id/limit-requests`、`POST /accounting/limit-requests/:id/approve|reject`：批准要新权限 `scm.project_limit.approve`，在 `engine/backend/src/conts/access.ts` 的会计 Full 加上；不能批准自己提的）
- Modify: 前端 `engine/frontend/src/pages/scm-v2/PaymentVoucherNew.tsx`、`PaymentVoucherDetail.tsx`（项目栏；显示剩余额度；超出时「Request extra limit」）
- Create: `engine/frontend/src/conts/LimitRequests.tsx`（待批准的申请列表，放在 Project status 页的分页）
- Test: `engine/backend/src/conts/project-limit.test.ts`、`engine/frontend/src/conts/LimitRequests.test.tsx`

- [ ] **Step 1: 失败的测试**：`submitting over the limit is refused with what is left and how much over`、`a rejected or withdrawn voucher gives its reservation back`、`submitting the same voucher twice reserves once`、`Post now checks the limit too`、`a request cannot be approved by the person who asked`、`approving a pct request raises that project's percentage`、前端 `the voucher shows the limit left and offers a request when over`
- [ ] **Step 2-4**：跑失败 → 实作 → 跑通过
- [ ] **Step 5: Commit** `feat(projects): vouchers stay within the project's limit; extra limit by approval`

### Task F3：内部项目、日常开销科目、状态表的额度栏

**Files:**
- Modify: `engine/frontend/src/pages/renovation/*`（开项目画面：Customer / Internal、内部项目的部门和预算）——找项目建立表单（`services/renovation/create.ts` 的前端）
- Modify: `engine/backend/src/services/renovation/create.ts`（存 `funding`、`internal_department`、`budget_sen`）
- Modify: `engine/frontend/src/pages/scm-v2/ChartOfAccounts.tsx`（每个科目可以勾「Everyday expense」）、`engine/backend/src/scm/routes/accounting-chart.ts`（`chartUpdateHandler` 收这一栏）
- Modify: `engine/backend/src/conts/project-status.ts`（填额度栏；内部项目没有收钱和收入栏）
- Test: `engine/backend/src/conts/project-status.test.ts`、`engine/backend/tests/accountingChart.test.ts`

- [ ] **Step 1: 失败的测试**：`an internal project is created with its department and budget`、`a chart account can be marked everyday expense`、`the status row carries the limit figures`、`an internal project row has no collection or revenue figures`
- [ ] **Step 2-4**：跑失败 → 实作 → 跑通过
- [ ] **Step 5: Commit** `feat(projects): internal projects with a budget; everyday expense accounts`

---

## 每个 PR 合并后

- 在正式 ERP 用财务的账号看新的画面（不开测试单据）。
- PR A 合并后、开账前：照「上线清单」导入科目表（先给财务看预览），加 303-0000 RENTAL CUSTOMER。
- PR C 合并后、开账前：在 Ledger setup 把开账前签的合约连到它们的子户口。
