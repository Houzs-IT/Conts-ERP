import { describe, expect, it } from "vitest";
import { renovationBetaClientPublic } from "../src/routes/renovationBetaClientPublic";
import { signClientLink } from "../src/services/renovation/betaClientLink";
import { clientPhotoIndex, clientView, photoRef, skuPhotoList, type ClientItem } from "../src/services/renovation/betaVoPo";

const SECRET = "test-secret-for-beta-client-photos";
const LINE_KEY = "so-items/SO-1/item-1/aaa.jpg";
const SKU_KEY = "mfg-product-photos/p-1/bbb.png";
const OTHER_KEY = "so-items/SO-9/item-9/zzz.jpg";

const item = (over: Partial<ClientItem> = {}): ClientItem => ({
  key: "so:item-1", soDocNo: "SO-1", soItemId: "item-1", itemCode: "CUS-TILE", description: "Floor tile", categoryLabel: "Tiles", categorySort: 1,
  subLabel: "Floor", subSort: 1, area: "Kitchen", qty: 2, measure: null, uom: "SQFT", photoKeys: [LINE_KEY],
  skuPhotos: [{ productId: "p-1", key: SKU_KEY, thumbKey: `${SKU_KEY}.thumb` }], voNo: null, pending: false, ...over,
});

describe("client link photos (pure)", () => {
  it("reads the SKU photo list as the query answers it, text or array", () => {
    const one = [{ productId: "p-1", key: SKU_KEY, thumbKey: null }];
    expect(skuPhotoList(JSON.stringify(one))).toEqual(one);
    expect(skuPhotoList(one)).toEqual(one);
    expect(skuPhotoList("not json")).toEqual([]);
    expect(skuPhotoList([{ productId: "p-1" }, null])).toEqual([]);
  });

  it("lists the line's and the SKU's photos by reference only, never a storage key or document number", async () => {
    const [v] = await clientView([item()]);
    expect(v!.photos).toEqual([{ ref: await photoRef(LINE_KEY), from: "line" }, { ref: await photoRef(SKU_KEY), from: "sku" }]);
    const text = JSON.stringify(v);
    expect(text).not.toContain("so-items/");
    expect(text).not.toContain("mfg-product-photos/");
    expect(text).not.toContain("SO-1");
    expect(v!.photos.every((p) => /^[0-9a-f]{24}$/.test(p.ref))).toBe(true);
  });

  it("resolves a reference back to its key", async () => {
    const idx = await clientPhotoIndex([item()]);
    expect(idx.get(await photoRef(SKU_KEY))).toEqual({ key: SKU_KEY, thumbKey: `${SKU_KEY}.thumb`, from: "sku" });
    expect(idx.get(await photoRef(OTHER_KEY))).toBeUndefined();
  });
});

/** A database that answers the project read and the client-items read of project 7, company 2. */
function fakeEnv(objects: Record<string, string>) {
  const soRow = {
    id: "item-1", doc_no: "SO-1", item_code: "CUS-TILE", description: "Floor tile", qty: 2, uom: "SQFT", unit_cost_sen: 0, photo_urls: [LINE_KEY],
    room: "Kitchen", supply_by_owner: true, line_supplier_code: null, main_supplier_code: null, measure: null, measure_uom: null, vo_no: null,
    cat_label: "Tiles", cat_sort: 1, sub_label: "Floor", sub_sort: 1,
    sku_photos: JSON.stringify([{ productId: "p-1", key: SKU_KEY, thumbKey: `${SKU_KEY}.thumb` }]),
  };
  const DB = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) { args = a; return stmt; },
        async first() { return /FROM projects p/.test(sql) && args[0] === 7 && args[1] === 2 ? { name: "Unit 3A", company_name: "Conts" } : null; },
        async all() { return { results: /mfg_sales_order_items/.test(sql) && args[0] === 7 && args[1] === 2 ? [soRow] : [] }; },
        async run() { return {}; },
      };
      return stmt;
    },
  };
  const SO_ITEM_PHOTOS = {
    async get(k: string) {
      return k in objects ? { body: objects[k], httpMetadata: { contentType: k.endsWith(".png") || k.endsWith(".thumb") ? "image/png" : "image/jpeg" } } : null;
    },
  };
  return { DB, SO_ITEM_PHOTOS, CONTS_SSO_SECRET: SECRET } as never;
}

describe("GET /api/public/beta-client/:token/photos/:ref", () => {
  const objects = { [LINE_KEY]: "line-bytes", [SKU_KEY]: "sku-bytes", [`${SKU_KEY}.thumb`]: "sku-thumb", [OTHER_KEY]: "other-bytes" };
  const get = async (token: string, ref: string, q = "") => renovationBetaClientPublic.request(`/${token}/photos/${ref}${q}`, {}, fakeEnv(objects));
  const token = (projectId = 7, companyId = 2, expiresAt = Date.now() + 86_400_000) => signClientLink(SECRET, { projectId, companyId, expiresAt });

  it("serves the line photo and the SKU photo (its thumb when asked) of an item on the link", async () => {
    const t = await token();
    const line = await get(t, await photoRef(LINE_KEY));
    expect(line.status).toBe(200);
    expect(await line.text()).toBe("line-bytes");
    expect(line.headers.get("content-type")).toBe("image/jpeg");
    expect(await (await get(t, await photoRef(SKU_KEY))).text()).toBe("sku-bytes");
    expect(await (await get(t, await photoRef(SKU_KEY), "?thumb=1")).text()).toBe("sku-thumb");
    // No thumb stored for the line photo: the full photo answers.
    expect(await (await get(t, await photoRef(LINE_KEY), "?thumb=1")).text()).toBe("line-bytes");
  });

  it("refuses another project's photo, a project of another company, an expired or altered link and a bad reference", async () => {
    const t = await token();
    expect((await get(t, await photoRef(OTHER_KEY))).status).toBe(404);
    expect((await get(await token(8, 2), await photoRef(LINE_KEY))).status).toBe(404);
    expect((await get(await token(7, 3), await photoRef(LINE_KEY))).status).toBe(404);
    expect((await get(await token(7, 2, Date.now() - 1000), await photoRef(LINE_KEY))).status).toBe(404);
    expect((await get(`${t.slice(0, -2)}AA`, await photoRef(LINE_KEY))).status).toBe(404);
    expect((await get(t, "../../so-items")).status).toBe(404);
    expect((await get(t, encodeURIComponent(LINE_KEY))).status).toBe(404);
  });
});
