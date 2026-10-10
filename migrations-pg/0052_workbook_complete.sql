-- Homes for the parts of the owner workbook the first HostPlatform import had to leave out.
-- Every change is additive: new nullable/defaulted columns and new tables. The one constraint
-- that changes (units.package) only widens: every value it allowed before is still allowed.
--
--   units.package          also allows 'Package D' (38 units in Unit资料 are on it)
--   owner_contracts        agent share, Package D monthly minimum + its annual figure and dates,
--                          the agreement file name, whether miscellaneous charges apply
--   unit_utility_accounts  electricity / water / internet / sewerage account numbers per unit
--   owner_adjustments      money for or against an owner outside bookings and expenses: credits back
--                          to the owner (negative 杂费扣款 lines) and debt carried over (DEBT AMOUNT).
--                          Statement generation picks up the open ones (functions/api/statements/generate.ts)
--   reservations           the parts of a booking's money (room, cleaning fee, taxes, payout ...)
--   owners                 ids that embedded an IC number, passport number or name are re-keyed to opaque ids
--                          (data step at the end; references follow)
--   guarantee_pool_months  the Package D guarantee pool per unit and month (水池 sheet, three month tables)
--   owner_statements.source, payouts.source   'owner_workbook' marks the paid history imported from
--                          the OWNER PAYOUT sheet, so it is never mistaken for a generated statement
--
-- REVERSAL (the owner re-key is not reversed: the old ids were the leak):
--   DROP TABLE guarantee_pool_months; DROP TABLE owner_adjustments; DROP TABLE unit_utility_accounts;
--   ALTER TABLE reservations DROP COLUMN room_revenue, DROP COLUMN guest_cleaning_fee, DROP COLUMN extra_fees, DROP COLUMN sst_amount,
--     DROP COLUMN tourism_tax, DROP COLUMN ota_tax, DROP COLUMN payment_processing_fee, DROP COLUMN deposit_collected, DROP COLUMN deposit_refunded,
--     DROP COLUMN payout_amount, DROP COLUMN payout_date, DROP COLUMN payment_method, DROP COLUMN rate_plan, DROP COLUMN guest_nationality;
--   ALTER TABLE payouts DROP COLUMN source; ALTER TABLE owner_statements DROP COLUMN source;
--   ALTER TABLE owner_contracts DROP COLUMN agent_fee_pct, DROP COLUMN minimum_guarantee, DROP COLUMN minimum_guarantee_annual,
--     DROP COLUMN guarantee_starts_on, DROP COLUMN guarantee_ends_on, DROP COLUMN agreement_file, DROP COLUMN misc_charges;
--   UPDATE units SET package = 'Package C' WHERE package = 'Package D';
--   ALTER TABLE units DROP CONSTRAINT units_package_check;
--   ALTER TABLE units ADD CONSTRAINT units_package_check CHECK (package IN ('Package A','Package B','Package C'));
set local search_path = pos;

ALTER TABLE units DROP CONSTRAINT IF EXISTS units_package_check;
ALTER TABLE units ADD CONSTRAINT units_package_check CHECK (package IN ('Package A','Package B','Package C','Package D'));

-- management_fee_pct stays the whole share taken from the owner (100 - owner %); agent_fee_pct is the part of
-- it that goes to the agent who brought the unit in (分成 AGENT%). NULL = no agent / not known.
ALTER TABLE owner_contracts ADD COLUMN agent_fee_pct DOUBLE PRECISION CHECK (agent_fee_pct IS NULL OR agent_fee_pct BETWEEN 0 AND 100);
-- Package D: a profit share with a floor. The owner gets at least this much a month (sen), from the date the
-- guarantee starts. grr_amount stays the fixed rent of a 'grr' contract only.
ALTER TABLE owner_contracts ADD COLUMN minimum_guarantee        INTEGER NOT NULL DEFAULT 0 CHECK (minimum_guarantee >= 0);
ALTER TABLE owner_contracts ADD COLUMN minimum_guarantee_annual INTEGER CHECK (minimum_guarantee_annual IS NULL OR minimum_guarantee_annual >= 0);
ALTER TABLE owner_contracts ADD COLUMN guarantee_starts_on      TEXT;
ALTER TABLE owner_contracts ADD COLUMN guarantee_ends_on        TEXT;
-- The signed agreement's file name as the workbook records it ('... Service Agreement.pdf').
ALTER TABLE owner_contracts ADD COLUMN agreement_file TEXT;
-- Whether miscellaneous charges are deducted from this owner (Unit资料 'Miscellaneous Charges').
ALTER TABLE owner_contracts ADD COLUMN misc_charges INTEGER NOT NULL DEFAULT 0;

CREATE TABLE unit_utility_accounts (
  id         TEXT PRIMARY KEY,
  unit_id    TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('electricity','water','internet','sewerage','gas')),
  account_no TEXT NOT NULL,
  provider   TEXT,
  note       TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX unit_utility_accounts_unit_idx ON unit_utility_accounts(unit_id);

-- amount is signed sen, the same way as a statement adjustment line: positive adds to the owner's payout,
-- negative deducts. 'open' rows are put on the next statement generated for a period ending on or after
-- occurred_on (statement_id then points at it); 'held' rows wait for someone to release them; 'settled'
-- rows were paid outside Property OS (settled_note says where).
CREATE TABLE owner_adjustments (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES owners(id),
  unit_id      TEXT REFERENCES units(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('credit','charge','opening_debt')),
  amount       INTEGER NOT NULL CHECK (amount <> 0),
  description  TEXT NOT NULL,
  occurred_on  TEXT NOT NULL,
  reference    TEXT,
  state        TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','held','settled')),
  statement_id TEXT REFERENCES owner_statements(id) ON DELETE SET NULL,
  settled_note TEXT,
  source       TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','owner_workbook')),
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX owner_adjustments_owner_idx ON owner_adjustments(owner_id, state, occurred_on);
CREATE INDEX owner_adjustments_statement_idx ON owner_adjustments(statement_id);

-- Package D guarantee pool, one row per unit and month, sen. pool_balance is the month-end balance (can be
-- negative); paid_from_pool is what the pool paid the owner to reach the minimum; company_top_up is what the
-- company added when the pool was not enough.
CREATE TABLE guarantee_pool_months (
  id             TEXT PRIMARY KEY,
  unit_id        TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  month          TEXT NOT NULL,
  pool_balance   INTEGER,
  paid_from_pool INTEGER,
  company_top_up INTEGER,
  source         TEXT NOT NULL DEFAULT 'owner_workbook',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (unit_id, month)
);

-- What a booking's money is made of, sen, NULL = not known (the source did not say). gross_booking_value,
-- channel_fee and collected_revenue keep their meaning; these break them down.
--   room_revenue            room charge for the whole stay (HostPlatform 'Room Rate' is already the stay total:
--                           Average Price per Night x nights = Room Rate on every row)
--   guest_cleaning_fee      cleaning fee the guest paid (HP 'Cleaning Fee'; Airbnb earnings 清洁费)
--   extra_fees              extra guest, early check-in, late check-out, shuttle, transport, meals, other, add-ons, service fee
--   sst_amount              Sales & Service Tax charged on the booking (HP 'Sales Service Tax' + 'Sales Tax')
--   tourism_tax             HP 'Tourism Tax' + 'Heritage Tax'
--   ota_tax                 tax the booking site charged and remits itself (HP 'OTA Tax'; Airbnb earnings 税费)
--   payment_processing_fee  Airbnb fast-pay fee (快速支付费)
--   deposit_collected, deposit_refunded   security deposit
--   payout_amount           what the booking site paid the host (Airbnb earnings 金额(Amount))
--   payout_date             when it was paid out (TEXT date; the workbook's 已支付 column holds no dates yet)
--   payment_method, rate_plan, guest_nationality   TEXT as the source wrote them
ALTER TABLE reservations ADD COLUMN room_revenue           INTEGER;
ALTER TABLE reservations ADD COLUMN guest_cleaning_fee     INTEGER;
ALTER TABLE reservations ADD COLUMN extra_fees             INTEGER;
ALTER TABLE reservations ADD COLUMN sst_amount             INTEGER;
ALTER TABLE reservations ADD COLUMN tourism_tax            INTEGER;
ALTER TABLE reservations ADD COLUMN ota_tax                INTEGER;
ALTER TABLE reservations ADD COLUMN payment_processing_fee INTEGER;
ALTER TABLE reservations ADD COLUMN deposit_collected      INTEGER;
ALTER TABLE reservations ADD COLUMN deposit_refunded       INTEGER;
ALTER TABLE reservations ADD COLUMN payout_amount          INTEGER;
ALTER TABLE reservations ADD COLUMN payout_date            TEXT;
ALTER TABLE reservations ADD COLUMN payment_method         TEXT;
ALTER TABLE reservations ADD COLUMN rate_plan              TEXT;
ALTER TABLE reservations ADD COLUMN guest_nationality      TEXT;

ALTER TABLE owner_statements ADD COLUMN source TEXT NOT NULL DEFAULT 'generated' CHECK (source IN ('generated','owner_workbook'));
ALTER TABLE payouts          ADD COLUMN source TEXT NOT NULL DEFAULT 'generated' CHECK (source IN ('generated','owner_workbook'));

-- REKEY-BEGIN
-- Owner ids the import made before this migration embedded personal data: 'wb-owner-<IC number>' (or passport
-- number, or name) and 'hp-owner-<name>'. Each such owner moves to the opaque id the import now makes
-- (functions/_lib/hostplatformImport.ts, opaqueOwnerId): prefix + first 16 hex of sha256('conts-owner:' + key),
-- key = IC with only letters and digits, lower-cased (workbook owners with an IC), else the name with whitespace
-- runs made one space, trimmed, lower-cased. Steps per owner: copy the row under the new id, point every foreign
-- key at owners(id) to it (found from the catalogue, so a table added later is not missed), move audit_log and
-- notification_log references and the id inside their recorded before/after text, delete the old row, then give
-- the copy its portal login back (user_id is unique, so the copy starts without it). Rows already on an opaque id
-- are skipped, so running this block again changes nothing. The placeholder owner keeps its id.
do $$
declare
  r record; fk record; nid text; k text; moved int := 0;
begin
  for r in
    select * from pos.owners
    where (id like 'wb-owner-%' or id like 'hp-owner-%') and id <> 'hp-owner-to-be-confirmed'
      and id !~ '^(wb|hp)-owner-[0-9a-f]{16}$'
  loop
    k := lower(regexp_replace(coalesce(r.ic_number, ''), '[^A-Za-z0-9]', '', 'g'));
    if r.id like 'hp-owner-%' or k = '' then
      k := lower(btrim(regexp_replace(coalesce(r.display_name, ''), '[ \t\r\n]+', ' ', 'g')));
    end if;
    nid := substr(r.id, 1, 9) || substr(encode(sha256(convert_to('conts-owner:' || k, 'UTF8')), 'hex'), 1, 16);
    if nid = r.id then continue; end if;
    if not exists (select 1 from pos.owners where id = nid) then
      insert into pos.owners select (jsonb_populate_record(null::pos.owners, to_jsonb(r) || jsonb_build_object('id', nid, 'user_id', null))).*;
    end if;
    for fk in
      select c.conrelid::regclass as tbl, a.attname as col
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and c.confrelid = 'pos.owners'::regclass
    loop
      execute format('update %s set %I = $1 where %I = $2', fk.tbl, fk.col, fk.col) using nid, r.id;
    end loop;
    update pos.audit_log set entity_id = nid where entity_table = 'owners' and entity_id = r.id;
    update pos.audit_log set before_state = replace(before_state, r.id, nid), after_state = replace(after_state, r.id, nid)
      where before_state like '%' || r.id || '%' or after_state like '%' || r.id || '%';
    update pos.notification_log set entity_id = nid where entity_table = 'owners' and entity_id = r.id;
    delete from pos.owners where id = r.id;
    if r.user_id is not null then update pos.owners set user_id = r.user_id where id = nid and user_id is null; end if;
    moved := moved + 1;
  end loop;
  raise notice 'owners re-keyed to opaque ids: %', moved;
end $$;
-- REKEY-END

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
