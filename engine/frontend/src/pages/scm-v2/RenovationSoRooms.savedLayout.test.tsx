/* Click sweep F10 (21 Nov 2026): a cold load of an SO's ?edit=1 met the saved layout only after the rooms mounted,
   read it as a new choice and added an empty "Living hall" the order does not have. */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("../../vendor/scm/components/ConfirmDialog", () => ({ useConfirm: () => vi.fn(async () => true) }));

import { RenovationSoRooms, type RoomLayout } from "./RenovationSoRooms";

afterEach(cleanup);
const layout: RoomLayout = { label: "2 bed 1 bath", bedrooms: 2, bathrooms: 1 };
const rooms = ["Bedroom 1", "Bedroom 2", "Bathroom 1", "Common area"];

function mount(onRoomsChange: (next: string[]) => void, l: RoomLayout | null, saved: string | null | undefined) {
  const props = { rooms, rows: [], onRowRoom: () => {}, onAddLine: () => {}, onRoomsChange };
  const view = render(<RenovationSoRooms {...props} layout={l} savedLayoutKey={saved} />);
  return (nl: RoomLayout | null, ns: string | null | undefined) => view.rerender(<RenovationSoRooms {...props} layout={nl} savedLayoutKey={ns} />);
}

describe("rooms from the layout on a saved order", () => {
  test("the saved layout arriving after mount adds no room, before or after its key is known", () => {
    const change = vi.fn();
    const update = mount(change, null, null);
    update(layout, null);
    update(layout, "2|1");
    expect(change).not.toHaveBeenCalled();
  });

  test("changing the layout in the editor still adds its rooms", () => {
    const change = vi.fn();
    const update = mount(change, layout, "2|1");
    update({ label: "3 bed 1 bath", bedrooms: 3, bathrooms: 1 }, "2|1");
    expect(change).toHaveBeenCalledTimes(1);
    expect(change.mock.calls[0]![0]).toEqual(expect.arrayContaining(["Living hall", "Bedroom 3"]));
  });

  test("a new order (no saved layout) generates rooms when one is chosen", () => {
    const change = vi.fn();
    const update = mount(change, null, undefined);
    update(layout, undefined);
    expect(change).toHaveBeenCalledTimes(1);
  });
});
