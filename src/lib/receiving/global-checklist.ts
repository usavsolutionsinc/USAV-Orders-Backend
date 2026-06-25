/**
 * Global receiving checklist — the single shared fill-in checklist shown on
 * every receiving line's Checklist tab.
 *
 * This is the STARTING point: one org-wide default list that applies to every
 * carton/line regardless of SKU. The next step (per the receiving-checklist
 * plan) is per-SKU checklists sourced from `sku_catalog → qc-checks` (the same
 * QC display logic the Products → QC view uses); when a line's SKU has its own
 * QC checklist it will supersede this default. Keep the shape compatible with a
 * QC step (id + label) so the per-SKU swap is a data-source change, not a
 * component rewrite.
 */
export interface ReceivingChecklistItem {
  /** Stable id — used as the localStorage fill-state key per line. */
  id: string;
  label: string;
}

export const GLOBAL_RECEIVING_CHECKLIST: ReceivingChecklistItem[] = [
  { id: 'box-condition', label: 'Outer box / packaging condition acceptable' },
  { id: 'matches-listing', label: 'Item matches the PO / listing' },
  { id: 'quantity', label: 'Quantity verified against expected' },
  { id: 'serial', label: 'Serial number recorded' },
  { id: 'accessories', label: 'Accessories / kit contents complete' },
  { id: 'damage', label: 'No visible damage or defects' },
  { id: 'photos', label: 'Condition photos captured' },
  { id: 'powers-on', label: 'Powers on / basic function test' },
];
