import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ListPager } from "./ListPager";

afterEach(cleanup);

describe("ListPager", () => {
  test("moves a page beyond the last back to the last page", () => {
    const onPageChange = vi.fn();
    render(<ListPager page={5} pageSize={25} total={30} onPageChange={onPageChange} />);
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  test("leaves an in-range page alone", () => {
    const onPageChange = vi.fn();
    render(<ListPager page={1} pageSize={25} total={30} onPageChange={onPageChange} />);
    expect(onPageChange).not.toHaveBeenCalled();
  });

  test("leaves the page alone while total is still 0", () => {
    const onPageChange = vi.fn();
    render(<ListPager page={5} pageSize={25} total={0} onPageChange={onPageChange} />);
    expect(onPageChange).not.toHaveBeenCalled();
  });
});
