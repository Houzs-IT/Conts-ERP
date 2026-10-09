import { describe, expect, test } from "vitest";
import { lineGroupOf, photoRuleRefusal, validateSiteReceiptBody, type SiteReceiptBody } from "../src/scm/routes/site-receipts";

const PO1 = "11111111-1111-4111-8111-111111111111";
const PO2 = "22222222-2222-4222-8222-222222222222";

function body(extra: Partial<SiteReceiptBody> = {}): SiteReceiptBody {
  return {
    projectId: 7,
    lines: [{ poItemId: PO1, qty: 1 }],
    photos: [{ r2Key: "renovation/7/photo-1.jpg", kind: "in_place", location: "Kitchen" }],
    supervisorSignatureR2Key: "renovation/7/signature-1.png",
    ...extra,
  };
}

describe("site receipt body", () => {
  test("a complete body passes", () => {
    expect(validateSiteReceiptBody(body())).toBeNull();
  });

  test("project, lines and quantities", () => {
    expect(validateSiteReceiptBody({ ...body(), projectId: 0 })?.error).toBe("project_required");
    expect(validateSiteReceiptBody(body({ lines: [] }))?.error).toBe("lines_required");
    expect(validateSiteReceiptBody(body({ lines: [{ poItemId: "nope", qty: 1 }] }))?.error).toBe("invalid_line");
    expect(validateSiteReceiptBody(body({ lines: [{ poItemId: PO1, qty: 0 }] }))?.error).toBe("qty_must_be_positive");
    expect(validateSiteReceiptBody(body({ lines: [{ poItemId: PO1, qty: 1.5 }] }))?.error).toBe("qty_must_be_positive");
    expect(validateSiteReceiptBody(body({ lines: [{ poItemId: PO1, qty: 1 }, { poItemId: PO1, qty: 1 }] }))?.error).toBe("duplicate_line");
  });

  test("signatures must be uploads of this project; customer signature needs a name", () => {
    expect(validateSiteReceiptBody(body({ supervisorSignatureR2Key: "" }))?.error).toBe("supervisor_signature_required");
    expect(validateSiteReceiptBody(body({ supervisorSignatureR2Key: "renovation/8/sig.png" }))?.error).toBe("supervisor_signature_required");
    expect(validateSiteReceiptBody(body({ customerSignatureR2Key: "renovation/7/c.png" }))?.error).toBe("customer_name_required");
    expect(validateSiteReceiptBody(body({ customerSignatureR2Key: "renovation/7/c.png", customerSignerName: "Ms Lim" }))).toBeNull();
    expect(validateSiteReceiptBody(body({ customerSignatureR2Key: "other/7/c.png", customerSignerName: "Ms Lim" }))?.error).toBe("invalid_signature_key");
  });

  test("photos: this project's uploads, known kinds, tagged only to received lines", () => {
    expect(validateSiteReceiptBody(body({ photos: [{ r2Key: "renovation/8/p.jpg", kind: "in_place" }] }))?.error).toBe("invalid_photo_key");
    expect(validateSiteReceiptBody(body({ photos: [{ r2Key: "renovation/7/../8/p.jpg", kind: "in_place" }] }))?.error).toBe("invalid_photo_key");
    expect(validateSiteReceiptBody(body({ photos: [{ r2Key: "renovation/7/p.jpg", kind: "selfie" as never }] }))?.error).toBe("invalid_photo_kind");
    expect(validateSiteReceiptBody(body({ photos: [{ r2Key: "renovation/7/p.jpg", kind: "in_place", poItemId: PO2 }] }))?.error).toBe("photo_line_mismatch");
  });

  test("location must be a real coordinate when given", () => {
    expect(validateSiteReceiptBody(body({ lat: 3.15, lng: 101.7, accuracyM: 12 }))).toBeNull();
    expect(validateSiteReceiptBody(body({ lat: 95, lng: 101.7 }))?.error).toBe("invalid_location");
    expect(validateSiteReceiptBody(body({ lat: 3.15, lng: 101.7, accuracyM: -1 }))?.error).toBe("invalid_location");
  });

  test("photo rules once the lines are known", () => {
    expect(photoRuleRefusal([{ r2Key: "k", kind: "supplier_do" }], true)?.error).toBe("photo_required");
    expect(photoRuleRefusal([{ r2Key: "k", kind: "in_place" }], true)?.error).toBe("supplier_do_photo_required");
    expect(photoRuleRefusal([{ r2Key: "k", kind: "in_place" }, { r2Key: "d", kind: "supplier_do" }], true)).toBeNull();
    expect(photoRuleRefusal([{ r2Key: "k", kind: "after" }], false)).toBeNull(); // a trade: after photo, no supplier DO
  });

  test("line group from the product (new group column first, legacy category second)", () => {
    expect(lineGroupOf({ category: "SERVICE", category_group: "WORKS" })).toBe("WORKS");
    expect(lineGroupOf({ category: "SOFA", category_group: null })).toBe("FURNITURE");
    expect(lineGroupOf({ category: null, category_group: null })).toBeNull();
  });
});
