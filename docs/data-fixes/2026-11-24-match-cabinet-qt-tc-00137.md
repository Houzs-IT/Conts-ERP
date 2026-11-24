# 24 Nov 2026: MATCH CABINET QT-TC-00137 booked twice (production, done through the engine API)

AutoCount's QT-TC-00137 (its PI-002577, 22/10/2026, RM 21,832.25, 400-M002) is the same purchase as the ERP bill
TC-API-2610-014 (supplier ref IV-TC-00137, 16/10/2026, RM 21,792.15, the formal invoice). chew, 24 Nov 2026: "是同一笔，
2万多是正式单". The ERP's copy is kept.

AutoCount had paid half of it ahead, HPV-2610-341 (22/10/2026, RM 10,916.13, from 310-0010). That payment is real and
stays in the ledger; it now settles the ERP bill.

Done, in order:

1. `POST /api/scm/accounting/opening/autocount-journals/reverse` with `docNos: ["PI-002577"]`. The ACJ journal is
   reversed on its own day, 22/10/2026.
2. `POST /api/scm/accounting/opening/payables` with one row, `HPV-2610-341`, 400-M002, 2026-10-22, outstanding
   -1091613. This creates the opening voucher OB-HPV-2610-341, which posts nothing, and its supplier advance of
   RM 10,916.13.
3. `POST /api/scm/payment-vouchers/06386a84-44c9-409e-bcc9-e9b884df5292/apply-advance`. This applies RM 10,916.13 to
   the AP invoice 241f5587-0cfa-406b-a7ba-c6cc728ae777 (TC-API-2610-014).

Result:

- TC-API-2610-014 now shows paid 10,916.13 and outstanding 10,876.02.
- The opening check shows a difference of 0 on 400-0000. It was 10,916.12 before step 1.

## Reversal

1. Remove the allocation of OB-HPV-2610-341 from TC-API-2610-014.
2. Delete the voucher OB-HPV-2610-341 and its `acc_supplier_advances` row.
3. Post PI-002577 again through `/opening/autocount-journals`.

## Still open

ERP TC-API-2609-001 (IV-TC-00131, RM 30,934.75) and AutoCount QT-TC-00127 (PI-002558, RM 30,934.75, half paid by
HPV-2610-306) have the same amount and may be the same purchase. This is waiting for chew to confirm.
