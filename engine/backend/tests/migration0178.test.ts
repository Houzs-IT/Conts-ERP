import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

/* Migration 0178 (staff payment requests and petty cash) is applied by hand to production, so its text is checked
   here: every table it promises, the grants the engine's REST client needs, and no DROP in what actually runs. */
const SQL = readFileSync(resolve(__dirname, "../../../migrations-pg/0178_payment_requests_petty_cash.sql"), "utf8").replace(/\r\n/g, "\n");
const body = SQL.split("\n").filter(l => !l.trim().startsWith("--")).join("\n").toLowerCase();

describe("0178_payment_requests_petty_cash", () => {
  const tables = ["petty_cash_floats", "petty_cash_overrides", "staff_receipts", "staff_receipt_lines", "staff_receipt_files",
    "petty_cash_events", "payment_requests", "payment_request_lines", "payment_request_files", "staff_bank_details"];

  test.each(tables)("creates scm.%s and grants it to the REST client", t => {
    expect(body).toContain(`create table scm.${t} (`);
    expect(body).toMatch(/foreach t in array array\[[^\]]*\]/);
    const list = body.match(/foreach t in array array\[([^\]]*)\]/)![1];
    expect(list).toContain(`'${t}'`);
  });

  test("owner, row level security and grants are applied to each table", () => {
    expect(body).toContain("owner to scm_engine");
    expect(body).toContain("enable row level security");
    expect(body).toContain("revoke all on scm.%i from anon, authenticated");
    expect(body).toContain("grant all on scm.%i to service_role, pos_app");
  });

  test("the vouchers learn what they pay, and their lines the unit", () => {
    expect(body).toContain("add column if not exists payment_request_id uuid");
    expect(body).toContain("add column if not exists petty_cash_float_id uuid");
    expect(body).toContain("add column if not exists staff_receipt_id uuid");
    expect(body).toContain("alter table scm.payment_voucher_lines add column if not exists unit_id text");
  });

  test("the views the engine and Property OS read", () => {
    for (const v of ["public.conts_staff", "public.conts_departments", "public.conts_units", "public.conts_maintenance_jobs", "public.conts_employee_bank", "pos.staff_receipt_job_lines"])
      expect(body).toContain(`create or replace view ${v} as`);
    expect(body).toContain("grant select on public.%i to scm_engine, service_role");
    expect(body).toContain("grant select on pos.staff_receipt_job_lines to pos_app");
    // conts_staff keeps 0113's columns first, in order, so existing readers are unchanged.
    expect(body).toMatch(/select u\.id, u\.full_name, u\.email, nullif\(trim\(u\.department\), ''\) as department, nullif\(trim\(u\.position\), ''\) as position,\s+\(u\.is_active = 1\) as active, u\.department_id/);
  });

  test("nothing is dropped and PostgREST reloads", () => {
    expect(body).not.toMatch(/\bdrop\s/);
    expect(body).toContain("notify pgrst, 'reload schema'");
  });
});

describe("0178 guards against paying twice", () => {
  test("one live pay-back voucher per receipt, one draft top-up per float, one repayment per receipt", () => {
    expect(body).toMatch(/create unique index if not exists payment_vouchers_staff_receipt_live on scm\.payment_vouchers \(staff_receipt_id\)\s+where staff_receipt_id is not null and status <> 'cancelled'/);
    expect(body).toMatch(/create unique index if not exists payment_vouchers_float_draft on scm\.payment_vouchers \(petty_cash_float_id\)\s+where petty_cash_float_id is not null and status = 'draft'/);
    expect(body).toContain("create unique index petty_cash_events_repaid on scm.petty_cash_events (receipt_id) where kind = 'repaid'");
    expect(body).toMatch(/create unique index if not exists payment_vouchers_request_draft on scm\.payment_vouchers \(payment_request_id\)\s+where payment_request_id is not null and status = 'draft'/);
    expect(body).toContain('create unique index staff_receipts_replaces on scm.staff_receipts (replaces_id) where replaces_id is not null');
  });
});
