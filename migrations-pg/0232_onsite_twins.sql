-- REVERSAL: DROP TABLE scm.onsite_twins;
-- On site a receipt and a delivery are one event (owner, 6 Nov 2026). This ties the two documents so each shows the
-- other's photos, and the delivery's proof of delivery reaches the goods receipt.
CREATE TABLE scm.onsite_twins (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id integer NOT NULL,
  grn_id uuid NOT NULL REFERENCES scm.grns(id) ON DELETE CASCADE,
  do_id uuid NOT NULL REFERENCES scm.delivery_orders(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (grn_id, do_id)
);
CREATE INDEX onsite_twins_do ON scm.onsite_twins (do_id);
