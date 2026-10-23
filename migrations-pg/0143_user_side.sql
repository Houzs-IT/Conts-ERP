-- REVERSAL: alter table pos.users drop constraint users_side_check, drop column side;
-- Which side of the business a staff account works on (owner, 23 Oct 2026: the invite starts with The Conts,
-- Dream Crafter or both). The Conts is the rental side, Dream Crafter the supply chain side.
--
-- * 'both' (the default, and every existing account): the role decides everything, as before.
-- * 'conts': the Dream Crafter areas on Users and roles > Permissions are closed, whatever the role allows.
-- * 'dream_crafter': the rental areas (Workspace, Operations, Growth) are closed. Finance and System follow the role.
-- The side only ever narrows what the role allows. Management ignores it (functions/_lib/access.ts).
--
-- APPLY: by hand, local, then staging, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).
-- The code reads and writes the column only once it exists, so either side may deploy first.

alter table pos.users add column if not exists side text not null default 'both';
alter table pos.users add constraint users_side_check check (side in ('conts', 'dream_crafter', 'both'));
