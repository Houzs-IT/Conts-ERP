/* Bridges between the two database shapes the renovation code speaks.

   Phase 3 (projects) talks D1-style through env.DB: prepare(sql with ?).bind().all().
   Phase 2 (sales documents) talks RenoDb: q(sql with $1, params) over postgres.js.
   Each side calls the other's real code (billingView, readProjectHandoverState)
   through these, so no rule is written twice. */

import type { RenoDb } from "../../scm/lib/renovation-db";
import { rewriteDialect, toPgPlaceholders } from "../../db/d1-compat";
import type { Db, DbStmt } from "./load";

/** A D1-style Db as a RenoDb: `$n` placeholders become `?n` (d1-compat keeps the number, so reuse works). */
export function renoDbFromD1(db: Db): RenoDb {
  return {
    async q<T>(text: string, params: readonly unknown[] = []): Promise<T[]> {
      const res = await db.prepare(text.replace(/\$(\d+)/g, "?$1")).bind(...params.map((p) => (p === undefined ? null : p))).all<T>();
      return (res.results ?? []) as T[];
    },
  };
}

/** A RenoDb (a postgres.js connection or transaction) as a D1-style Db, with d1-compat's own rewrites. */
export function d1FromRenoDb(db: RenoDb): Db {
  const stmt = (sql: string, args: unknown[] = []): DbStmt => {
    const text = toPgPlaceholders(rewriteDialect(sql));
    return {
      bind: (...next: unknown[]) => stmt(sql, next),
      all: async <T>() => ({ results: await db.q<T>(text, args) }),
      first: async <T>() => ((await db.q<T>(text, args))[0] ?? null),
      run: async () => db.q(text, args),
    };
  };
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (stmts: DbStmt[]) => {
      const out: unknown[] = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
}
