/* Click sweep F19 (21 Nov 2026): Book appointment closed on a click outside and lost the typed note. */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BetaModal } from "./BetaForms";

afterEach(cleanup);

function mount(onClose: () => void) {
  render(
    <BetaModal title="Add work" onClose={onClose} onSubmit={async () => {}} error={null} busy={false}>
      <input aria-label="Note" />
    </BetaModal>,
  );
  return screen.getByRole("dialog").parentElement!;
}

describe("BetaModal outside click", () => {
  test("an untouched dialog closes on a click outside", () => {
    const onClose = vi.fn();
    fireEvent.mouseDown(mount(onClose));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("once something is typed, a click outside keeps it open; Cancel still closes", () => {
    const onClose = vi.fn();
    const scrim = mount(onClose);
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Bring the tiles" } });
    fireEvent.mouseDown(scrim);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
