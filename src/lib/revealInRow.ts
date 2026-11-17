/** Scrolls `row` sideways just enough to show `item` whole, when the row overflows. The page itself never moves. */
export function revealInRow(row: HTMLElement, item: HTMLElement): void {
  if (row.scrollWidth <= row.clientWidth) return;
  const r = row.getBoundingClientRect(), i = item.getBoundingClientRect();
  if (i.left < r.left) row.scrollLeft -= r.left - i.left;
  else if (i.right > r.right) row.scrollLeft += i.right - r.right;
}
