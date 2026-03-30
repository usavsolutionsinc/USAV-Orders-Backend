export function parseSerialRows(value: string | null | undefined): string[] {
  const rows = String(value || '')
    .split(',')
    .map((serial) => serial.trim())
    .filter(Boolean);

  return rows.length > 0 ? rows : [''];
}

export function patchSerialNumberInData(current: any, rowId: number, serialNumber: string): any {
  if (!current) return current;

  const patchRow = (row: any) => {
    if (!row || Number(row.id) !== rowId) return row;
    return {
      ...row,
      serial_number: serialNumber,
      serialNumber,
    };
  };

  if (Array.isArray(current)) return current.map(patchRow);
  if (Array.isArray(current?.orders)) return { ...current, orders: current.orders.map(patchRow) };
  if (Array.isArray(current?.results)) return { ...current, results: current.results.map(patchRow) };
  if (Array.isArray(current?.shipped)) return { ...current, shipped: current.shipped.map(patchRow) };

  return patchRow(current);
}
