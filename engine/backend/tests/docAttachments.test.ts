import { describe, expect, test } from "vitest";
import { DOC_TYPES, attachmentKey, cleanName, fileKind, validDocId, type DocType } from "../src/scm/lib/doc-attachments";
import { matchLine } from "../src/scm/routes/doc-attachments";

const lines = [
  { id: "a", lineNo: 1, sku: "TILE-600", description: "Floor tile", parentId: null },
  { id: "b", lineNo: 2, sku: "SOFA-3S", description: "Sofa", parentId: null },
  { id: "c", lineNo: 3, sku: "SOFA-3S", description: "Sofa, second", parentId: null },
];

describe("photos and documents on flow documents (owner, 16 Oct 2026)", () => {
  test("photos, videos and PDFs are accepted; anything a browser could run is not", () => {
    expect(fileKind("image/jpeg")).toBe("image");
    expect(fileKind("image/heic")).toBe("image");
    expect(fileKind("video/quicktime")).toBe("video");
    expect(fileKind("application/pdf")).toBe("pdf");
    expect(fileKind("text/html")).toBeNull();
    expect(fileKind("image/svg+xml")).toBeNull();
  });

  test("a document is named by its uuid, a sales order by its number, an official receipt by its number id", () => {
    expect(validDocId("purchase_order", "32502f92-6ce2-4272-adef-714223f3acab")).toBe(true);
    expect(validDocId("purchase_order", "TC-PO-2610-001")).toBe(false);
    expect(validDocId("sales_order", "TC-SO-2610-002")).toBe(true);
    expect(validDocId("official_receipt", "42")).toBe(true);
    expect(validDocId("official_receipt", "4x")).toBe(false);
  });

  test("an import line is found by its number, or by an item code only one line has", () => {
    expect(matchLine(lines, "2")).toEqual({ lineId: "b" });
    expect(matchLine(lines, "tile-600")).toEqual({ lineId: "a" });
    expect(matchLine(lines, "SOFA-3S")).toEqual({ status: "ambiguous_line" });
    expect(matchLine(lines, "9")).toEqual({ status: "no_line" });
    expect(matchLine(lines, "NOPE")).toEqual({ status: "no_line" });
  });

  test("files carry down the flow from the line upstream, never across to another kind of document", () => {
    const parent = (t: DocType) => DOC_TYPES[t].lines?.parent?.type;
    expect(parent("purchase_order")).toBe("sales_order");
    expect(parent("delivery_order")).toBe("sales_order");
    expect(parent("sales_invoice")).toBe("sales_order");
    expect(parent("goods_received")).toBe("purchase_order");
    expect(parent("purchase_invoice")).toBe("goods_received");
    expect(parent("purchase_return")).toBe("goods_received");
    expect(parent("delivery_return")).toBe("delivery_order");
    expect(parent("sales_order")).toBeUndefined();
  });

  test("stored names and keys stay inside the document's own folder", () => {
    expect(attachmentKey(1, "sales_order", "TC/SO 1", "image/jpeg")).toMatch(/^doc-attachments\/1\/sales_order\/TC_SO_1\/[0-9a-f-]{36}\.jpg$/);
    expect(cleanName('a"b\\c/d.jpg', "image/jpeg")).toBe("a b c d.jpg");
    expect(cleanName("   ", "application/pdf")).toBe("file.pdf");
  });
});
