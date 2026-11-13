import { type Env, fail, one } from './db';
import { hasColumn } from './auth';

const catalogReady = async (env: Env): Promise<boolean> =>
  (await one<{ ready: boolean }>(env, `SELECT to_regprocedure('pos.product_category_catalog()') IS NOT NULL AS ready`))?.ready === true;

/** Migrations 0176 and 0317: the tables the Category access page reads and writes, and the engine's catalog it ticks
 *  from. Before they are applied the handlers say so (503 NOT_MIGRATED, as the other unapplied migrations do) instead of
 *  failing with a database error. */
export const categoryAccessReady = (env: Env): Promise<boolean> =>
  Promise.all([hasColumn(env, 'person_category_access', 'user_id'), hasColumn(env, 'department_category_access', 'department_id'), catalogReady(env)])
    .then(ready => ready.every(Boolean))
    .catch(() => false);

export const notMigrated = () =>
  fail('NOT_MIGRATED', 'Category access needs a database update (migrations 0176 and 0317) that has not been applied yet.', 503);
