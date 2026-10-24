import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/* The owner run on project 99 "TESTING" (TC-SO-2610-002, 24 Oct 2026): screens fixed for Conts. */

const mutateAsync = vi.hoisted(() => vi.fn(async () => ({})));
const uploadSlipFull = vi.hoisted(() => vi.fn(async () => ({ r2Key: "slips/pod-1.jpg" })));
const uploadDocFile = vi.hoisted(() => vi.fn(async () => ({ ok: true, duplicate: false })));
vi.mock("../../vendor/scm/lib/delivery-order-queries", () => ({ useUpdateMfgDeliveryOrderStatus: () => ({ mutateAsync }) }));
vi.mock("../../vendor/scm/lib/slip", () => ({ uploadSlipFull }));
vi.mock("../../components/doc-attachments/docAttachmentsApi", () => ({ uploadDocFile, refusal: () => null }));

import { SoAreaLines, SoLinesViewToggle } from "./renovationSoAreaLines";
import { MarkDeliveredButton, canMarkDelivered } from "./renovationDoDelivered";
import { roomGroups } from "../../vendor/scm/lib/so-print-rooms";
import { contsLineIdentity, poMissingOptionLabels } from "../../conts/flowRules";
import { hasSofaMixConflict } from "../../vendor/shared/so-variant-rule";
import { addressLineProps } from "../../lib/acColumnWidths";

const lines = [
  { id: "a", item_code: "RN-PAINTING", description: "Works - Painting", total_sen: 250000 },
  { id: "b", item_code: "BED-HKA-1003-(Q)", description: "HILTON BEDFRAME (5FT)", total_sen: 61600 },
  { id: "c", item_code: "CUS-SOFA", description: "Customer Sofa", total_sen: 420000 },
  { id: "d", item_code: "X-1", description: "Loose item", total_sen: 1000 },
];
const rooms = { order: ["Living hall", "Master bedroom"], byItem: { a: "Living hall", b: "Master bedroom", c: "Living hall" } as Record<string, string> };

describe("SO lines by area", () => {
  it("groups lines under their room, in room order, with a subtotal each", () => {
    const g = roomGroups(lines, rooms);
    expect(g.map((x) => [x.area, x.lines.map((l) => l.id), x.subtotalSen])).toEqual([
      ["Living hall", ["a", "c"], 670000],
      ["Master bedroom", ["b"], 61600],
      ["Other items", ["d"], 1000],
    ]);
  });
  it("renders headings, lines and subtotals", () => {
    render(
      <SoAreaLines
        items={lines}
        rooms={rooms}
        columns={[
          { key: "item", label: "Item", render: (l) => l.description },
          { key: "total", label: "Amount", align: "right", render: (l) => String(l.total_sen) },
        ]}
        money={(sen) => `RM ${(sen / 100).toFixed(2)}`}
      />,
    );
    expect(screen.getByText("Subtotal · Living hall")).toBeTruthy();
    expect(screen.getByText("RM 6700.00")).toBeTruthy();
    expect(screen.getByText("RM 616.00")).toBeTruthy();
    expect(screen.getByText("Customer Sofa")).toBeTruthy();
  });
  it("the toggle offers By item and By area", () => {
    const onChange = vi.fn();
    render(<SoLinesViewToggle view="item" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "By area" }));
    expect(onChange).toHaveBeenCalledWith("area");
    expect(screen.getByRole("button", { name: "By item" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("SO line names", () => {
  it("leads with the product name, the code under it", () => {
    expect(contsLineIdentity({ code: "CUS-KITCHEN_CABINET", description: "Customer Kitchen cabinet", variant: "" }))
      .toEqual({ primary: "Customer Kitchen cabinet", secondary: "CUS-KITCHEN_CABINET" });
    expect(contsLineIdentity({ code: "RN-X", description: "", variant: "" })).toEqual({ primary: "RN-X", secondary: null });
  });
});

describe("Conts switches on shared screens", () => {
  it("a sofa may sit beside a bedframe and mattress", () => {
    expect(hasSofaMixConflict(["sofa", "bedframe", "mattress"])).toBe(false);
  });
  it("an address line has no 40-character cap", () => {
    expect(addressLineProps(() => {}, null)).toEqual({});
  });
  it("a PO line from an SO line asks only for the options the SO line has", () => {
    expect(poMissingOptionLabels("bedframe", {}, "BED-HKA-1003-(Q)", {})).toEqual([]);
    expect(poMissingOptionLabels("bedframe", {}, "BED-HKA-1003-(Q)", undefined).length).toBeGreaterThan(0);
  });
});

describe("Mark delivered (office)", () => {
  it("is offered on a shipped delivery only", () => {
    expect(canMarkDelivered("LOADED")).toBe(true);
    expect(canMarkDelivered("dispatched")).toBe(true);
    expect(canMarkDelivered("DELIVERED")).toBe(false);
    expect(canMarkDelivered("DRAFT")).toBe(false);
    expect(canMarkDelivered("CANCELLED")).toBe(false);
  });
  it("uploads the first photo as the POD, then runs the delivered transition with the date", async () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MarkDeliveredButton doId="do-1" doNumber="TC-DO-2610-002" status="LOADED" />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark delivered" }));
    const dialog = screen.getByRole("dialog");
    const date = dialog.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(date, { target: { value: "2026-10-20" } });
    const file = new File(["x"], "pod.jpg", { type: "image/jpeg" });
    const file2 = new File(["y"], "pod2.jpg", { type: "image/jpeg" });
    fireEvent.change(dialog.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file, file2] } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark delivered" }));
    await vi.waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(uploadSlipFull).toHaveBeenCalledWith({ file });
    expect(mutateAsync).toHaveBeenCalledWith({ id: "do-1", status: "DELIVERED", evidence: { podKey: "slips/pod-1.jpg", deliveredOn: "2026-10-20" } });
    await vi.waitFor(() => expect(uploadDocFile).toHaveBeenCalledWith("delivery_order", "do-1", file2, { caption: "Proof of delivery" }));
  });
});
