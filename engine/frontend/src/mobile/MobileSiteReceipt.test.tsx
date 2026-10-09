import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OpenLine } from "../pages/projects/renovation/renovationApi";

const h = vi.hoisted(() => ({ posts: [] as unknown[] }));

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: async (path: string) => {
        if (path.startsWith("/api/scm/site-receipts/projects/7/open-lines")) {
          return { data: [
            { po_item_id: "p1", po_number: "PO-1", supplier_name: "Sofa Co", item_code: "SOFA", material_name: "Sofa 3 seater", description: "Sofa 3 seater", remaining: 1, room: "Living", group: "FURNITURE" },
            { po_item_id: "p2", po_number: "PO-2", supplier_name: "Wiring Sdn Bhd", item_code: "RN-ELECTRICAL", material_name: "Wiring", description: "Wiring whole unit", remaining: 1, room: null, group: "WORKS" },
          ] };
        }
        return { data: [] };
      },
      post: async (path: string, body: unknown) => { h.posts.push({ path, body }); return { created: [], tasksCompleted: 0 }; },
    },
  };
});

import { MobileSiteReceipt, siteReceiptProblems, type StagedPhoto } from "./MobileSiteReceipt";

// jsdom has no canvas; the signature pad only needs getContext to answer.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];

const LINES: OpenLine[] = [
  { po_item_id: "p1", po_number: "PO-1", supplier_name: "Sofa Co", item_code: "SOFA", material_name: "Sofa", description: null, remaining: 2, room: "Living", group: "FURNITURE" },
  { po_item_id: "p2", po_number: "PO-2", supplier_name: "Wiring", item_code: "RN-ELECTRICAL", material_name: "Wiring", description: null, remaining: 1, room: null, group: "WORKS" },
];
const photo = (kind: StagedPhoto["kind"]): StagedPhoto => ({ id: kind, kind, file: new File(["x"], `${kind}.jpg`, { type: "image/jpeg" }), room: "" });

describe("site receipt rules on the phone", () => {
  it("lists what still stops the receipt, in order", () => {
    expect(siteReceiptProblems(LINES, {}, [], false, false, "")[0]).toMatch(/Tick at least one line/);
    const goods = siteReceiptProblems(LINES, { p1: 1 }, [photo("in_place")], true, false, "");
    expect(goods).toEqual(["Add a photo of the supplier's delivery order."]);
    expect(siteReceiptProblems(LINES, { p1: 3 }, [photo("in_place"), photo("supplier_do")], true, false, "")).toEqual(["Sofa: only 2 left to receive."]);
  });

  it("a finished trade needs an after photo but no supplier DO", () => {
    expect(siteReceiptProblems(LINES, { p2: 1 }, [photo("after")], true, false, "")).toEqual([]);
    expect(siteReceiptProblems(LINES, { p2: 1 }, [], true, false, "")).toEqual(["Add a photo of the items in place (or an after photo for a trade)."]);
  });

  it("the supervisor must sign; a customer signature needs a name", () => {
    expect(siteReceiptProblems(LINES, { p2: 1 }, [photo("after")], false, false, "")).toEqual(["The site supervisor must sign."]);
    expect(siteReceiptProblems(LINES, { p2: 1 }, [photo("after")], true, true, " ")).toEqual(["Write the customer's name next to their signature."]);
  });

  it("renders the open lines and refuses to send an empty receipt", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MobileSiteReceipt projectId={7} projectName="Skyline A-12-3" onBack={() => {}} onDone={() => {}} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Sofa 3 seater")).toBeTruthy();
    expect(screen.getByText("Wiring whole unit")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm received" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Tick at least one line/);
    expect(h.posts).toHaveLength(0);
  });
});
