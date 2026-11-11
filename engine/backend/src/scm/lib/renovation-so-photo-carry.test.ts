import { describe, expect, test } from "vitest";
import { addedKeys, carrySoPhoto, withoutKey } from "./renovation-so-photo-carry";

type Row = Record<string, unknown>;

function fakeSb(tables: Record<string, Row[]>, writes: Array<[string, string, string[]]>) {
  return {
    from(table: string) {
      const q = {
        rows: tables[table] ?? [],
        patch: null as Row | null,
        select() { return q; },
        update(p: Row) { q.patch = p; return q; },
        eq(col: string, v: unknown) {
          if (q.patch) { writes.push([table, String(v), q.patch.photo_urls as string[]]); return Promise.resolve({ error: null }); }
          q.rows = q.rows.filter((r) => r[col] === v);
          return Promise.resolve({ data: q.rows, error: null });
        },
        in(col: string, vs: unknown[]) { return Promise.resolve({ data: q.rows.filter((r) => vs.includes(r[col])), error: null }); },
      };
      return q;
    },
  };
}

const po = (id: string, photos: string[], status = "SUBMITTED"): Row => ({ id, so_item_id: "L1", photo_urls: photos, purchase_orders: { status } });

describe("a sales order line's photo follows to its PO lines", () => {
  test("adding is once only and removing leaves the others", () => {
    expect(addedKeys(["a"], "b")).toEqual(["a", "b"]);
    expect(addedKeys(["a"], "a")).toEqual(["a"]);
    expect(addedKeys(null, "a")).toEqual(["a"]);
    expect(withoutKey(["a", "b"], "a")).toEqual(["b"]);
  });

  test("a new photo reaches a live PO line, not a cancelled one", async () => {
    const writes: Array<[string, string, string[]]> = [];
    await carrySoPhoto(fakeSb({ purchase_order_items: [po("P1", ["po-items/own.jpg"]), po("P2", [], "CANCELLED")] }, writes), "L1", { add: "so-items/new.jpg" });
    expect(writes).toEqual([["purchase_order_items", "P1", ["po-items/own.jpg", "so-items/new.jpg"]]]);
  });

  test("a removed photo leaves the PO line and a PO's own photo stays", async () => {
    const writes: Array<[string, string, string[]]> = [];
    await carrySoPhoto(fakeSb({ purchase_order_items: [po("P1", ["po-items/own.jpg", "so-items/old.jpg"])] }, writes), "L1", { remove: "so-items/old.jpg" });
    expect(writes).toEqual([["purchase_order_items", "P1", ["po-items/own.jpg"]]]);
  });

  test("what was added on the production order survives", async () => {
    const writes: Array<[string, string, string[]]> = [];
    await carrySoPhoto(fakeSb({
      purchase_order_items: [po("P1", [])],
      production_order_items: [{ id: "O1", source_po_item_id: "P1", photo_urls: ["pro-items/made.jpg"] }],
    }, writes), "L1", { add: "so-items/new.jpg" });
    expect(writes).toEqual([
      ["purchase_order_items", "P1", ["so-items/new.jpg"]],
      ["production_order_items", "O1", ["so-items/new.jpg", "pro-items/made.jpg"]],
    ]);
  });

  test("a failure never reaches the sales order's save", async () => {
    await expect(carrySoPhoto({ from() { throw new Error("down"); } }, "L1", { add: "k" })).resolves.toBeUndefined();
  });
});
