-- REVERSAL: DROP TABLE public_holidays; ALTER TABLE units DROP COLUMN holiday_rate, DROP COLUMN holiday_eve; ALTER TABLE channel_uplifts DROP CONSTRAINT channel_uplifts_mode_check, DROP COLUMN mode, DROP COLUMN percent, DROP COLUMN fixed_base, DROP COLUMN fixed_weekend, DROP COLUMN fixed_holiday; (then DELETE FROM channel_uplifts WHERE uplift IS NULL; ALTER TABLE channel_uplifts ALTER COLUMN uplift SET NOT NULL). The settings row 'hr.public_holidays' is left in place, so HR reads it again once the table is gone.
-- Pricing levels and one public holiday list for the whole company (owner, 2 Nov 2026: "a base price, weekend price,
-- nightly price and public holiday price; store public holidays in Pricing; batch edit; set Booking.com prices").
--
--   public_holidays    the company's one holiday list, kept on Pricing > Public holidays and on HR > Workers > Leave.
--                      state NULL is every state; otherwise a Malaysian state name (functions/_lib/holidays.ts), and a
--                      unit follows the state of its building. staff_day_off: leave and payroll count it (HR reads
--                      only those). Copied once from the old settings list 'hr.public_holidays' (all states, staff day off).
--   units.holiday_rate the unit's direct price on a holiday night; NULL sells holidays at the weekend or nightly price.
--   units.holiday_eve  the night before a holiday is priced as the holiday too (default: only the holiday night).
--   channel_uplifts    a channel's price for a unit is now one of:
--                        mode 'amount'  RM above the direct price (uplift, sen; what every existing row is);
--                        mode 'percent' percent above the direct price (percent);
--                        mode 'fixed'   its own price per level (fixed_base, fixed_weekend, fixed_holiday, sen;
--                                       an empty weekend or holiday falls back to the level below).
--                      uplift becomes nullable for the two new modes.
-- Numbered 0202: 0199 (demo store), 0200 and 0201 (messages and reviews) are the last on main.
-- APPLY: by hand, in one transaction with its public.pos_migrations row (local, then staging, then production).

set local search_path = pos, public;
set local lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public_holidays (
  id             TEXT PRIMARY KEY,
  holiday_date   TEXT NOT NULL CHECK (holiday_date ~ '^\d{4}-\d{2}-\d{2}$'),
  name           TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  state          TEXT,
  staff_day_off  BOOLEAN NOT NULL DEFAULT true,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
-- One entry per day and state ("every state" counted as one state).
CREATE UNIQUE INDEX IF NOT EXISTS public_holidays_day_state_uq ON public_holidays (holiday_date, COALESCE(state, ''));

ALTER TABLE public_holidays OWNER TO pos_app;
ALTER TABLE public_holidays ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public_holidays TO pos_app;

-- The list HR kept until now, as every-state staff days off. An empty list copies nothing.
INSERT INTO public_holidays (id, holiday_date, name, state, staff_day_off, created_at, updated_at)
SELECT gen_random_uuid()::text, h->>'date', btrim(h->>'name'), NULL, true,
       to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
FROM settings s
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.value::jsonb) = 'array' THEN s.value::jsonb ELSE '[]'::jsonb END) AS h
WHERE s.key = 'hr.public_holidays'
  AND coalesce(h->>'date', '') ~ '^\d{4}-\d{2}-\d{2}$' AND length(btrim(coalesce(h->>'name', ''))) BETWEEN 1 AND 80
ON CONFLICT DO NOTHING;

ALTER TABLE units ADD COLUMN IF NOT EXISTS holiday_rate INTEGER CHECK (holiday_rate IS NULL OR holiday_rate > 0);
ALTER TABLE units ADD COLUMN IF NOT EXISTS holiday_eve BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE channel_uplifts ALTER COLUMN uplift DROP NOT NULL;
ALTER TABLE channel_uplifts ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'amount';
ALTER TABLE channel_uplifts ADD COLUMN IF NOT EXISTS percent NUMERIC(6,2);
ALTER TABLE channel_uplifts ADD COLUMN IF NOT EXISTS fixed_base INTEGER;
ALTER TABLE channel_uplifts ADD COLUMN IF NOT EXISTS fixed_weekend INTEGER;
ALTER TABLE channel_uplifts ADD COLUMN IF NOT EXISTS fixed_holiday INTEGER;
ALTER TABLE channel_uplifts ADD CONSTRAINT channel_uplifts_mode_check CHECK (
  (mode = 'amount'  AND uplift IS NOT NULL) OR
  (mode = 'percent' AND percent IS NOT NULL AND percent BETWEEN 0 AND 300) OR
  (mode = 'fixed'   AND fixed_base > 0 AND (fixed_weekend IS NULL OR fixed_weekend > 0) AND (fixed_holiday IS NULL OR fixed_holiday > 0)));
