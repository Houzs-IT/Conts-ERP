# APPLIED 25 Nov 2026 — renovation collection before go-live from AutoCount's AR collection list

chew, 25 Nov 2026: "开多少单我不理，先把collection做好先".

Source: AutoCount `Ar Collection.xlsx` (2,234 ORs). Each contract's ORs dated up to 16/11/2026 were added up. chew's
tracker (`DC _ THE CONTS RENO PAYMENT TRACKER (3).xlsx`, as at 16/11) matches the AR list on 161 of 171 rows.

Set through `POST /accounting/renovation-opening/autocount-received` (migration 0379, PR #1286). The dry run was clean
and 15 rows were applied.

| SO | Unit | Before (system) | AutoCount AR to 16/11 | Now |
|---|---|---|---|---|
| TC-SO-2610-006 | THE HIPSTER C10-05 | 9,565.00 | 7,930.00 | 7,930.00 |
| TC-SO-2607-001 | SUNWAY JERNIH B13-06 | 22,682.00 | 23,212.00 | 23,212.00 |
| TC-SO-2607-002 | JERNIH KAJANG A-22-09 | 24,773.98 | 24,843.43 | 24,843.43 |
| TC-SO-2606-002 | SKYLINE PUDU D-41-12 | 50,395.69 | 51,089.97 | 51,089.97 |
| TC-SO-2605-010 | D'CLOVER A-3A-3A | 57,000.90 | 57,145.90 | 57,145.90 |
| TC-SO-2605-006 | MYARA PARK R-08-08 | 25,127.00 | 26,693.00 | 26,530.00 (ERP contract) |
| TC-SO-2605-009 | CARRES JB | 11,620.00 | 15,000.00 | 15,000.00 |
| TC-SO-2605-004 | CITIZEN OKR A-27-07 | 36,671.00 | 37,171.00 | 37,171.00 |
| TC-SO-2605-002 | CARRES PENANG | 6,000.00 | 5,000.00 | 5,000.00 |
| TC-SO-2604-008 | ALIRA SUBANG B-7-10 | 32,081.00 | 29,729.00 | 29,729.00 |
| TC-SO-2603-013 | ASTER HILL A-31-08 | 8,096.40 | 19,781.40 | 19,781.40 |
| TC-SO-2603-001 | KAIA HEIGHT A22-05 | 111,725.00 | 115,135.00 | 115,135.00 |
| TC-SO-2601-003 | FORESTA D-19-05 | 96,399.00 | 103,768.00 | 96,399.00 (ERP contract, 收多不理) |
| TC-SO-2512-002 | CRISTAL SERIN B16-08 | 50,500.00 | 53,981.00 | 50,500.00 (ERP contract) |
| TC-SO-2511-002 | D BRIGHTON A1-22-03 | 109,702.18 | 101,286.00 | 101,286.00 |

The billing view never counts more than the contract. For these three, AutoCount invoiced more than the ERP contract
(VOs not in the ERP), so the figure stops at the ERP contract:
- MYARA PARK R-08-08: AutoCount 28,096 against ERP 26,530.
- FORESTA D-19-05: AutoCount 97,960 against ERP 96,399.
- CRISTAL SERIN B16-08: AutoCount 53,980 against ERP 50,500.

To undo a row, send it again with `receivedSen: null`.

Not changed:
- LEGACY OUG A26-03 and ASTER HILL B-16-15: only the date differs. The totals already match.
- AVA A21-11 and THE HENGE E18-01: handled earlier.
- ARTE MK3-25-06, BANGSAR HILLPARK E49-01 and MAHKOTA NO.6: the customer code does not match AutoCount. These go with the unseeded contracts.
- SKYLINE EMBASSY B-43A-08: OR-004613 (16/11, RM 15,000) is not in the system.
