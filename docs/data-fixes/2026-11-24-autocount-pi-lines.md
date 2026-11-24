# 24 Nov 2026: AutoCount purchase invoice lines loaded behind the opening bills (production, through the engine API)

chew, 24 Nov 2026: "把可以补的先补". The source is chew's export `PURCHASE INVOICE MAY26 - NOV26.xlsx`, which is
AutoCount's Purchase journal listing from 01/05/2026 to 09/11/2026. It has one row per journal line:

- Ref 1 is the AutoCount PI number.
- Ref 2 is the supplier's invoice number (confirmed by chew).
- Each row also has a project, an account, a description and DR/CR.

Done:

1. Migration 0370 (#1226) was applied through migrate-production.yml with `only=0370`.
2. `POST /api/scm/accounting/opening/autocount-pi-lines` was called in 6 batches of up to 200 PIs, after a dry run.
   - It stored 1,171 PIs (9,851 lines) in `scm.acc_autocount_pi_lines`.
   - These lines post nothing. The PIs are already in the ledger as their ACJ journals.
   - Every PI balanced (DR = CR).
3. The same call linked opening bills by supplier and invoice number (`purchase_invoices.autocount_pi_no`).
   - 61 of the 82 open opening bills were linked, with 0 ambiguous matches.
   - The 3 400-P002 bills, "1 400-P002 <day>", matched Ref 2 "1" on that day.

Not linked: 21 opening bills dated before 01/05/2026, from 10/01/2024 to 22/04/2026. To link them, send AutoCount's
Purchase journal listing from 01/01/2024 to 30/04/2026 through the same endpoint.

## Reversal

```sql
update scm.purchase_invoices set autocount_pi_no = null where autocount_pi_no is not null;
delete from scm.acc_autocount_pi_lines;
```
