-- role_access (0049) was created by the admin connection and left with it, so the app's own role could
-- not read or write it. Same hand-over as every other table in pos: owned by pos_app, row level security on.
-- REVERSAL: ALTER TABLE pos.role_access OWNER TO postgres;
set local search_path = pos;

ALTER TABLE role_access OWNER TO pos_app;
ALTER TABLE role_access ENABLE ROW LEVEL SECURITY;
