# 财务第 1 期：公司总账开始用 engine（技术设计）

- 日期：2026-10-20
- 状态：草稿，待财务（chew）确认
- 依据：`docs/finance/FINANCE-SOP.md`（业务流程，特别是第 7、14 节）
- 范围：只有第 1 期。第 2 到 6 期另外设计。

---

## 1. 目标

上线日起，公司的账在 ERP 里做，不再用 AutoCount：

- 一本总账，用 engine（Supply chain 系统）现有的会计功能。
- 财务从一个 Finance 入口进去，两边侧边栏（Rental、Supply chain）都看得到，不用切换。
- 科目表沿用 AutoCount 那份；期初余额从 AutoCount 导入。

**第 1 期不做**（在后面几期）：Rental 交易自动入账（第 2 期）、付款中心和付款申请（第 3 期）、项目额度、维修加价、零用金、押金、长租、催款（第 4 期）、月结锁账（第 5 期）、e-Invoice（第 6 期）。第 1 期期间，Rental 的收入、业主付款、费用由财务每月手动做汇总分录。

---

## 2. 现况（2026-10-20 查过的代码）

### 2.1 engine 的总账已经有的

| 功能 | 现况 | 位置 |
|---|---|---|
| 科目表 | 有。AutoCount 的分类（16 个 section）和特殊类型（银行、现金等），每个公司一份 | 表 `scm.accounts`（migrations-pg/0044），页面 `/scm/chart-of-accounts` |
| 科目表导入 | 有。直接读 AutoCount 导出的 Excel（.xlsx），最多 1,000 行 | `engine/frontend/src/pages/scm-v2/ChartOfAccounts.tsx`、`engine/backend/src/scm/routes/accounting-chart.ts` |
| 会计分录 | 有。借贷平衡检查、同一张单据不会重复入账、可以冲销 | `engine/backend/src/acc/engine.ts`（postJournal / reverseJournal） |
| 手动分录 | 有，但不能动应收、应付的控制科目 | `/scm/accounting?tab=je`；`engine.ts:157-168` |
| 自动入账 | 销售发票、采购发票、A/P 发票、付款凭证、收款、订金发票、贷项通知单等都会自动入账 | `engine/backend/src/acc/rules.ts` |
| 付款凭证 | 有，带审批：准备 → 核对 → 批准 → 入账 | `engine/backend/src/scm/routes/payment-vouchers.ts` |
| 收款 | 有：一般收款、客户付款、正式收据 | `receipts.ts`、`acc/payments.ts`、`acc/receipts.ts` |
| 银行对账 | 有：上传月结单自动配对。**已支持 Maybank（CSV、PDF）和 Hong Leong（两种 CSV）** | `acc/bank-parse.ts`、`acc/bank-match.ts`、`/scm/bank-recon` |
| 报表 | 试算表、总账明细、损益表、资产负债表、应收应付账龄 | `scm/routes/accounting-reports.ts`、`accounting.ts` |
| 拍照读账单（OCR） | 付款凭证有“扫描账单”，用 Claude 读，需要 `ANTHROPIC_API_KEY` | `acc/bill-extract.ts`（第 3 期用） |

### 2.2 不够或要改的

| # | 问题 | 位置 |
|---|---|---|
| G1 | **engine 的会计页面在 Conts 被关掉了**：老板 2026-10-11 的决定 C7（“Conts 不用 engine 的会计总账”）。`/scm/accounting`、`/scm/chart-of-accounts` 会被转去销售订单 | `engine/frontend/src/conts/navOnly.ts:16-22` |
| G2 | Property OS 菜单没有会计页面的入口；会计页面靠 `?tab=` 切换分页，engine 自己的侧边栏在框里被藏起来，所以每个分页都要一个菜单项目 | `src/lib/navigation.ts`、`src/lib/scmEngine.ts`、`engine/frontend/src/pages/scm-v2/Accounting.tsx:70-82` |
| G3 | Property OS 还有旧版的 Accounting（`/accounting`）和 Payment vouchers（`/procurement/payment-vouchers`），用旧数据（`pos`），跟 engine 的发票对不上 | `src/App.tsx:257, 294` |
| G4 | 权限：在 8 个 Supply chain 区域都是 Full 的人，在 engine 是“全部权限”（`*`），可以做付款凭证；少一个区域就完全不能碰付款凭证（403）。Property OS 没有独立的“会计”权限区域 | `functions/_lib/scmEngine.ts:6`、`engine/backend/src/conts/sso.ts:42-62`、`engine/backend/src/conts/access.ts:62-80` |
| G5 | 付款凭证一定要走完 准备 → 核对 → 批准 才能入账，没有快捷方式（Houzs 的设计）。一个人有全部权限可以自己走完，但要按三四次 | `engine/backend/src/scm/lib/pv-approval.ts:26-27` |
| G6 | 付款凭证在“核对”时，用银行账户的编号字母出正式号码；没设定就会被拒绝 | `payment-vouchers.ts:1439-1485` |
| G7 | **没有科目表**：正式数据库是空的；staging 只有 12 个四位数的测试科目，跟自动入账用的 AutoCount 编号对不上，也没有标成银行或现金 | TODO.md（科目表）；`scripts/engine-production.mjs seed` |
| G8 | 自动入账规则（哪一种交易记哪个科目）存在 `scm.acc_account_roles`，**目前是空的**，所以用写死的 AutoCount 编号（例如应收 300-0000、Maybank 310-0010）。只有“默认银行”可以在画面上改 | `acc/rules.ts:42-92, 150-165`；`accounting.ts:306-335` |
| G9 | 销售发票按“商品组”记收入科目（`scm.acc_item_group_accounts`），没设定就**不入账**（group_unbound）。装修的分期发票也是这样记收入，跟财务决定的“按完工进度”不同 | `acc/item-group-split.ts:71-78` |
| G10 | **没有部门、unit 维度**。分录行有 `project_id` 但从来没写入 | `engine.ts:233-285` |
| G11 | **没有财政年度**：没有年度设定、没有年结。试算表只有“全部期间”，不能选日期；资产负债表的利润从第一笔开始累计，没有分“今年利润 / 保留盈余” | `accounting-reports.ts:265-431`；视图 `v_account_balances` |
| G12 | **没有期初余额功能**：没有期初分录、没有期初发票导入。手动分录又不能动应收应付控制科目 | `engine.ts:157-168` |
| G13 | 银行对账读账户明细时没有分页，超过 1,000 笔会被截掉 | `acc/bank.ts:230-237` |
| G14 | “月结锁”只锁银行对账，不锁总账；第 5 期再做总账锁账 | `acc/bank-lock.ts:34-37` |
| G15 | engine 的改动**没有自动检查**（CI 不跑 engine），合并进 main 就**自动上正式环境** | `.github/workflows/ci.yml:6-9`、`deploy-engine-production.yml` |
| G16 | 本地跑不了 engine 的会计页面：engine 读数据库要经过 PostgREST（Supabase REST），本地没有 | `engine/backend/src/db/supabase.ts`；`docs/qa/2026-10-15-qa-sweep.md:81-90` |

### 2.3 Cloudflare 免费方案的限制（每个动作最多 50 次外部调用）

engine 每读写一次数据库就算一次外部调用。估算（来自代码路径）：

| 动作 | 大约几次 | 免费方案 |
|---|---|---|
| 手动分录（建立 + 入账） | 8 + 2 | 没问题 |
| 一般收款 | 约 15 | 没问题 |
| 付款凭证入账，付 1 张发票 | 约 26 | 没问题 |
| 付款凭证入账，付 5 张发票 | 约 38 | 接近上限 |
| 付款凭证入账，付 10 张以上发票 | 50 以上 | **会失败** |
| 银行对账自动配对（每配到一笔 +2） | 8 + 2 × 配对笔数 | **一个月结单配对超过约 22 笔就失败** |
| 上传月结单 | 约 20 + 2 × 配对笔数 | 同上 |
| 试算表 | 1 | 没问题 |
| 损益表、资产负债表 | 随数据变多 | 数据多了会失败 |

**结论：银行对账在免费方案下基本不能用。** 升级 Workers Paid（每月 US$5 起，每个动作默认 10,000 次）就没有这个问题。

**更新（2026-10-21）**：Cloudflare 账单显示 2026-10-17 起有一张 US$5.40 的发票（US$5 加税），计费周期也从 10-17 开始，看起来账号已经是 Workers Paid。在 Billing → Subscriptions 看到「Workers Paid」后，这一节的限制就不适用。

---

## 3. 设计

### 3.1 菜单和入口（G1、G2、G3）

- **打开 engine 的会计页面**：从 `CONTS_HIDDEN_PATHS` 拿掉 `/scm/accounting` 和 `/scm/chart-of-accounts`（`navOnly.ts`，同时改 `navOnly.test.ts`）。预测（forecast）、财务仪表板维持关闭。**这会改掉老板的决定 C7，要老板确认（见第 9 节 D1）。**
- **两边侧边栏都有 Finance 组**：Property OS 的菜单组只能属于一个侧边栏，所以照 IT Support 的做法，Rental 和 Supply chain 各有一个 Finance 组，内容一样，网址不同（例如 `/finance/ledger/...` 和 `/supply/finance/ledger/...`）。
- **Finance 组的项目**：

| 项目 | 打开 |
|---|---|
| Accounts payable、Utility bills、Approvals | 现有的 Property OS 页面（Rental 的钱） |
| 付款凭证 | engine `/scm/payment-vouchers` |
| 收款 | engine `/scm/receipts` |
| 银行对账 | engine `/scm/bank-recon` |
| 会计分录 | engine `/scm/accounting?tab=je` |
| 总账明细、试算表、损益表、资产负债表、应收账龄、应付账龄 | engine `/scm/accounting?tab=…`，每个分页一个项目 |
| 科目表 | engine `/scm/chart-of-accounts` |
| 商品组科目 | engine `/scm/accounting?tab=groups` |
| 会计设定（新） | engine 新页面：开账日期、财政年度（3.7）、入账规则（3.4）、期初余额（3.8），分成几个区块 |

- `ENGINE_PATH` 加上这些网址。修正 `menuPathFor` 的同分规则：同一个 engine 页面对应两个菜单网址时，优先用目前所在的那个，避免侧边栏跳到另一边（`src/lib/scmEngine.ts:51-62`、`SupplyChainEngine.tsx:65-67`）。
- **关掉旧版页面**：`/accounting` 和 `/procurement/payment-vouchers` 改成转去新的入口（用 `App.tsx` 现有的 `<Moved>`）。`/accounting/credit-notes` 已经开 engine，不动。

### 3.2 权限：新增“会计”区域（G4）

- Property OS 权限表新增一个区域“会计”（ledger）：默认 management、finance_admin 是 Full，其他角色 None。之后照财务给的权限表调整。
- Finance 组里的会计项目都属于这个区域，所以**没有这个区域权限的人看不到**。这同时解决“上线前先藏起来”：上线前只有财务和管理层看得到，合并进 main 也不影响别人。
- **不改**“8 个 Supply chain 区域全是 Full → engine 全部权限（`*`）”的规则。`*` 除了会计还包含很多别的东西（所有页面、绕过区域检查、项目管理里的总监身份等），改了会让运营经理失去现有的 Supply chain 功能。
- 改成另外加一个 engine 权限 `scm.ledger.use`，**一定要明确拥有才算，`*` 不算**（engine 已有 `holdsHouzsPermLiterally` 这种检查）。会计页面、付款凭证、收款、银行对账、会计设定都要这个权限。
  - 8 区全 Full、又有会计权限的人：engine 角色 = 原本 `*` 角色的全部权限 + `scm.ledger.use`。
  - 其他人：原本的「Conts: 角色」+ 按会计等级加：View → `scm.ledger.use`；Edit → 再加付款凭证的建立、编辑；Full → 再加核对、批准、入账、作废。
- 销售同事在用的正式收据等功能**不受影响**：只挡会计专用的路径，正式收据维持原本的权限。
- **上线顺序**：engine 把“会计”区域当成可有可无（没有就是 None），所以先上哪边都不会挡住登入；照惯例先上 Property OS，再上 engine。

### 3.3 科目表导入（G7）

- 用 engine 现有的“上传 AutoCount 导出的 Excel”功能，不另外做。
- 导入后检查：银行和现金科目要标成“银行/现金”（`acc_money`），否则开付款凭证、收款会被拒绝。
- 上线前先在 staging 用财务给的科目表试导入一次。

### 3.4 入账规则设定页（G8、G9）

- 新增一个设定页（engine 会计里），列出每一种自动入账规则，让财务选对应的科目：应收、应付、现金、各银行、刷卡清算、订金、销售退回、采购退回等等（`acc/rules.ts` 里的全部规则）。存进现有的 `scm.acc_account_roles`。
- 同一页也设定每个商品组的销售、采购科目（`scm.acc_item_group_accounts`，engine 原本有这个分页，在 Conts 被藏起来了）。
- 科目表导入后，**没对应的规则会标红**，全部对应好才能上线。
- **装修发票记预收款**（照 SOP 4.2.1 方法 B）：装修的分期发票都只有一行，商品组是 RENOVATION（`scm/lib/renovation-billing.ts:185-186`）。所以不用写新规则：把 RENOVATION 商品组的销售科目和销售退回科目都设成“预收款（合约负债）”就好。要改的只有：商品组设定页里，RENOVATION 这一组的选单允许选负债科目（目前只列收入科目）。按完工进度把预收款转成收入的月底计算是第 2 期；第 1 期期间由财务每月手动做这笔分录。

### 3.5 部门维度（G10）

- 分录行加“部门”：Rental / Supply chain / 公司共用（migration，`scm.journal_entry_lines`）。
- 手动分录、付款凭证、收款的每一行可以选部门；engine 自动产生的分录（销售发票、采购发票等）默认 Supply chain。
- 报表可以按部门筛选：损益表、总账明细、试算表。
- unit 维度在第 2 期（Rental 自动入账时）一起做。
- **建议放在第 1 期**：这样从上线第一天起，每笔账都分好部门（见 D3）。

### 3.6 付款凭证一个人完成（G5、G6）

- 有“批准”权限的人，多一个按钮“**直接入账**”：一次完成 准备、核对、批准、入账，每一步照样记下是谁、什么时间。原本四步的流程保留，不用的话可以不理。
- 这是 Conts 自己的改动，写在 `engine/backend/src/conts/` 或用 Conts 的开关，Houzs 原本的流程不变。
- 上线前每个银行账户要设定付款凭证的编号字母（G6）。

### 3.7 财政年度和报表（G11）

- 新增设定：财政年度结束月份，默认 8 月（FYE 8 月，9 月 1 日到隔年 8 月 31 日），可以修改。
- 试算表：可以选日期（截至某天，或某段期间）。
- 损益表：默认显示本财政年度。
- 资产负债表：利润分成“保留盈余（本财政年度以前）”和“本年度利润”。
- 正式的年结分录（把本年度利润转进保留盈余）第一次要到 2027 年 8 月，放在第 5 期跟月结锁账一起做。

### 3.8 期初余额（G12）

上线日前一天（例如 2026-11-30）为期初日。

1. **期初分录**：一张特别的分录（类型 OPENING），照 AutoCount 的试算表，每个科目一行，包括本财政年度到期初日的损益。这张分录**允许**记应收、应付控制科目（一般手动分录不行）；只能用导入工具建立，只能有一张，可以冲销重做。
2. **期初未收、未付单据**：导入客户还没付的发票、公司还没付的供应商账单，标成“期初单据”。**不再入账**（金额已经在期初分录里），但会出现在应收应付账龄里，之后收款、付款也可以对冲它们。做法照 engine 现有的“从旧系统转过来、不入账”的方式（`migrated_no_stock`、`imported`），细节在开发计划时确认。
3. **核对报表**：导入后自动比对：试算表总数跟 AutoCount 一样、每个银行余额、应收应付账龄总数等于控制科目余额。有差额就标红。
4. 押金、董事往来、零用金、应付业主：第 1 期先作为科目余额放进期初分录；清单的明细在第 4 期。
5. **期初日以前的单据不入账**：系统里期初日以前的发票、付款，金额已经包含在 AutoCount 的期初余额里，不能再自动入账或补入账。上线后修改或作废这些旧单据，也不能产生冲销分录。开发时加一个「开账日期」设定，engine 入账前检查单据日期。

**切换的时间表**（开账日期由财务决定，以 12 月 1 日为例）：

| 时间 | 做什么 |
|---|---|
| 上线前约一个星期 | 财务给 AutoCount 科目表；在 staging 试导入、设定入账规则 |
| 上线前一天 | 正式环境导入科目表、设定入账规则和银行账户；设定开账日期 12 月 1 日 |
| 12 月 1 日起 | 新的交易都在 ERP 做；Supply chain 的发票开始自动入账 |
| 12 月第 1、2 个星期 | AutoCount 把 11 月的账做完（银行、账单都入好）后，导出 11 月 30 日的试算表、未收和未付清单，导入 ERP，核对 |

- 期初余额晚一两个星期导入不影响日常工作；只是这段时间的报表还没有期初数字。
- 上线后要付 11 月以前的旧账单：期初未付清单导入后才对冲得到；在那之前先照常付款，导入后再对冲。

### 3.9 银行（G13）

- 修正银行对账读明细超过 1,000 笔会被截掉的问题（`acc/bank.ts:230-237`）。
- 每个银行账户设定月结单格式（Maybank / Hong Leong），以及付款凭证编号字母。

### 3.10 测试和上线方式（G16；财务决定 2026-10-21：直接上线）

不在本地跑 engine（不下载 PostgREST），也不用 staging。每个 PR 做好、检查过就合并，直接上正式环境。保险：

1. 每次合并前，在财务的电脑上跑完全部自动检查：
   - Property OS：`npm run typecheck`、`npm run build`、`npm run check`，以及相关的 `scripts/api-checks`（用本地 PGlite 数据库）。
   - engine：`npm run typecheck`、`npm run lint`（在 `engine/`），`npm test`（在 `engine/backend`、`engine/frontend`），能跑的话加 `npm run test:pg`。
2. 会计功能都藏在「会计」权限后面，新开关默认关；上线后只有财务和管理层看得到。
3. 在正式 ERP 上只做「看画面、做设定」，不开测试的付款凭证、收款、分录，不上传测试月结单。
4. 改权限（PR 2）合并后，马上用不同角色检查 Supply chain 是否正常；有问题马上撤回（revert）那个 PR。
5. 每个 PR 都很小，出问题容易撤回。
6. 动到真实数据的事（导入科目表、设定入账规则、导入期初余额）都等开账前才做，每一步先问财务。
7. 需要 migration 的 PR：先把 migration 套用到正式数据库，再合并代码。要先向 Zaim 拿正式数据库的连线资料（`.dev.vars` 文件，用 USB 或密码管理器传）。

---

## 4. 会改到的地方

| 地方 | 改什么 |
|---|---|
| Property OS 菜单（`src/lib/navigation.ts`、`src/lib/scmEngine.ts`） | 两个 Finance 组、会计项目、`ENGINE_PATH`、同分规则 |
| Property OS 路由（`src/App.tsx`） | 旧版 Accounting、Payment vouchers 转走 |
| Property OS 权限（`functions/_lib/access.ts`、`functions/_lib/scmEngine.ts`） | 新区域“会计”，带进 sign-on |
| engine 权限（`engine/backend/src/conts/access.ts`、`sso.ts`） | 会计区域对应页面和付款凭证权限 |
| engine 页面开关（`engine/frontend/src/conts/navOnly.ts`） | 打开会计、科目表 |
| engine 付款凭证 | “直接入账”（Conts 专用） |
| engine 会计 | 入账规则设定页、装修预收款规则、部门、财政年度和报表、期初导入、银行明细分页 |
| 数据库 migration（`migrations-pg/`） | 部门栏位、财政年度设定、期初单据标记等。编号开工时照最新 + 1，先跟团队说 |
| 测试 | engine：`npm run typecheck`、`npm run lint`、`npm test`、`npm run test:pg`；Property OS：`npm run typecheck`、`npm run build`、`npm run check`、`scm-engine-access.mjs`、`nav-engine-map.mjs` |

---

## 5. 拆成几个 PR

每个 PR 合并后都会直接上线，所以每个都要“上线了也不影响别人”。会计的东西都藏在“会计”权限后面。

| PR | 内容 | 上线影响 |
|---|---|---|
| 1 | 开账日期设定，engine 入账前检查单据日期（3.8 第 5 点） | 没设定开账日期之前，入账照旧 |
| 2 | 权限区域“会计” | 先上 Property OS，再上 engine；别人的权限不变 |
| 3 | 菜单入口、打开 engine 会计页面、关掉旧版页面 | 只有有会计权限的人看得到新入口；旧版两页转走 |
| 4 | 付款凭证“直接入账”、银行明细分页修正 | 只影响付款凭证、银行对账 |
| 5 | 部门维度 | migration 先套用；新分录多一个栏位 |
| 6 | 财政年度和报表 | 报表多了日期和年度选项 |
| 7 | 入账规则设定页、装修预收款规则 | 设定好之前不改变现有入账 |
| 8 | 期初余额导入工具和核对报表 | 只有导入时才动到数据 |

科目表和期初余额的**真实数据**，等财务给资料后，在上线日导入。

---

## 6. 测试

照 3.10：每个 PR 合并前跑完自动检查；新的逻辑（开账日期检查、权限对应、期初导入、部门、报表日期）都要有单元测试。权限的改动用测试比对改之前和之后每个角色在 engine 的权限，确认只有会计相关的有变化。合并后在正式 ERP 上只看画面、做设定。

---

## 7. 上线清单（上线日）

1. 老板确认：重新打开 engine 会计（D1）；确认 Cloudflare 是 Workers Paid（D4）。
2. 向 Zaim 拿：staging 和正式数据库的连线资料、Cloudflare 权限。
3. 所有 PR 已合并、migration 已套用到正式环境（先套用 migration，再合并代码）。
4. 导入 AutoCount 科目表；标好银行、现金科目；设定入账规则和商品组科目，**没有红色**。
5. 设定银行账户：月结单格式、付款凭证编号字母。
6. 设定财政年度（FYE 8 月）。
7. 导入期初分录和期初未收、未付单据；核对报表**全部对得上**。
8. 打开“会计”权限给需要的人。
9. 通知用 Supply chain 的同事：从上线日起，销售、采购发票会自动入账到新科目。

---

## 8. 风险

| 风险 | 处理 |
|---|---|
| 如果 Cloudflare 其实还是免费方案，银行对账和大张付款凭证会失败，最怕只记了一半 | 账单看起来已经升级（D4）；上线前在 Subscriptions 确认 |
| 加“会计”区域改到 engine 的权限，可能影响别人 | 逐个角色比对测试；先上 Property OS 再上 engine |
| engine 没有自动检查，合并就上线 | 每个 PR 手动跑全部检查，并在 staging 测过 |
| 上线后自动入账规则少对应一个，Supply chain 的发票会入账失败 | 设定页标红，全部对应好才上线；上线后第一周每天看 engine 的 control-check |
| AutoCount 导出的 Excel 格式跟 engine 预期不同 | 先在 staging 用真实文件试导入 |
| 期初余额导入后对不上 | 核对报表；可以冲销期初分录重做 |
| 期初日以前的旧单据被补入账，跟期初余额重复 | 开账日期设定，engine 入账前检查单据日期（3.8 第 5 点） |
| 直接上线（财务决定）：第一次真正点开新功能就在正式环境；engine 改坏会影响全公司 | 3.10 的保险：合并前跑完自动检查、藏在权限后面、正式 ERP 只看不开测试单据、小 PR、出问题马上撤回 |
| staging 只有一个，大家共用 | 用之前在群里说 |

---

## 9. 要财务决定的事

| # | 事项 | 建议 |
|---|---|---|
| D1 | engine 的会计功能是老板 10-11 决定关掉的（C7）。重新打开要老板确认 | 待财务问老板 |
| D2 | 测试方式 | **已定：直接上线**，不下载 PostgREST、不用 staging，照 3.10 的保险（财务，2026-10-21） |
| D3 | 部门维度 | **已定：第 1 期做**（财务，2026-10-21） |
| D4 | Cloudflare 付费方案 | **已确认**：账单 2026-10-17 起每月 US$5.40（财务，2026-10-21） |
| D5 | 上线日 | 财务决定，目标 11 月；来不及时由财务改期 |
| D6 | 装修分期发票从第 1 期起记预收款，第 2 期前每月手动做完工进度的分录 | **已定：同意**（财务，2026-10-21） |

---

## 10. 时间估计

| 工作 | 天数 |
|---|---|
| PR 1 开账日期检查 | 0.5 到 1 |
| PR 2 权限区域 | 1.5 到 2 |
| PR 3 菜单和页面 | 1 |
| PR 4 付款凭证、银行修正 | 1 到 1.5 |
| PR 5 部门维度 | 1.5 到 2 |
| PR 6 财政年度和报表 | 1.5 到 2 |
| PR 7 入账规则设定页 | 1.5 到 2 |
| PR 8 期初导入和核对 | 2 到 3 |
| 正式 ERP 上看画面、修改 | 1 到 2 |
| **合计** | **约 11 到 16 个工作天** |

不包括：等资料（科目表、期初余额）、等老板决定、上线日导入和核对的时间。上线日由财务决定（D5）。
