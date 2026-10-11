-- Maintenance job templates and the technician's phone app (owner, 10 Oct 2026). Every change is additive.
--
--   maintenance_templates           a repair staff report again and again ("Aircon not cold", "Leaking tap"): what a new
--                                   job starts with. Everything it fills stays editable on the job.
--                                   assignee_kind / technician_id / contractor_name   who usually does it: an in-house
--                                   technician (an account) or a contractor (a name; contractors are not accounts)
--                                   estimated_cost  sen, NULL when nobody has priced it
--                                   archived_at     set instead of deleting a template a job already used
--   maintenance_template_steps      the template's checklist, in order
--   maintenance_template_parts      the maintenance items (services and parts) it usually needs, with quantities
--   maintenance_checklist_items     one job's checklist: copied from the template when the job is opened (so a later
--                                   edit of the template never rewrites a job in progress), ticked by the technician
--   maintenance_issue_lines         what a job used and costs: an item from the list (sku_id, its name and price copied
--                                   at the time) or an "Other" line (sku_id NULL, typed description and price).
--                                   planned_qty comes from the template; qty is what was used and is charged.
--                                   The job's cost is the sum of qty x unit_price (sen).
--   maintenance_skus.kind           service | part: the Parts catalog becomes "Maintenance items", codes the owner
--                                   sets up in advance (e.g. MT-AC-SVC Aircon service) for staff to pick
--   maintenance_issues.cancelled_at a job called off: closed with no cost, its unit expense taken back
--   maintenance_issues.assignee_id  the in-house technician's ACCOUNT. vendor_name keeps the name shown; a contractor
--                                   has a name and no account. The field app and a technician's repair history match
--                                   on this id, never on the name.
--   maintenance_issues.template_id  the template the job was opened from
--   maintenance_issues.done_note    what the technician wrote when marking the work done
--
-- Existing jobs: assignee_id is filled where the name on the job is exactly one active technician's name (once,
-- here); any other name stays a contractor name.
-- The 12 starter templates are editable data; no prices and no parts are invented (the catalog is empty today).
--
-- REVERSAL:
--   ALTER TABLE maintenance_issues DROP COLUMN assignee_id, DROP COLUMN template_id, DROP COLUMN done_note, DROP COLUMN cancelled_at;
--   ALTER TABLE maintenance_skus DROP COLUMN kind;
--   DROP TABLE maintenance_issue_lines; DROP TABLE maintenance_checklist_items;
--   DROP TABLE maintenance_template_parts; DROP TABLE maintenance_template_steps; DROP TABLE maintenance_templates;
set local search_path = pos;

CREATE TABLE maintenance_templates (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  category        TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('plumbing','electrical','aircon','furniture','appliance','other')),
  urgency         TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal','urgent')),
  assignee_kind   TEXT CHECK (assignee_kind IS NULL OR assignee_kind IN ('in_house','contractor')),
  technician_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  contractor_name TEXT CHECK (contractor_name IS NULL OR length(contractor_name) <= 80),
  estimated_cost  INTEGER CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
  blocks_unit     INTEGER NOT NULL DEFAULT 0 CHECK (blocks_unit IN (0, 1)),
  instructions    TEXT CHECK (instructions IS NULL OR length(instructions) <= 1000),
  archived_at     TEXT,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX maintenance_templates_name_uq ON maintenance_templates(lower(btrim(name))) WHERE archived_at IS NULL;

CREATE TABLE maintenance_template_steps (
  id          TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES maintenance_templates(id) ON DELETE CASCADE,
  label       TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 160),
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX maintenance_template_steps_template ON maintenance_template_steps(template_id, sort_order);

CREATE TABLE maintenance_template_parts (
  template_id TEXT NOT NULL REFERENCES maintenance_templates(id) ON DELETE CASCADE,
  sku_id      TEXT NOT NULL REFERENCES maintenance_skus(id) ON DELETE CASCADE,
  qty         INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 999),
  PRIMARY KEY (template_id, sku_id)
);

ALTER TABLE maintenance_issues ADD COLUMN assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE maintenance_issues ADD COLUMN template_id TEXT REFERENCES maintenance_templates(id) ON DELETE SET NULL;
ALTER TABLE maintenance_issues ADD COLUMN done_note   TEXT;
ALTER TABLE maintenance_issues ADD COLUMN cancelled_at TEXT;
ALTER TABLE maintenance_skus ADD COLUMN kind TEXT NOT NULL DEFAULT 'service' CHECK (kind IN ('service','part'));
UPDATE maintenance_skus SET kind = 'part' WHERE track_stock = 1;
CREATE INDEX maintenance_issues_assignee ON maintenance_issues(assignee_id) WHERE assignee_id IS NOT NULL;

CREATE TABLE maintenance_checklist_items (
  id          TEXT PRIMARY KEY,
  issue_id    TEXT NOT NULL REFERENCES maintenance_issues(id) ON DELETE CASCADE,
  -- 't-<n>' for a step copied from the template, 'c-<uuid>' for one added by hand.
  item_key    TEXT NOT NULL,
  label       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  done_at     TEXT,
  done_by     TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL,
  UNIQUE (issue_id, item_key)
);
CREATE INDEX maintenance_checklist_items_issue ON maintenance_checklist_items(issue_id);

CREATE TABLE maintenance_issue_lines (
  id          TEXT PRIMARY KEY,
  issue_id    TEXT NOT NULL REFERENCES maintenance_issues(id) ON DELETE CASCADE,
  sku_id      TEXT REFERENCES maintenance_skus(id) ON DELETE RESTRICT,
  description TEXT NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 160),
  uom         TEXT NOT NULL DEFAULT 'job',
  unit_price  INTEGER NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  planned_qty INTEGER NOT NULL DEFAULT 0 CHECK (planned_qty BETWEEN 0 AND 999),
  qty         INTEGER NOT NULL DEFAULT 0 CHECK (qty BETWEEN 0 AND 999),
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX maintenance_issue_lines_issue ON maintenance_issue_lines(issue_id);
CREATE UNIQUE INDEX maintenance_issue_lines_item_uq ON maintenance_issue_lines(issue_id, sku_id) WHERE sku_id IS NOT NULL;
-- One maintenance expense per job, so posting the cost again (a re-close, an edited cost) moves it, never doubles it.
CREATE UNIQUE INDEX expenses_one_per_maintenance_job ON expenses(maintenance_id) WHERE maintenance_id IS NOT NULL AND category = 'maintenance' AND parent_expense_id IS NULL;

ALTER TABLE maintenance_templates OWNER TO pos_app;
ALTER TABLE maintenance_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_template_steps OWNER TO pos_app;
ALTER TABLE maintenance_template_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_template_parts OWNER TO pos_app;
ALTER TABLE maintenance_template_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_checklist_items OWNER TO pos_app;
ALTER TABLE maintenance_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_issue_lines OWNER TO pos_app;
ALTER TABLE maintenance_issue_lines ENABLE ROW LEVEL SECURITY;

-- Existing jobs whose name is exactly one active technician's: link the account.
UPDATE maintenance_issues m SET assignee_id = t.id
FROM (SELECT min(id) AS id, lower(btrim(full_name)) AS name FROM users WHERE role = 'technician' AND is_active = 1
      GROUP BY lower(btrim(full_name)) HAVING count(*) = 1) t
WHERE m.assignee_id IS NULL AND m.vendor_name IS NOT NULL AND lower(btrim(m.vendor_name)) = t.name;

-- The 12 starter templates.
INSERT INTO maintenance_templates (id, name, category, urgency, assignee_kind, instructions, created_at, updated_at) VALUES
  ('mtpl-aircon-service',  'Aircon service',                       'aircon',     'normal', 'contractor', 'Routine service. Book between guests; it takes about an hour per unit.', '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z'),
  ('mtpl-aircon-not-cold', 'Aircon not cold',                      'aircon',     'urgent', 'in_house',   'Check the remote and the filter first. Call the aircon contractor if it is still not cold.', '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z'),
  ('mtpl-leaking-tap',     'Leaking tap',                          'plumbing',   'normal', 'in_house',   'Turn off the water under the sink before opening the tap.', '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z'),
  ('mtpl-blocked-drain',   'Blocked sink / toilet',                'plumbing',   'urgent', 'in_house',   'Wear gloves. Do not use drain chemicals in the toilet.', '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z'),
  ('mtpl-water-heater',    'Water heater not working',             'electrical', 'urgent', 'in_house',   'Switch off the heater at the board before touching it.', '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z'),
  ('mtpl-light-socket',    'Lightbulb / socket',                   'electrical', 'normal', 'in_house',   'Switch off the circuit at the board before changing a socket.', '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z'),
  ('mtpl-door-lock',       'Door lock / access card',              'other',      'urgent', 'in_house',   'Guests may be locked out: go first. Never leave the door unlocked.', '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z'),
  ('mtpl-wifi-down',       'Wi-Fi down',                           'electrical', 'urgent', 'in_house',   'Restart the router first. Call the internet provider if the line is down.', '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z'),
  ('mtpl-furniture',       'Furniture repair',                     'furniture',  'normal', 'in_house',   NULL, '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z'),
  ('mtpl-appliance',       'Appliance repair (fridge/washer/TV)',  'appliance',  'normal', 'in_house',   'Check the warranty card before calling a contractor.', '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z'),
  ('mtpl-pest-control',    'Pest control',                         'other',      'urgent', 'contractor', 'The unit stays off sale until the treatment has aired out.', '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z'),
  ('mtpl-wall-paint',      'Wall touch-up / paint',                'other',      'normal', 'in_house',   'Use the paint code on record for the unit. Let it dry before the next guest.', '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z');

INSERT INTO maintenance_template_steps (id, template_id, label, sort_order)
SELECT s.template_id || '-' || s.n, s.template_id, s.label, s.n FROM (VALUES
  ('mtpl-aircon-service', 1, 'Photo of each indoor unit before'),
  ('mtpl-aircon-service', 2, 'Clean the filters and the coil'),
  ('mtpl-aircon-service', 3, 'Flush the drain pipe'),
  ('mtpl-aircon-service', 4, 'Check the outdoor unit'),
  ('mtpl-aircon-service', 5, 'Run each aircon 10 minutes and check it is cold'),
  ('mtpl-aircon-service', 6, 'Wipe up and photo after'),
  ('mtpl-aircon-not-cold', 1, 'Check the remote batteries and the mode'),
  ('mtpl-aircon-not-cold', 2, 'Clean the filter'),
  ('mtpl-aircon-not-cold', 3, 'Check the outdoor unit is running'),
  ('mtpl-aircon-not-cold', 4, 'Measure the air temperature at the vent'),
  ('mtpl-aircon-not-cold', 5, 'Call the contractor if it needs gas or a part'),
  ('mtpl-leaking-tap', 1, 'Turn off the water supply'),
  ('mtpl-leaking-tap', 2, 'Replace the washer or the cartridge'),
  ('mtpl-leaking-tap', 3, 'Turn the water on and check for drips'),
  ('mtpl-leaking-tap', 4, 'Dry the area and photo after'),
  ('mtpl-blocked-drain', 1, 'Photo before'),
  ('mtpl-blocked-drain', 2, 'Plunge or snake the drain'),
  ('mtpl-blocked-drain', 3, 'Clear the trap'),
  ('mtpl-blocked-drain', 4, 'Run water or flush three times to test'),
  ('mtpl-blocked-drain', 5, 'Clean and disinfect the area'),
  ('mtpl-water-heater', 1, 'Check the breaker and the heater switch'),
  ('mtpl-water-heater', 2, 'Check the heater light comes on'),
  ('mtpl-water-heater', 3, 'Run the hot water for 2 minutes'),
  ('mtpl-water-heater', 4, 'Call the contractor if the heater needs replacing'),
  ('mtpl-light-socket', 1, 'Switch off the circuit'),
  ('mtpl-light-socket', 2, 'Replace the bulb, the switch or the socket'),
  ('mtpl-light-socket', 3, 'Switch on and test'),
  ('mtpl-door-lock', 1, 'Test the lock with the card or the code'),
  ('mtpl-door-lock', 2, 'Replace the lock batteries'),
  ('mtpl-door-lock', 3, 'Re-pair or reprogram the card or the code'),
  ('mtpl-door-lock', 4, 'Tell the office if the access code changed'),
  ('mtpl-wifi-down', 1, 'Restart the router'),
  ('mtpl-wifi-down', 2, 'Check the cables and the lights on the router'),
  ('mtpl-wifi-down', 3, 'Run a speed test on the phone'),
  ('mtpl-wifi-down', 4, 'Call the internet provider if the line is down'),
  ('mtpl-furniture', 1, 'Photo before'),
  ('mtpl-furniture', 2, 'Tighten, glue or replace the broken part'),
  ('mtpl-furniture', 3, 'Check it is safe to use'),
  ('mtpl-furniture', 4, 'Photo after'),
  ('mtpl-appliance', 1, 'Note the brand and the model'),
  ('mtpl-appliance', 2, 'Check the power and the plug'),
  ('mtpl-appliance', 3, 'Try a reset'),
  ('mtpl-appliance', 4, 'Photo of the fault or the error code'),
  ('mtpl-appliance', 5, 'Call the contractor or the warranty if it still fails'),
  ('mtpl-pest-control', 1, 'Photo of what was seen'),
  ('mtpl-pest-control', 2, 'Book the pest control contractor'),
  ('mtpl-pest-control', 3, 'Treatment done'),
  ('mtpl-pest-control', 4, 'Air the unit and clean up'),
  ('mtpl-wall-paint', 1, 'Photo before'),
  ('mtpl-wall-paint', 2, 'Fill and sand the marks'),
  ('mtpl-wall-paint', 3, 'Paint'),
  ('mtpl-wall-paint', 4, 'Let it dry and photo after')
) AS s(template_id, n, label);

UPDATE maintenance_templates SET blocks_unit = 1 WHERE id = 'mtpl-pest-control';
