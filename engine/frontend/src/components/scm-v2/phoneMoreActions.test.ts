import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { phoneMoreHeaderClass } from "./phoneMoreActions";

describe("the phone More actions (click sweep 2, G11)", () => {
  it("opens the action header on a phone and leaves desktop as it was", () => {
    expect(phoneMoreHeaderClass(false).split(" ")).toEqual(expect.arrayContaining(["hidden", "md:block", "md:sticky"]));
    expect(phoneMoreHeaderClass(true).split(" ")).toContain("block");
    expect(phoneMoreHeaderClass(true).split(" ")).not.toContain("hidden");
  });

  it("no document page has a More actions button that does nothing", () => {
    const dir = join(__dirname, "../../pages/scm-v2");
    const dead: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".tsx") && !x.includes(".test."))) {
      const src = readFileSync(join(dir, f), "utf8");
      for (const m of src.matchAll(/<button\b[^>]*aria-label="More actions"[^>]*>/g)) if (!/onClick=/.test(m[0])) dead.push(f);
    }
    expect(dead).toEqual([]);
  });
});
