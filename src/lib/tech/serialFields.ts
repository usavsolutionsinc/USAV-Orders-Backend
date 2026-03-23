/**
 * Legacy tech_serial_numbers rows sometimes store multiple serials in one comma-separated field.
 * Always split before duplicate checks and aggregation.
 */
export function parseSerialCsvField(value: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(value || '').split(',')) {
    const u = part.trim().toUpperCase();
    if (u && !seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}

/** Deduped union of serials from many TSN rows (each value may be CSV). */
export function mergeSerialsFromTsnRows(rows: Array<{ serial_number?: string | null }>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    for (const s of parseSerialCsvField(row.serial_number)) {
      if (!seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    }
  }
  return out;
}
