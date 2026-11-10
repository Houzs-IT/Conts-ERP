import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/* pg-migrate runs every pending file on ONE connection, and a plain
   `SET search_path = scm, public` inside a file is session-level: it outlives
   that file's transaction and steers the next file's unqualified CREATE TABLE
   into scm (Houzs bde48c895, #4466). The runner resets search_path at the top
   of every file's transaction, before the file's own statements. */
describe("pg-migrate: a file's SET search_path cannot leak into the next file", () => {
  const src = readFileSync(resolve(__dirname, "../scripts/pg-migrate.mjs"), "utf8");

  it("resets search_path inside each file's transaction, before the file's own statements run", () => {
    const loop = src.slice(src.indexOf("for (const file of pending)"));
    const begin = loop.indexOf("pg.begin(");
    const reset = loop.indexOf('tx.unsafe("RESET search_path")');
    const firstStatement = loop.indexOf("for (const s of stmts) await tx.unsafe(s)");
    expect(begin).toBeGreaterThan(-1);
    expect(reset).toBeGreaterThan(begin);
    expect(firstStatement).toBeGreaterThan(reset);
  });
});
