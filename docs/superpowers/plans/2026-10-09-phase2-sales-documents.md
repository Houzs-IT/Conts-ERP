# Phase 2 (Sales documents) implementation plan

Spec section 4. Names fixed by `2026-10-09-integration-contract.md` (wins on conflict).
Layout target: the owner's PDFs (AVA Residence, D'Clover, Skyline Type A/B, KL 48).

## Findings
- Sample layout: brand logo + title, rule, 5-line company block (phone/email per brand), Attention/To + LAST AMEND left, Prepared By/Building/Unit/Date right, italic intro, section colour bands (some none), numbering restarts per section, unnumbered child lines with own qty/amount, dimension lines, highlighted rows (grey / pink waived), qty column prints measure ("20FT", "42.6FT", "LS", "1 SET", "FULL UNIT"), lump-sum section with unpriced room lines, footer bank line + 4 terms lines, TOTAL box per page; last page GRAND TOTAL / TOTAL -> DISCOUNT -> FINAL TOTAL, promo bands, PAYMENT TERMS box, two signature blocks.
- Format 1 (AVA): Unit Price header printed, column empty; page totals; GRAND TOTAL.
- Format 3 (D'Clover): DISC PRICE (discounted unit) + `-40%`, Amount = list amount; small discounted subtotal above list TOTAL per page; wiring pages switch to UNIT PRICE.
- Format 4 (Skyline): totals blank except last page package total. Format 5 (KL 48): Promotion + Standard columns.
- `scm.mfg_sales_order_items` has 96 backend readers; `qty` integer; `item_code`/`item_group` not null.
- Allocator and MRP pull every non-terminal SO (`so-stock-allocation.ts:276-284,492,733`, `mrp.ts:123,638-662`) via `so-terminal-states.ts:42`; delivery sync can move CONFIRMED -> DELIVERED (`so-delivery-sync.ts:187,217`).
- `applySoAmendment` (`so-revision.ts:317`) reprices every line with furniture pricing: not usable for VO apply. Reusable: `snapshotSo` (:194), `readSoLineFreeze`/`soLineWriteRefusal` (`downstream-lock.ts:210,277`), `recordSoAudit`.
- `convertSosToPosCore` (`mfg-purchase-orders.ts:1395`) accepts per-pick `supplierId`; grouping `po-grouping.ts:111`.
- `POST /sales-invoices` accepts `soDocNo` without DO; `postSiRevenue` posts via `postJournal`; `si-order-deposit.ts:106,162` spreads SO payments across invoices; credit notes `acc/credit-notes.ts:67,107`. No new journal sources needed.
- `mintMonthlyDocNo` cannot run inside the transaction client: mint before. `runScmPgCommand` for transactions.
- Print: `printDocumentPdf.ts`, `PrintPreviewModal` rows accept a format select; brand logos `project_brands.logo_r2_key` via `ensureBrandLogoLoaded`.

## Decision: side tables
`mfg_sales_order_items` untouched in shape. One SO row per priced line (ITEM/CHILD) with standard columns; invariant `total_sen = qty x unit_price_sen - discount_sen`. Measured line: `qty 1`, `unit_price_sen = amount`, `description2 = "42.6 FT @ RM35.00"`. FOC: discount = list. Waived: negative price on service SKU. Document discount: negative `RENO-DISCOUNT` row. Structure in `scm.reno_doc_lines` linked by `so_item_id`.
SO header: `so_kind` ('STANDARD'|'RENOVATION'). Status values `RENO_CONFIRMED`, `RENO_IN_PROGRESS`, `RENO_COMPLETED` added to `SO_TERMINAL_STATES` so allocator/MRP/delivery sync skip them; generic write routes fenced.

## DB (0065-0074)
- 0065 enum values (own file).
- 0066 brands seed (Dream Crafter, The Conts), `scm.reno_brand_profiles`, customer payment-term templates + lines (seed 30/30/35/5 with D'Clover wording, 15/50/30/5), PO term templates + lines (seed Mobilise 30 / Completion 65 / Retention 5).
- 0067 `scm.reno_quotations`, `scm.reno_quotation_revisions` (print_format AMOUNT/UNIT_PRICE/DISCOUNT/QTY_ONLY/PROMO_STANDARD), `scm.reno_quotation_templates`.
- 0068 `scm.reno_doc_sections` (exactly one owner: template / quotation revision / SO / VO; heading, band colour, lump_sum), `scm.reno_doc_lines` (+ `stage_code`, `amount_override_sen` per contract), `scm.reno_doc_instalments` (+ `trigger`).
- 0069 `so_kind` + `uq_mfg_so_reno_project`, `scm.reno_so_contracts`.
- 0070 `scm.reno_variation_orders`, `scm.reno_po_line_flags`.
- 0071 `scm.reno_instalment_bills`; `acc_item_groups` RENOVATION.
- 0072 `scm.reno_po_instalments`, `scm.reno_po_instalment_payments`.
- 0073 SKUs `RENO-ADJUST`, `RENO-DISCOUNT`, `RENO-PROGRESS`.
- Numbering: `QT-YYMM-NNN`, `-R2`; `VO-<SO>-NN`; SI/CN existing series.

## BE
- `scm/shared/renovation-money.ts` (+ mirror): `parseMeasureMilli`, `lineAmounts`, `soMirrorRow`, `qtyLabel`, `docTotals`, `nextInstalmentAmount` (cumulative %, last row absorbs rounding).
- Libs: `renovation-validate.ts`, `renovation-doc-lines.ts`, `renovation-quotation.ts`, `renovation-so.ts`, `renovation-so-lifecycle.ts`, `renovation-write-fence.ts`, `renovation-vo.ts`, `renovation-po-split.ts`, `renovation-billing.ts`, `renovation-po-schedule.ts`, `renovation-hooks.ts`.
- Router `scm/routes/renovation.ts` at `/api/scm/renovation`: quotations (CRUD, revisions, status, convert, save-as-template), templates, payment terms (customer/PO), brand profiles, renovation SO (summary, cosmetic edits only, status), PO split preview/raise, billing view / instalments / bill, VO CRUD/status/apply, PO schedule/payments/release. Permission keys `scm.renovation.quote|vo.apply|bill|terms|po_split`.
- Write fence on `/mfg-sales-orders/:docNo*` non-GET for RENOVATION (503 when unreadable), payments/hold/photos pass.
- VO apply: `so_amendments` row (amendment_no = VO no, status SENT, resolution RENOVATION_VO), amendment lines, `snapshotSo`, add/omit lines, header rollup with version check, `reno_po_line_flags`, audit, after-commit hook.
- PO split: mode `by-supplier` in `po-grouping.ts`, per-pick `unitCostSen` in `mfg-purchase-orders.ts`; supply-by-owner goods excluded; unbound lines block; default PO schedule.
- Billing: lowest unbilled seq only; stale amount 409; positive -> SI + `postSiRevenue`; negative -> CN on confirm; zero -> closed. Vector: 100k on 15/50/30/5, VO +10k after #2 -> #3 = 39,500, #4 = 5,500; VO -20k after #3 -> #4 = -15,000 CN.
- PO schedule: payable at read time (ON_CONFIRM / ON_RECEIPT / ON_HANDOVER via `projectHandoverState` / MANUAL); PV link checks.

## FE
`pages/renovation/`: `QuotationsList`, `QuotationEditor` (sections, `SectionCard`, `LineRow` desktop / `LineCard` phone, `MeasureInput`, `InstalmentEditor`), `RenovationSalesOrder`, `VariationOrderEditor`, `PaymentTermTemplates`, `QuotationTemplates`, `BrandProfiles`, `PoPaymentScheduleCard` (in `PurchaseOrderDetailV2`). `lib/renovation/`: `api.ts`, `print-formats.ts`, `print-model.ts`, `print-layout.ts`, `renovation-doc-pdf.ts`. Routes in `App.tsx` + `routeManifest.ts`, Sidebar "Quotations", SO detail redirect for renovation, status labels.

## Task order (test-first)
A 1-2 migrations + pg tests; B 3-4 money maths + mirror; C 5-10 engine edits (terminal states + mirror, by-supplier grouping, PO cost override, write fence, detail select, permissions); D 11-19 libs + routes (validate, doc lines, quotation, convert, lifecycle, PO split, VO apply, billing, PO schedule); E 20-26 frontend; F 27-29 print model/layout/pdf with AVA and D'Clover page-total fixtures (AVA 11,418 / 11,830 / 6,057.5 / 10,080 / 6,561 / -40 = 45,906.5; D'Clover p1 net 20,577.71 list 37,215.52, last 137,866.56 / 42,623.42 / 95,243.14); G verification.

## Verification
engine/backend `npm run typecheck && npm test` (+ `npm run test:pg` locally); engine/frontend `npm run typecheck && npm test`; migrations dry-run; browser at 1280x800 and 375x812 through quotation -> R2 -> accept -> convert -> PO split -> bill #1 -> VO +10k -> bill -> negative VO -> CN; print all 5 formats for QT, SO, VO side by side with the sample PDFs.
