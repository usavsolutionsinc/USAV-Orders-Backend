import type { SkuPlatformMapping } from '@/components/inventory/SkuIdentity';

// ─── Types (mirror the picking API response) ─────────────────────────────────

export interface PickTask {
  allocationId: number;
  serialUnitId: number;
  serialNumber: string | null;
  lineId: number;
  sku: string;
  productTitle: string | null;
  bin: string | null;
  conditionGrade: string | null;
  plannedQty: number;
  currentState: string;
  platforms: SkuPlatformMapping[];
}

export interface PickOrder {
  orderId: number;
  orderLabel: string;
  customerInitials: string;
  shipByDate: string | null;
  tasks: PickTask[];
}

/**
 * Scan-gate validator. Confirms the scanned value identifies the right
 * pick before we commit. Accepts (in priority order):
 *
 *   serial   — exact match against the unit's serial_number barcode
 *   bin      — exact match against the bin barcode (e.g. 'UNSORTED', 'A-12')
 *   url      — internal mobile QR pointing at the unit (/m/u/{serialUnitId})
 *   sku      — exact match against the canonical SKU
 *   platform — exact match against any platform_sku / platform_item_id on
 *              the SKU's marketplace mappings (Amazon MSKU/ASIN, Ecwid SKU,
 *              etc.). Lets pickers scan the marketplace label on the
 *              package rather than always finding the bin barcode.
 *
 * Returns null when nothing matches → caller surfaces a mismatch toast and
 * does NOT call confirm-pick. Comparison is case-insensitive and trimmed.
 */
export function matchScanToTask(
  rawScan: string,
  task: PickTask,
): 'serial' | 'bin' | 'url' | 'sku' | 'platform' | null {
  const scan = rawScan.trim();
  if (!scan) return null;
  const lower = scan.toLowerCase();
  if (task.serialNumber && task.serialNumber.trim().toLowerCase() === lower) return 'serial';
  if (task.bin && task.bin.trim().toLowerCase() === lower) return 'bin';
  // Internal mobile QR convention: https://<host>/m/u/<serialUnitId>
  // Match by path only so the host can vary (prod/preview/local).
  if (scan.includes('/m/u/')) {
    const m = scan.match(/\/m\/u\/(\d+)(?:[/?#]|$)/);
    if (m && Number(m[1]) === task.serialUnitId) return 'url';
  }
  if (task.sku && task.sku.trim().toLowerCase() === lower) return 'sku';
  for (const p of task.platforms) {
    if (p.platformSku && p.platformSku.trim().toLowerCase() === lower) return 'platform';
    if (p.platformItemId && p.platformItemId.trim().toLowerCase() === lower) return 'platform';
  }
  return null;
}
