// Department and position on user accounts (migration 0113): invite with them, edit them, clear them, read them back
// in the list, and the limits. Only management may change them; operations managers read them.
//   node scripts/api-checks/user-job.mjs                 migration 0113 applied
//   EXPECT_NO_JOB=1 node scripts/api-checks/user-job.mjs  0113 not applied: the list says so and a save ignores them
import { call, check, done } from './harness.mjs';

const noJob = !!process.env.EXPECT_NO_JOB;
const tag = Date.now().toString().slice(-6);
const find = async (id) => (await call('GET', '/api/users')).json?.data?.find(u => u.id === id);

let r = await call('GET', '/api/users');
check('users list', r.status === 200 && Array.isArray(r.json?.data), r.text.slice(0, 200));
check(`jobFields is ${!noJob}`, r.json?.jobFields === !noJob, String(r.json?.jobFields));

r = await call('POST', '/api/users', { fullName: `Job Check ${tag}`, email: `job${tag}@local.test`, role: 'operations_staff', department: '  Sales ', position: 'Sales   Executive' });
check('invite with department and position', r.status === 201 && r.json?.id, r.text);
const id = r.json?.id;
let u = await find(id);
check(noJob ? 'no department or position before 0113' : 'saved trimmed, inner spaces collapsed',
  noJob ? u?.department === null && u?.position === null : u?.department === 'Sales' && u?.position === 'Sales Executive', JSON.stringify(u));

r = await call('PATCH', `/api/users/${id}`, { position: 'Project PIC' });
check('edit position alone', r.status === 200, r.text);
u = await find(id);
if (!noJob) check('position changed, department kept', u?.position === 'Project PIC' && u?.department === 'Sales', JSON.stringify(u));

r = await call('PATCH', `/api/users/${id}`, { department: '' });
u = await find(id);
if (!noJob) check('blank clears the department', r.status === 200 && u?.department === null && u?.position === 'Project PIC', JSON.stringify(u));

r = await call('PATCH', `/api/users/${id}`, { position: 'x'.repeat(81) });
check('a position over 80 characters is refused', r.status === 422 && !!r.json?.error?.fields?.position, r.text);
r = await call('PATCH', `/api/users/${id}`, { department: 12 });
check('a department that is not text is refused', r.status === 422 && !!r.json?.error?.fields?.department, r.text);
r = await call('POST', '/api/users', { fullName: 'Too Long', email: `long${tag}@local.test`, role: 'operations_staff', department: 'd'.repeat(81) });
check('invite with a department over 80 characters is refused', r.status === 422 && !!r.json?.error?.fields?.department, r.text);

r = await call('PATCH', `/api/users/${id}`, { position: 'Boss' }, 'operations_manager');
check('operations manager cannot change it', r.status === 403, r.text);
r = await call('GET', '/api/users', undefined, 'operations_manager');
check('operations manager reads it', r.status === 200 && (noJob || r.json?.data?.find(x => x.id === id)?.position === 'Project PIC'), r.text.slice(0, 200));

// Switch the test account off so it does not linger as an active account.
await call('PATCH', `/api/users/${id}`, { isActive: false });
done();
