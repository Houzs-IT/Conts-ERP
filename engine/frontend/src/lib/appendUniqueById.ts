export function appendUniqueById<Row extends { id: string }>(
  loadedRows: readonly Row[],
  incomingRows: readonly Row[],
): Row[] {
  const seenIds = new Set(loadedRows.map((row) => row.id));
  const freshRows = incomingRows.filter((row) => {
    if (seenIds.has(row.id)) return false;
    seenIds.add(row.id);
    return true;
  });
  return [...loadedRows, ...freshRows];
}
