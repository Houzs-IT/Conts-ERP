import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../../vendor/scm/components/ConfirmDialog", () => ({ useConfirm: () => vi.fn(async () => true) }));

import { RenovationSoRooms } from "./RenovationSoRooms";

afterEach(cleanup);

test("each room shows the total of its own lines", () => {
  const row = (key: string, room: string, amountSen: number) => ({ key, room, amountSen, render: () => null });
  render(
    <RenovationSoRooms rooms={["Living hall", "Bathroom 1"]} layout={null} onRoomsChange={() => {}} onRowRoom={() => {}} onAddLine={() => {}}
      rows={[row("a", "Living hall", 10000), row("b", "Living hall", 2550), row("c", "Bathroom 1", 500)]}
      money={(sen) => `RM ${(sen / 100).toFixed(2)}`} />,
  );
  expect(screen.getByLabelText("Living hall total").textContent).toBe("RM 125.50");
  expect(screen.getByLabelText("Bathroom 1 total").textContent).toBe("RM 5.00");
});
