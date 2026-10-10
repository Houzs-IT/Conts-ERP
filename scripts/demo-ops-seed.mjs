// Demo data for the Cleaning and Maintenance screens, so the owner can walk the whole flow (assign a building,
// guest left, photos and videos, complete, report damage, repair window, approval, done) on real units.
//
//   node scripts/demo-ops-seed.mjs --db=<postgres url> | --env-file=<file>              list what it would add (changes nothing)
//   node scripts/demo-ops-seed.mjs ... --apply --confirm=<target>                        add it (idempotent: re-running changes nothing)
//   node scripts/demo-ops-seed.mjs ... --remove --apply --confirm=<target>               take every demo row out again
//
// <target> is the Supabase project ref the script prints, or "local" for a database on 127.0.0.1 / localhost.
// Every row it writes is marked: "[Demo]" at the start of the title, and an id starting "demo-ops-". It writes
// cleans for today and tomorrow on units that really have a guest leaving (so the check-out / check-in times are
// real), three repair jobs and one repair window. It never touches bookings, owners or money.
// --remove deletes the demo cleans and jobs and anything hanging off them: their checklist ticks, repair windows,
// uploaded file records, and the expenses that completing them raised. It cannot undo a booking that was moved
// to Checked out by pressing "Guest left" on a demo clean, and files already in storage stay there (unlinked).
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const APPLY = process.argv.includes('--apply');
const REMOVE = process.argv.includes('--remove');
const envFile = arg('env-file');
const vars = envFile ? (() => { try { return readFileSync(envFile, 'utf8'); } catch { return ''; } })() : '';
const url = arg('db') ?? process.env.DATABASE_URL ?? vars.match(/^DATABASE_URL="?([^"\n]+)"?/m)?.[1];
if (!url) { console.error('Pass --db=<postgres url> or --env-file=<file with DATABASE_URL>. Nothing was changed.'); process.exit(1); }
const local = /@(127\.0\.0\.1|localhost)[:/]/.test(url);
const target = local ? 'local' : url.match(/postgres\.([a-z0-9]{20})/)?.[1] ?? url.match(/db\.([a-z0-9]{20})\.supabase/)?.[1];
if (!target) { console.error('Could not tell which database this is (no project ref in the URL). Nothing was changed.'); process.exit(1); }
console.log(`Target database: ${target}${APPLY ? '' : '  (listing only, nothing will be changed)'}`);

const sql = postgres(url, { max: 1, prepare: false, ssl: local ? false : 'require', onnotice: () => {}, connection: { search_path: 'pos' } });
const DEMO = 'demo-ops-%';
const myt = (offset = 0) => new Date(Date.now() + 8 * 3600e3 + offset * 864e5).toISOString().slice(0, 10);
const today = myt(0), tomorrow = myt(1);
const nowIso = new Date().toISOString();

async function counts(db) {
  const [r] = await db`
    select (select count(*)::int from tasks where id like ${DEMO}) as tasks,
           (select count(*)::int from maintenance_issues where id like ${DEMO}) as issues,
           (select count(*)::int from maintenance_windows where id like ${DEMO} or issue_id like ${DEMO}) as windows,
           (select count(*)::int from task_checklist_items where task_id like ${DEMO}) as ticks,
           (select count(*)::int from documents where task_id like ${DEMO} or maintenance_id like ${DEMO}) as files,
           (select count(*)::int from expenses where task_id like ${DEMO} or maintenance_id like ${DEMO}) as expenses`;
  return r;
}

if (REMOVE) {
  const c = await counts(sql);
  console.log('Demo rows now:', c);
  if (!APPLY) { console.log(`\nNothing was changed. To remove them: add  --apply --confirm=${target}`); await sql.end(); process.exit(0); }
  if (arg('confirm') !== target) { console.error(`--confirm must be exactly ${target}. Nothing was changed.`); await sql.end(); process.exit(1); }
  await sql.begin(async (tx) => {
    await tx`delete from expenses where task_id like ${DEMO} or maintenance_id like ${DEMO}`;
    await tx`delete from documents where task_id like ${DEMO} or maintenance_id like ${DEMO}`;
    // Damage reported from a demo clean became a job of its own: it goes too.
    await tx`delete from expenses where maintenance_id in (select id from maintenance_issues where source_task_id like ${DEMO})`;
    await tx`delete from documents where maintenance_id in (select id from maintenance_issues where source_task_id like ${DEMO})`;
    await tx`delete from maintenance_issues where id like ${DEMO} or source_task_id like ${DEMO}`;
    await tx`delete from tasks where id like ${DEMO}`;
    await tx`insert into audit_log (actor_id, actor_label, action, entity_table, entity_id, after_state, source, occurred_at)
             values (null, 'demo-ops-seed', 'demo.remove', 'tasks', 'demo-ops', ${JSON.stringify(c)}, 'script', ${nowIso})`;
  });
  console.log('Removed. Now:', await counts(sql));
  await sql.end(); process.exit(0);
}

// Guests really leaving today and tomorrow, at most one per unit, spread over buildings.
const leaving = await sql`
  select r.id, r.unit_id, r.check_out, coalesce(nullif(r.check_out_time, ''), '11:00') as out_time, u.unit_number, p.id as building, p.name as building_name,
         (select coalesce(nullif(n.check_in_time, ''), '15:00') from reservations n where n.unit_id = r.unit_id and n.check_in = r.check_out and n.id <> r.id
            and n.state not in ('cancelled','no_show','inquiry') and n.channel <> 'maintenance_block' limit 1) as next_in
  from reservations r join units u on u.id = r.unit_id join properties p on p.id = u.property_id
  where r.check_out in (${today}, ${tomorrow}) and r.state not in ('cancelled','no_show','inquiry') and r.channel not in ('maintenance_block','owner_stay')
    and not exists (select 1 from tasks t where t.unit_id = r.unit_id and t.kind in ('turnover','deep_clean','light_clean') and t.id not like ${DEMO}
      and to_char((coalesce(t.scheduled_for, t.due_at, t.created_at))::timestamptz at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM-DD') = r.check_out)
  order by r.check_out, p.name, u.unit_number`;
const pickDay = (day, n) => {
  const rows = leaving.filter((r) => r.check_out === day);
  const byBuilding = new Map();
  for (const r of rows) { if (!byBuilding.has(r.building)) byBuilding.set(r.building, []); byBuilding.get(r.building).push(r); }
  // Two buildings with several units each, so "Assign whole building" has something to do.
  return [...byBuilding.values()].sort((a, b) => b.length - a.length).slice(0, 2).flatMap((g) => g.slice(0, Math.ceil(n / 2))).slice(0, n);
};
const todayStays = pickDay(today, 6), tomorrowStays = pickDay(tomorrow, 4);
const cleaners = await sql`select id, user_id from cleaners where is_active = 1 order by full_name limit 3`;

const tasks = [...todayStays, ...tomorrowStays].map((r, i) => {
  const deep = i === 2;
  const t = {
    id: `demo-ops-clean-${r.check_out}-${r.unit_id}`.slice(0, 120), unit_id: r.unit_id, reservation_id: r.id,
    kind: deep ? 'deep_clean' : 'turnover', title: deep ? '[Demo] Deep clean' : '[Demo] Turnover clean',
    instructions: '[Demo] Sample clean for the walkthrough. Remove with scripts/demo-ops-seed.mjs --remove.',
    scheduled_for: `${r.check_out}T${r.out_time}:00+08:00`,
    due_at: r.next_in ? `${r.check_out}T${r.next_in}:00+08:00` : null, next_guest_at: r.next_in ? `${r.check_out}T${r.next_in}:00+08:00` : null,
    state: 'open', cleaner_id: null, assignee_id: null,
  };
  // Today: the first two have a cleaner, the rest are left for "Assign whole building" and Auto-assign.
  if (r.check_out === today && i < 2 && cleaners[i]) { t.cleaner_id = cleaners[i].id; t.assignee_id = cleaners[i].user_id; t.state = 'assigned'; }
  return t;
});

// Repairs on three of today's demo units (or any units when there are no departures).
const repairUnits = todayStays.length >= 3 ? todayStays.map((r) => r.unit_id)
  : (await sql`select id from units order by unit_number limit 3`).map((u) => u.id);
const issues = [
  { id: 'demo-ops-mnt-aircon', unit_id: repairUnits[0], title: '[Demo] Aircon not cooling, guest complained', category: 'aircon', urgency: 'urgent', source: 'guest',
    state: 'waiting', vendor_name: 'CoolAir Services (demo)', assignee_kind: 'contractor', quoted_amount: 45000, owner_approval_required: 1, charge_to: 'owner' },
  { id: 'demo-ops-mnt-leak', unit_id: repairUnits[1] ?? repairUnits[0], title: '[Demo] Bathroom tap leaking', category: 'plumbing', urgency: 'normal', source: 'cleaner',
    state: 'assigned', vendor_name: 'Hafiz (demo, in-house)', assignee_kind: 'in_house', quoted_amount: 12000, owner_approval_required: 0, charge_to: 'owner' },
  { id: 'demo-ops-mnt-sofa', unit_id: repairUnits[2] ?? repairUnits[0], title: '[Demo] Sofa leg broken', category: 'furniture', urgency: 'normal', source: 'staff',
    state: 'open', vendor_name: null, assignee_kind: null, quoted_amount: null, owner_approval_required: 0, charge_to: 'the_conts' },
];
const windows = [{ id: 'demo-ops-win-leak', issue_id: 'demo-ops-mnt-leak', starts_at: `${today}T12:00:00+08:00`, ends_at: `${today}T14:00:00+08:00`, note: '[Demo] Between guests' }];

console.log(`\nWould add (skipping any that already exist):`);
for (const t of tasks) console.log(`  clean   ${t.id}  ${t.kind}  ${t.state}`);
for (const m of issues) console.log(`  repair  ${m.id}  ${m.state}`);
for (const w of windows) console.log(`  window  ${w.id}  ${w.starts_at} - ${w.ends_at}`);
console.log(`Demo rows now:`, await counts(sql));
if (!tasks.length) console.log('\nNo guest leaves today or tomorrow on a unit without a clean, so no demo cleans would be added.');
if (!APPLY) { console.log(`\nNothing was changed. To add it: add  --apply --confirm=${target}`); await sql.end(); process.exit(0); }
if (arg('confirm') !== target) { console.error(`--confirm must be exactly ${target}. Nothing was changed.`); await sql.end(); process.exit(1); }

await sql.begin(async (tx) => {
  for (const t of tasks) {
    await tx`insert into tasks (id, unit_id, reservation_id, kind, state, title, instructions, scheduled_for, due_at, next_guest_at, requires_photo, cleaner_id, assignee_id, created_at, updated_at)
             values (${t.id}, ${t.unit_id}, ${t.reservation_id}, ${t.kind}, ${t.state}, ${t.title}, ${t.instructions}, ${t.scheduled_for}, ${t.due_at}, ${t.next_guest_at}, 1, ${t.cleaner_id}, ${t.assignee_id}, ${nowIso}, ${nowIso})
             on conflict (id) do nothing`;
  }
  for (const m of issues) {
    await tx`insert into maintenance_issues (id, unit_id, state, title, detail, vendor_name, assignee_kind, quoted_amount, owner_approval_required, charge_to, category, urgency, source, reported_at, created_at, updated_at)
             values (${m.id}, ${m.unit_id}, ${m.state}, ${m.title}, '[Demo] Sample job for the walkthrough.', ${m.vendor_name}, ${m.assignee_kind}, ${m.quoted_amount}, ${m.owner_approval_required}, ${m.charge_to}, ${m.category}, ${m.urgency}, ${m.source}, ${nowIso}, ${nowIso}, ${nowIso})
             on conflict (id) do nothing`;
  }
  for (const w of windows) {
    await tx`insert into maintenance_windows (id, issue_id, starts_at, ends_at, note, created_at) values (${w.id}, ${w.issue_id}, ${w.starts_at}, ${w.ends_at}, ${w.note}, ${nowIso}) on conflict (id) do nothing`;
  }
  await tx`insert into audit_log (actor_id, actor_label, action, entity_table, entity_id, after_state, source, occurred_at)
           values (null, 'demo-ops-seed', 'demo.seed', 'tasks', 'demo-ops', ${JSON.stringify({ cleans: tasks.length, repairs: issues.length })}, 'script', ${nowIso})`;
});
console.log('\nAdded. Demo rows now:', await counts(sql));
await sql.end();
