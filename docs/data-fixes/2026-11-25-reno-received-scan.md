# 25 Nov 2026: renovation contracts scanned for "received" that differs from AutoCount

chew, 25 Nov 2026: "同时检查有没有类似这样的问题", then "你自己看". After the ZI HENG and MS LEE fixes
(0373, 2026-11-25-ms-lee-301-m001-merged.md), all 143 renovation contracts were compared with AutoCount's documents at
the cut-over (opening-2026-08-31/9-documents-at-16.11.2026.xlsx and 4-knock-off-list-31.08.2026.xlsx) and with
chew's payment tracker.

The scan looked for two kinds of problem:

- **(A) A credit note counted as money received.** The customer's CNs on their contract invoices were checked.
- **(B) Money sitting on another customer code.** Opening credits were checked against contracts of the same name
  under a different code.

| Contract | Finding | Done |
|---|---|---|
| TC-SO-2605-007 MR ZI HENG | (A) CN-000077 RM 1,740.60 was a discount, but it read as received | 0373 |
| TC-SO-2509-002 MS LEE | (B) RM 712 (OR-002970) sat on 301-M001 | Codes merged; paid ahead now counts (#1260, #1261) |
| TC-SO-2512-001 MS CHEW | The seed carried RM 35,547 where AutoCount billed RM 42,606 and was paid RM 39,846.80 | 0374 |
| TC-SO-2605-008 MS VALERIE | (A) CN-000069 RM 2,994.40 | None: received RM 48,930.20 is the tracker's; nothing owed |
| TC-SO-2604-007 MS MICHELL | (A) CN-000081 RM 2,309 (30/09) | None: received RM 36,945 and owed RM 22,668.95 are the tracker's |
| TC-SO-2604-003 MS YEE BAU LING | (A) CN-000064 RM 6,147.45 | None: received RM 47,888.24 is the tracker's |
| TC-SO-2604-006 MR STEVEN (SRI KESIDANG) | (B) RM 2,200 on 301-M002 | None. The credit is for DAMAI HILLPARK A17-02 (301-M240), which is paid in full, so the RM 2,200 is overpaid (收多不理). SRI KESIDANG still owes RM 2,125 (I-2607-076), as AutoCount says |
| SKYLINE KL A-47-10 MS TAN SZE YAN | (B) RM 8,770 on 301-M034 | Waiting: this is one of the 16 contracts not yet seeded; count it when seeded |
| TC-SO-2604-001 MS NATALIE | The RM 1,560 credit is the ERP's own VO lowering the contract | None: she owes RM 1,335.26 on the lowered contract |

After the fixes, all 143 contracts were read again. Only ZI HENG, MS LEE and (after 0374) MS CHEW changed.
