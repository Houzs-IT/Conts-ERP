/* CONTS-0008: a goods receipt carries its own proof, like a delivery order's POD. */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const { fetchBlobUrl, listDocFiles, uploadDocFile } = vi.hoisted(() => ({
  fetchBlobUrl: vi.fn(async () => "blob:gr-photo"),
  listDocFiles: vi.fn(),
  uploadDocFile: vi.fn(async () => ({ ok: true, duplicate: false })),
}));
vi.mock("../api/client", () => ({ api: { fetchBlobUrl } }));
vi.mock("../components/doc-attachments/docAttachmentsApi", async (orig) => ({
  ...(await orig<typeof import("../components/doc-attachments/docAttachmentsApi")>()),
  listDocFiles,
  uploadDocFile,
}));

import { GrnProofOfReceiptCard } from "./GrnProofOfReceiptCard";

const file = (id: string, source: string, at = "2026-11-02T03:00:00Z") => ({
  id, name: `${id}.jpg`, mime: "image/jpeg", kind: "image", size: 1000, caption: "", source, by: "Aina", at, lineId: null, readOnly: false,
});

const wrap = (canEdit = true) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <GrnProofOfReceiptCard grn={{ id: "grn-1", received_at: "2026-11-02", delivery_note_ref: "SUP-DO-77" }} canEdit={canEdit} />
    </QueryClientProvider>,
  );

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("GrnProofOfReceiptCard", () => {
  it("shows only the proof-of-receipt photos, through the GR's own file stream", async () => {
    listDocFiles.mockResolvedValue({ ready: true, files: [file("p1", "pod"), file("u1", "upload"), file("p2", "pod", "2026-11-02T04:00:00Z")] });
    wrap();
    expect(screen.getByText("SUP-DO-77")).toBeTruthy();
    await waitFor(() => expect(screen.getByAltText("POD photo 2")).toBeTruthy());
    expect(fetchBlobUrl).toHaveBeenCalledWith("/api/scm/grns/grn-1/attachments/p1");
    expect(fetchBlobUrl).toHaveBeenCalledWith("/api/scm/grns/grn-1/attachments/p2");
    expect(fetchBlobUrl).not.toHaveBeenCalledWith("/api/scm/grns/grn-1/attachments/u1");
    expect(screen.getByText(/^Aina · /)).toBeTruthy();
  });

  it("uploads a taken photo as the receipt's proof", async () => {
    listDocFiles.mockResolvedValue({ ready: true, files: [] });
    const { container } = wrap();
    expect(await screen.findByText(/No photo yet/)).toBeTruthy();
    const photo = new File(["x"], "goods.jpg", { type: "image/jpeg" });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [photo] } });
    await waitFor(() => expect(uploadDocFile).toHaveBeenCalledWith("goods_received", "grn-1", photo, { source: "pod", caption: "Proof of receipt" }));
  });

  it("offers no camera on a cancelled receipt", async () => {
    listDocFiles.mockResolvedValue({ ready: true, files: [] });
    wrap(false);
    await screen.findByText(/No photo yet/);
    expect(screen.queryByText("Take photo")).toBeNull();
  });
});
