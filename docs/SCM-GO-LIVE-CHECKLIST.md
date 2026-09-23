# Supply Chain — go-live checklist

The whole SCM port is a **single linear PR stack**, `#25 → #86` (each PR's base is the
previous PR's branch, `#26` is the docs branch on its own). The tip branch
`feat/scm-delivery-planning` (#86) therefore contains **every** SCM change. Nothing is merged
yet — all PRs are intentionally **HELD**, because on Conts a merge to `main` is an instant prod
deploy (no PR CI), and most PRs carry a migration that must be applied to the prod DB **first**.

## The one blocker (owner's step)

**Apply the migration batch `0006`–`0036` to the production DB, in order, then merge.** This is
the owner's step (it needs the DB password + running the migrations against prod). Until it is
done, nothing should merge — a page whose table does not exist yet would 500 in production.

## Migrations to apply (0006–0036, in order)

| # | file | # | file |
|---|---|---|---|
| 0006 | products | 0022 | fabric |
| 0007 | suppliers | 0023 | consignment_notes |
| 0008 | product_models | 0024 | stock_ops (transfers + takes) |
| 0009 | categories | 0025 | customers |
| 0010 | warehouses | 0026 | grn_do_warehouse |
| 0011 | purchase_orders | 0027 | sales_returns |
| 0012 | goods_receipts | 0028 | threepl_companies |
| 0013 | purchase_invoices | 0029 | driver_leave |
| 0014 | payment_vouchers | 0030 | delivery_zones |
| 0015 | purchase_returns | 0031 | delivery_residence_rules |
| 0016 | purchase_consignment | 0032 | rate_cards |
| 0017 | stock | 0033 | so_amendments |
| 0018 | sales_orders | 0034 | warehouse_racks |
| 0019 | delivery_orders | 0035 | fleet_maintenance |
| 0020 | sales_invoices | 0036 | delivery_schedule |
| 0021 | transport (drivers + vehicles) | | |

Each migration is idempotent-safe in shape (CREATE TABLE + an owner/RLS sweep at the end) and
carries a `-- REVERSAL:` line at the top. They are numbered and must run **in ascending order**.

## Merge — two ways

Because the stack is perfectly linear, you can land it either way:

**A. One-shot (fastest).** Retarget the tip PR **#86** (`feat/scm-delivery-planning`) to `base:
main` and merge it. That single merge lands **all** of `#25`–`#86` at once. Then close the
now-empty intermediate PRs. Do this only **after** the migration batch is applied.

**B. Sequential (one PR at a time).** Merge in this exact order, deleting each head branch after
merge so GitHub auto-retargets the next PR to `main`:

```
#25 #28 #29 #30 #32 #33 #35 #39 #40 #41 #42 #43 #44 #45 #46 #47 #48 #49 #51
#54 #55 #58 #62 #63 #65 #74 #76 #77 #78 #79 #80 #81 #82 #83 #84 #85 #86
```

(`#26` docs merges any time.) No-migration PRs — **#48 #49 #62 #65 #82 #84 #85** — carry no schema
change, but they sit on the stack so they still land in this order.

## What is verified vs untested

- **Every PR:** `tsc -b --force` (clean) + `vite build` (clean) + rendered in the Vite DEV
  preview. The frontend is fully verified.
- **UNTESTED until the migrations are applied + a backend is reachable:** the live DB writes —
  stock ledger postings (GRN/DO/returns), amendment apply, rate-card compute, the delivery
  schedule. These are verified by construction + typecheck only; the DEV preview has no backend.
  First real exercise happens the first time each runs against the migrated prod DB.

## Out of scope (dropped by the owner, 2026-09-23)

HR Commission, Fair Report, Lorry Capacity, and photo/attachment features. Not built.
Everything not in the owner's four nav screenshots is out of scope.

## After go-live

Delete the merged head branches. Turn on **Settings → General → Automatically delete head
branches** so this does not have to be remembered.
