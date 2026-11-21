/* Worker hours on a production order (TODO item 16): actual against budget, Start / Stop time per worker, entries. */
import { afterEach, describe, expect, test, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ProductionHours } from "../../vendor/scm/lib/production-order-queries";

const mutate = vi.fn();
let data: ProductionHours;
vi.mock("../../vendor/scm/lib/production-order-queries", async (original) => ({
  ...(await original<typeof import("../../vendor/scm/lib/production-order-queries")>()),
  useProductionHours: () => ({ data, isLoading: false, isError: false }),
  useProductionHoursAction: () => ({ mutate, isPending: false }),
}));
vi.mock("../../vendor/scm/components/NotifyDialog", () => ({ useNotify: () => vi.fn() }));
vi.mock("../../vendor/scm/components/ConfirmDialog", () => ({ useConfirm: () => vi.fn(async () => true) }));

import { ProductionHoursPanel, budgetWords, clockPeople, isoFromMyt, newEntryTimes, timeBoxOf } from "./ProductionHours";

const base = (over: Partial<ProductionHours> = {}): ProductionHours => ({
  budgetHours: 10,
  summary: { actualMinutes: 750, budgetMinutes: 600, varianceMinutes: 150, overBudget: true, running: 1, people: [
    { personKey: "tech-1", name: "Ali", minutes: 540, running: true, entries: 2 },
  ] },
  entries: [
    { id: "e1", person_key: "tech-1", name: "Ali", started_at: "2026-11-09T01:00:00Z", stopped_at: "2026-11-09T09:00:00Z", notes: null, how: "TIMER", minutes: 480, created_by_name: null, updated_by_name: null },
    { id: "e2", person_key: "tech-1", name: "Ali", started_at: "2026-11-10T01:15:00Z", stopped_at: null, notes: null, how: "TIMER", minutes: 60, created_by_name: null, updated_by_name: null },
  ],
  me: "user:9", canTime: true, canEnter: true, canSupervise: true, ...over,
});

beforeEach(() => { mutate.mockReset(); data = base(); });
afterEach(cleanup);

describe("helpers", () => {
  test("Malaysia times in and out of the time boxes", () => {
    expect(isoFromMyt("2026-11-10", "09:15")).toBe("2026-11-10T01:15:00.000Z");
    expect(timeBoxOf("2026-11-10T01:15:00Z")).toBe("09:15");
  });
  test("the budget line: over, left, none", () => {
    expect(budgetWords(base())).toEqual({ text: "2.5 h over budget", over: true });
    expect(budgetWords(base({ summary: { ...base().summary, varianceMinutes: -90, overBudget: false } }))).toEqual({ text: "1.5 h left", over: false });
    expect(budgetWords(base({ budgetHours: null, summary: { ...base().summary, varianceMinutes: null } }))).toEqual({ text: "No production time set", over: false });
  });
  test("click sweep F32: a new entry stops now, not at a fixed 5 pm that is in the future before 5 pm", () => {
    expect(newEntryTimes(new Date("2026-11-21T03:20:00Z"))).toEqual({ start: "08:00", stop: "11:20" });
    expect(newEntryTimes(new Date("2026-11-20T22:30:00Z"))).toEqual({ start: "05:30", stop: "06:30" });
    expect(newEntryTimes(new Date("2026-11-20T16:20:00Z"))).toEqual({ start: "00:00", stop: "00:20" });
  });
  test("you first, then each worker once", () => {
    const people = clockPeople(base(), [{ id: "w1", person_key: "tech-1", name: "Ali", trade: null, how: "ASSIGNED" }], "You");
    expect(people.map((p) => p.key)).toEqual(["user:9", "tech-1"]);
  });
});

describe("the panel", () => {
  const workers = [{ id: "w1", person_key: "tech-1", name: "Ali", trade: null, how: "ASSIGNED" as const }];
  test("shows budget, actual, and who is on the clock; Stop and Start send the right person", () => {
    render(<ProductionHoursPanel orderId="o1" workers={workers} canAct />);
    expect(screen.getByText("10 h")).toBeTruthy();
    expect(screen.getByText("12.5 h")).toBeTruthy();
    expect(screen.getByText("2.5 h over budget")).toBeTruthy();
    expect(screen.getByText("On the clock since 9:15")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop time" }));
    expect(mutate.mock.calls[0]![0]).toEqual({ kind: "stop", personKey: "tech-1" });
    fireEvent.click(screen.getByRole("button", { name: "Start time" }));
    expect(mutate.mock.calls[1]![0]).toEqual({ kind: "start", personKey: "user:9" });
  });
  test("no buttons for someone who may only look, or once timing is closed", () => {
    render(<ProductionHoursPanel orderId="o1" workers={workers} canAct={false} />);
    expect(screen.queryByRole("button", { name: /time$/ })).toBeNull();
    expect(screen.queryByText("Add time")).toBeNull();
  });
  test("Add time sends a typed entry in Malaysia time", () => {
    data = base({ canTime: false });
    render(<ProductionHoursPanel orderId="o1" workers={workers} canAct />);
    expect(screen.queryByRole("button", { name: "Start time" })).toBeNull();
    fireEvent.click(screen.getByText("Add time"));
    fireEvent.change(screen.getByLabelText("Worker"), { target: { value: "tech-1" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-09" } });
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "13:00" } });
    fireEvent.change(screen.getByLabelText("Stop"), { target: { value: "15:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mutate.mock.calls[0]![0]).toEqual({ kind: "add", personKey: "tech-1", startedAt: "2026-11-09T05:00:00.000Z", stoppedAt: "2026-11-09T07:30:00.000Z", notes: "" });
  });
  test("click sweep F32: Add time with the defaults sends a stop that is not in the future", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-21T03:20:00Z"));
    try {
      data = base({ canTime: false });
      render(<ProductionHoursPanel orderId="o1" workers={workers} canAct />);
      fireEvent.click(screen.getByText("Add time"));
      expect((screen.getByLabelText("Stop") as HTMLInputElement).value).toBe("11:20");
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(mutate.mock.calls[0]![0]).toMatchObject({ kind: "add", startedAt: "2026-11-21T00:00:00.000Z", stoppedAt: "2026-11-21T03:20:00.000Z" });
    } finally {
      vi.useRealTimers();
    }
  });
  test("click sweep F32: a double-click on Save sends one entry", () => {
    data = base({ canTime: false });
    render(<ProductionHoursPanel orderId="o1" workers={workers} canAct />);
    fireEvent.click(screen.getByText("Add time"));
    const save = screen.getByRole("button", { name: "Save" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(mutate).toHaveBeenCalledTimes(1);
  });
  test("review fix 4: a worker who is not a supervisor clocks only themselves and cannot change entries", () => {
    data = base({ canSupervise: false });
    render(<ProductionHoursPanel orderId="o1" workers={workers} canAct />);
    expect(screen.queryByRole("button", { name: "Stop time" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Start time" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Start time" }));
    expect(mutate.mock.calls[0]![0]).toEqual({ kind: "start", personKey: "user:9" });
    expect(screen.queryByText("Add time")).toBeNull();
    expect(screen.queryByText("Edit")).toBeNull();
  });
  test("review fix 6: a running timer can still be stopped after timing has closed", () => {
    data = base({ canTime: false });
    render(<ProductionHoursPanel orderId="o1" workers={[]} canAct />);
    fireEvent.click(screen.getByRole("button", { name: "Stop time" }));
    expect(mutate.mock.calls[0]![0]).toEqual({ kind: "stop", personKey: "tech-1" });
  });
  test("second review 1: the once-a-minute re-read does not reset what is typed in Add time", () => {
    data = base({ canTime: false });
    const view = render(<ProductionHoursPanel orderId="o1" workers={workers} canAct />);
    fireEvent.click(screen.getByText("Add time"));
    fireEvent.change(screen.getByLabelText("Worker"), { target: { value: "tech-1" } });
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "13:00" } });
    /* The hours come back with new figures (a timer counting up): a fresh object, new people list. */
    data = base({ canTime: false, summary: { ...base().summary, actualMinutes: 760 } });
    view.rerender(<ProductionHoursPanel orderId="o1" workers={[...workers]} canAct />);
    expect((screen.getByLabelText("Worker") as HTMLSelectElement).value).toBe("tech-1");
    expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe("13:00");
  });
  test("second review: someone who left the order is not offered in Add time (the server would refuse them)", () => {
    data = base({ canTime: false });
    render(<ProductionHoursPanel orderId="o1" workers={[]} canAct />);
    fireEvent.click(screen.getByText("Add time"));
    const options = [...(screen.getByLabelText("Worker") as HTMLSelectElement).options].map((o) => o.value);
    expect(options).toEqual(["user:9"]);
  });
});
