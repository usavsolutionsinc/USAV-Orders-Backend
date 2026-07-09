/**
 * Canonical scan-match key: uppercase + strip every non-alphanumeric, so a PO#
 * scanned as `po-1234` / `PO 1234` / `PO1234` all compare equal. This is the
 * same normal form the PO mirror keys on (`zoho_purchaseorder_number_norm`), and
 * it is also used for an exact tracking compare. Pure — shared by every rung.
 */
export function normalizeScanKey(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}
