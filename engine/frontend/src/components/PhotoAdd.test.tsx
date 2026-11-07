/* Add photo: two inputs, every upload on its own, a failed one tried again. */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PhotoAddButtons, PhotoUploads, usePhotoQueue } from "./PhotoAdd";

const file = (name: string) => new File(["x"], name, { type: "image/jpeg" });

function Harness({ upload }: { upload: (f: File) => Promise<string> }) {
  const q = usePhotoQueue(upload);
  return <><PhotoAddButtons queue={q} /><PhotoUploads queue={q} /><output>{q.results.join(",")}</output></>;
}

describe("PhotoAdd", () => {
  it("offers the camera and the album as two inputs", () => {
    render(<Harness upload={async (f) => f.name} />);
    const cam = screen.getByLabelText("Take photo") as HTMLInputElement;
    const album = screen.getByLabelText("Choose from album") as HTMLInputElement;
    expect(cam.getAttribute("capture")).toBe("environment");
    expect(cam.multiple).toBe(false);
    expect(album.multiple).toBe(true);
    expect(album.hasAttribute("capture")).toBe(false);
  });
  it("uploads many at once, and keeps taking", async () => {
    render(<Harness upload={async (f) => f.name} />);
    fireEvent.change(screen.getByLabelText("Choose from album"), { target: { files: [file("a.jpg"), file("b.jpg")] } });
    await waitFor(() => expect(screen.getByRole("status", { hidden: true }).textContent ?? "").toBeDefined());
    await waitFor(() => expect(document.querySelector("output")!.textContent).toBe("a.jpg,b.jpg"));
    fireEvent.change(screen.getByLabelText("Take photo"), { target: { files: [file("c.jpg")] } });
    await waitFor(() => expect(document.querySelector("output")!.textContent).toBe("a.jpg,b.jpg,c.jpg"));
    expect(screen.getByText("Take another")).toBeTruthy();
  });
  it("a failed upload stands alone and can be tried again", async () => {
    const upload = vi.fn(async (f: File) => f.name).mockRejectedValueOnce(new Error("no signal"));
    render(<Harness upload={upload} />);
    fireEvent.change(screen.getByLabelText("Choose from album"), { target: { files: [file("a.jpg"), file("b.jpg")] } });
    const retry = await screen.findByRole("button", { name: "Try a.jpg again" });
    await waitFor(() => expect(document.querySelector("output")!.textContent).toBe("b.jpg"));
    fireEvent.click(retry);
    await waitFor(() => expect(document.querySelector("output")!.textContent).toContain("a.jpg"));
    expect(upload).toHaveBeenCalledTimes(3);
  });
  it("on a phone, a shot brings back Take another, and video can be recorded", async () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("coarse"), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
    try {
      function V() { const q = usePhotoQueue(async (f: File) => f.name); return <PhotoAddButtons queue={q} video />; }
      render(<V />);
      expect((screen.getByLabelText("Record video") as HTMLInputElement).accept).toBe("video/*");
      fireEvent.change(screen.getByLabelText("Take photo"), { target: { files: [file("c.jpg")] } });
      const sheet = await screen.findByRole("dialog", { name: "Add another" });
      expect(sheet.textContent).toContain("Take another");
      expect(sheet.textContent).toContain("Record a video");
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
      expect(screen.queryByRole("dialog", { name: "Add another" })).toBeNull();
    } finally { window.matchMedia = mm; }
  });
});
