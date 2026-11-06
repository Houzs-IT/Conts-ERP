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

  it("sits straight after the customer, and Why reads the reason", () => {
    const out = withDrWhy<R, never>([col("doc_no"), col("debtor_name"), col("agent")] as never);
    expect(out.map((c) => c.key)).toEqual(["doc_no", "debtor_name", "why", "what_happens", "agent"]);
    expect(out[2].getValue?.({ reason: "Damaged on site", status: "RECEIVED" })).toBe("Damaged on site");
  });
});
