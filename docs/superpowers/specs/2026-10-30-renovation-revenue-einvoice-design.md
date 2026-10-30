# Renovation revenue = the invoices, ready for e-invoice — design

Date: 2026-10-30. Owner: chew (finance). Decisions taken in chat on 29–30 Oct 2026; the SOP (`docs/finance/FINANCE-SOP.md` 2.1, 4.2, 4.2.1, 4.2.3) is rewritten to match once this design is approved.

## 1. Why

The company must issue e-invoices for every sale (it is above the LHDN exemption threshold), and chew wants the books to say the same as the e-invoices: **the revenue in the ledger each month is exactly what was invoiced (and e-invoiced) that month.** Percentage-of-completion revenue (SOP 4.2.1, "method B", decided 20 Oct) is still wanted, but only to judge how a project is really doing: it moves to the performance P&L and the project dashboard and is never booked.

At the same time chew wants:

- renovation revenue booked to the chart's own detailed accounts (501-0010 wall, 501-0020 electrical, 502-0010 TV cabinet …), not one renovation account;
- each project's unbilled contract visible in the ledger, on its own advance sub-account (480 Dream Crafter / 481 The Conts);
- one customer account per project.

## 2. Goals

1. **Contract posted whole at signing.** When a quotation becomes a renovation contract: Dr the project's customer account / Cr the project's advance sub-account (480-xxxx or 481-xxxx), for the whole contract. A VO or price change posts the difference the same way (up or down).
2. **Invoices move the advance to revenue.** Each renovation invoice (deposit / progress billing): Dr the project's advance sub-account / Cr revenue. Revenue is the invoice amount, booked on the invoice date. A credit note also lowers the contract (section 7.1).
3. **Revenue split automatically by the waterfall.** The invoice's revenue is spread over the contract's lines in a fixed order, filling each tier before the next: **Service → Fixture → Carpentry → Furniture → Airbnb**, where Service = SERVICE, Fixture = WORKS + LIGHTING, Carpentry = BUILTIN, Furniture = FURNITURE + APPLIANCE + SOFT, Airbnb = AIRBNB (product category groups). Within a tier the amount is spread in proportion to the contract amounts of that tier's lines. Each line books to the revenue account of its **sub-category** (falling back to its group). Cumulative: invoice n fills from where invoice n−1 stopped. The split is internal: the invoice and e-invoice show one line.
   - Example: contract Service 2,000 / Fixture 9,000 (electrical 4,000, ceiling 5,000) / Carpentry 6,000 / Furniture 13,000. Invoice 1 = RM 10,000 → 505-0000 2,000; Fixture 8,000 split 4:5 → 501-0020 3,555.56, 501-0030 4,444.44. Invoice 2 = RM 10,000 → Fixture remaining 1,000 (444.44 / 555.56), Carpentry 6,000, Furniture 3,000.
4. **Accounts per sub-category.** Finance binds sales and purchase accounts per product sub-category (65 today), on the Item Groups screen; a sub-category without its own binding uses its group's. Parent accounts (with child accounts, e.g. 500-0000, 620-0000) cannot be chosen. Supplier invoices for renovation post their cost lines to the sub-category's purchase account the same way.
5. **One customer account per project.** A new renovation contract always opens its own debtor (e.g. MS LEE SKYLINE → 301-M001, MS LEE TROFI → 301-M002), under the control its kind maps to (301 renovation / 302 in-house). Its advance sub-account is opened at the same time (480-S012 SKYLINE D-25-13). Code rule as SOP 2.1: control prefix + first letter + running number, unbounded. The debtor screen can show one person's projects together.
6. **Deposit = the first progress billing.** A renovation deposit is non-refundable by default and is billed as the first progress invoice (e.g. "1st Progress Billing for Interior Design & Renovation Works (15% Deposit & Design Fee as per Sales Order, refer to attached breakdown)"). If money is refunded later, finance issues a credit note for it. The generic deposit-invoice switch (`acc/deposit-invoices.ts`, built for furniture orders, which closes deposits with credit notes at the first invoice) is **not used for renovation orders**.
7. **E-invoice ready, switched off.** Every renovation invoice and credit note carries what an LHDN e-invoice needs, and an e-invoice record is prepared for each, waiting in an outbox. A company setting "e-invoice active" (off) and a submission connector (MyInvois or a provider) come later; chew connects it. Nothing is sent until then.
8. **Percentage-of-completion revenue for management.** The performance P&L and the project dashboard show, per renovation project: completion % = booked cost ÷ expected total cost; earned revenue = completion % × contract total; invoiced revenue; the difference. Never posted.

## 3. Non-goals

- Submitting to MyInvois (chew connects it later). No consolidated e-invoices for renovation: every invoice is its own e-invoice.
- Month-end percentage-of-completion journals (SOP 4.2.1's posting) — dropped.
- Changing how instalment amounts are worked out (SOP 4.2: cumulative % of the revised contract − already billed) or how payments are confirmed (finance confirms, PR #476).
- Furniture / standard orders, Rental (Property OS).
- Recording payments at quotation stage (chew: not now).

## 4. Constraints and facts the builder needs

- Contract lines: `scm.reno_doc_lines` (quotation) mirrored into `scm.mfg_sales_order_items`; the SO rows always carry `item_group='RENOVATION'`, the real group and sub-category come from `item_code → mfg_products.category_group / sub_category` (the ACTIVE row). RENO-ADJUST (lump-sum sections), RENO-DISCOUNT (header discount, negative) and RENO-PROGRESS are SERVICE products and must not be treated as SERVICE work: a lump-sum section is spread over the lines inside it; the header discount reduces every tier in proportion. FOC lines are 0; supply-by-owner lines keep their price (they are revenue).
- VO (`renovation-vo.ts`): added lines, full omits (`cancelled`), partial omits (repriced). The waterfall always works on the contract as it stands at the invoice date; a VO that lowers a tier already filled leaves the earlier invoices as they were and the next invoice absorbs the difference (an over-filled tier gives back first, from the last tier backwards).
- Renovation invoices today: one line `RENO-PROGRESS`, group RENOVATION (`scm/lib/renovation-billing.ts`), revenue through `scm/lib/post-si-revenue.ts` → `acc/item-group-split.ts`. Negative instalment → draft credit note to RENOVATION's sales-return account. `resyncSiRevenue` compares only the total.
- Debtors: `conts/parties.ts` `ensureDebtor` / `ensureDebtorSql` today reuse one debtor per customer per control; customers with no control are refused (PR #473). Party controls already apply to every receivable posting.
- Advance accounts 480-0000 (Dream Crafter) and 481-0000 (The Conts) exist in the chart; sub-accounts are children of them (so 480-0000/481-0000 become headers). chew's project comparison workbook (`项目对比-三页-2026-10-26 UPDATED.xlsx`, local, personal data — never committed) maps existing projects to their AutoCount debtor and advance sub-account; it seeds existing projects.
- Ledger start 2026-11-01: contracts signed earlier come in through opening balances (their AR and advance balances from AutoCount), not by re-posting the whole contract.
- E-invoice data (MyInvois SDK invoice v1.1): per line, classification (mandatory), description ≤ 300 characters (mandatory), unit price, tax type, tax amount, subtotal, total excluding tax (mandatory); quantity and unit optional; no rule on the number of lines. Buyer: name, TIN, ID type and number, address, contact, SST number if any. Which classification code and tax type to use: **for chew's accountant** — the design keeps both as company settings.
- Product text in English (British). Every new table follows the grants rule (service_role, pos_app). Production SQL never uses DROP.

## 5. Decided by chew (verbatim where short)

- "让账上记录的收入和完成度的收入不一样，完成度收入算 performance PNL 吧？可以在我之前说的 project 的 dashboard 那边看"
- E-invoice: "要强制开，先做好，到时我 active 就行"; "到时我连接就好，先把东西做好".
- Deposits: "默认不可以退，可以退到时我开 cn 就行了".
- Order: "Service → Fixture → Carpentry → Furniture → AIRBNB".
- Keep 480/481 per project ("这个我还是希望保留"); one customer account per project ("对，一个项目一个客户户口").
- The e-invoice is one line with a description like the example in 2.6.

## 6. Left to the builder

- Where the waterfall runs (one module, used by posting and by the dashboard); rounding (largest-remainder, the invoice total is the law).
- How the e-invoice outbox is stored and shown (a status per invoice: prepared / not ready — missing buyer TIN etc.).
- The sub-category bindings UI on the Item Groups screen.
- Seeding existing projects' debtors and advance sub-accounts from the comparison workbook (finance-run import, previewed first).

## 7. Answered by chew after the builder check (30 Oct 2026)

1. **Credit notes lower the contract.** A credit note on a renovation project (special discount, less work, a refund) reduces revenue, what the customer owes and the contract total by its amount; later instalments are worked out on the lower total. Postings: Dr revenue (spread back over the waterfall, last tier first) / Cr the customer account. The credit note is e-invoiced like an invoice.
2. **Cancelling a project** is its own step, "Cancel contract": finance first issues a credit note for whatever is refunded, then cancels; the unbilled remainder is cleared (Dr advance sub-account / Cr customer account) with no credit note, because it was never invoiced. Whatever is not refunded stays as revenue (it fills Service first, so a kept deposit lands on the design fee account, as SOP 4.2 wants). Example: contract 100,000, deposit invoice 10,000, refund 6,000 → credit note 6,000, Cancel contract clears 90,000; revenue 4,000, customer owes 0, advance 0.
3. **Contracts signed before 1 Nov 2026:** chew provides, per project, the amount already invoiced in AutoCount. The waterfall treats it as already filled, in order, and later invoices continue from there.
4. **Tax:** no SST for now. The invoice amount is the revenue; the e-invoice tax type is a company setting ("not applicable" by default), and an SST switch is kept for later (exclusive or inclusive, output tax account) without building its postings now.
5. **Existing customer accounts** in AutoCount are already one per project (named with the unit, e.g. "MS CHUAH (DIVO B-16-05)"), so they come across as they are.
6. **Payment before its invoice:** the normal way is to invoice first and collect after. As a fallback, when finance confirms a payment and the project has more received than invoiced, the confirm offers "Bill the next instalment now" (or later).

Still for chew's accountant: the e-invoice classification code for renovation work.

## 8. Calls made in writing this design (check them)

- Receivables ageing, customer statements and "outstanding" count billed-and-unpaid invoices only; the unbilled contract is shown separately (SOP 4.2.1 already said ageing follows the invoices).
- Completion % for the dashboard uses expected total cost = the order lines' budget cost plus VOs, kept simple; the fuller SOP 4.2.1 process (HOD alerts, 99% cap) can come later.
- The waterfall gives back from the last tier when a credit note or a VO lowers a tier already invoiced.
- Renovation orders do not use the furniture deposit-invoice switch; their deposit is the first progress invoice.
