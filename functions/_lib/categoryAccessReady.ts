import { type Env, fail } from './db';
import { hasColumn } from './auth';

/** Migration 0176: the tables the Category access page reads and writes. Before it is applied the handlers say so
 *  (503 NOT_MIGRATED, as the other unapplied migrations do) instead of failing with a database error. */
export const categoryAccessReady = (env: Env): Promise<boolean> =>
  Promise.all([hasColumn(env, 'person_category_access', 'user_id'), hasColumn(env, 'department_category_access', 'department_id')])
    .then(ready => ready.every(Boolean))
    .catch(() => false);

export const notMigrated = () =>
  fail('NOT_MIGRATED', 'Category access needs a database update (migration 0176) that has not been applied yet.', 503);
