-- 0003 — organisation settings as key/value, so adding a default does not
-- need a migration. Every key is documented in copy.md.

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO settings (key, value, updated_at) VALUES
 ('org.legal_name',            'The Conts Sdn Bhd', '2026-09-18T00:00:00Z'),
 ('org.company_number',        '202301027399 (1521322-V)', '2026-09-18T00:00:00Z'),
 ('org.address',               'C-41-06, Jaya One, Jalan Universiti, 46200 Petaling Jaya', '2026-09-18T00:00:00Z'),
 ('org.support_phone',         '+60 17-465 8868', '2026-09-18T00:00:00Z'),
 ('locale.default',            'en-MY', '2026-09-18T00:00:00Z'),
 ('locale.timezone',           'Asia/Kuala_Lumpur', '2026-09-18T00:00:00Z'),
 ('locale.currency',           'MYR', '2026-09-18T00:00:00Z'),
 ('finance.default_fee_pct',   '25', '2026-09-18T00:00:00Z'),
 ('finance.statement_period',  'Calendar month, finalised on the 1st', '2026-09-18T00:00:00Z'),
 ('ops.check_in',              '15:00', '2026-09-18T00:00:00Z'),
 ('ops.check_out',             '11:00', '2026-09-18T00:00:00Z'),
 ('ops.turnover_sla_hours',    '4', '2026-09-18T00:00:00Z'),
 ('ops.photo_required',        'true', '2026-09-18T00:00:00Z');
