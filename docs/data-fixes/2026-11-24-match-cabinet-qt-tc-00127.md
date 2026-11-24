# 24 Nov 2026: MATCH CABINET QT-TC-00127 booked twice (production, done through the engine API)

AutoCount's QT-TC-00127 (its PI-002558, 19/10/2026, RM 30,934.75, 400-M002) is the same purchase as the ERP bill
TC-API-2609-001 (supplier ref IV-TC-00131, 08/09/2026, RM 30,934.75, the formal invoice). chew confirmed this on
24 Nov 2026: "MATCH CABINET 是同一笔". The ERP's copy is kept. This is the same case as QT-TC-00137
(2026-11-24-match-cabinet-qt-tc-00137.md), with one difference: the half AutoCount still owed had come in as an
opening bill, QT-TC-00127 (RM 15,467.37), so that bill goes too.

AutoCount had paid half of the purchase ahead, by HPV-2610-306 (19/10/2026, RM 15,467.38, from 310-0010). That payment
is real and stays in the ledger. It now settles the ERP bill.

Done, in order:

1. `POST /api/scm/accounting/opening/autocount-journals/reverse` with `docNos: ["PI-002558"]`. This reversed the ACJ
   journal JE-2610-0623 on its own day, 19/10/2026.
2. `PATCH /api/scm/purchase-invoices/e6fe99cd-e8c8-487b-9fd1-d0cf123c738f/cancel`. This cancelled the opening bill
   QT-TC-00127, which had posted nothing, so there was nothing to reverse.
3. `POST /api/scm/accounting/opening/payables` with one row: `HPV-2610-306`, 400-M002, 2026-10-19, outstanding
   -1546738. This created the opening voucher OB-HPV-2610-306 (id 2c494e09-91a1-43d2-bc70-0b1dd7746026), which posts
   nothing, together with its advance.
4. `POST /api/scm/payment-vouchers/2c494e09-91a1-43d2-bc70-0b1dd7746026/apply-advance`. This applied RM 15,467.38 to
   the AP invoice 87920ce4-391f-4c61-900e-6e60cab74d4a (TC-API-2609-001).

Result:

- TC-API-2609-001 shows paid 15,467.38 and outstanding 15,467.37.
- On the opening check, 400-0000 still differs by 0. 301-0000 still differs by -12,972, which is DIVO and is
  ignored by agreement.
- MATCH CABINET's payable is RM 30,934.75 lower than before.

## Reversal

1. Remove the allocation from OB-HPV-2610-306.
2. Delete that voucher and its `acc_supplier_advances` row.
3. Set QT-TC-00127 back to POSTED.
4. Post PI-002558 again through `/opening/autocount-journals`.
