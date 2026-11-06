import { describe, expect, it } from "vitest";
import { drWhatHappens, withDrWhy } from "./deliveryReturnWhy";
import type { Column } from "../../components/DataTable";

type R = { reason: string | null; status: string };

describe("drWhatHappens", () => {
  it("reads the outcome the status records", () => {
    expect(drWhatHappens("RECEIVED")).toBe("Back to stock");
    expect(drWhatHappens("refunded")).toBe("Refund");
    expect(drWhatHappens("CREDIT_NOTED")).toBe("Credit note");
  });

  it("says nothing it does not know", () => {
    expect(drWhatHappens("DRAFT")).toBe("—");
    expect(drWhatHappens("CANCELLED")).toBe("—");
    expect(drWhatHappens(null)).toBe("—");
  });
});

describe("withDrWhy", () => {
  const col = (key: string): Column<R> => ({ key, label: key, getValue: () => "", render: () => null });

  it("sits straight after Status, and Why reads the reason", () => {
    const out = withDrWhy<R, never>([col("doc_no"), col("status"), col("ref")] as never);
    expect(out.map((c) => c.key)).toEqual(["doc_no", "status", "why", "what_happens", "ref"]);
    expect(out[2].getValue?.({ reason: "Damaged on site", status: "RECEIVED" })).toBe("Damaged on site");
  });
});
