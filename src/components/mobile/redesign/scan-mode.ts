import { classifyInput } from '@/lib/scan-resolver';
import {
  looksLikeReceivingRef,
  looksLikePoNumber,
  looksLikeUnitId,
} from '@/lib/testing/resolve-testing-scan';

/**
 * The three jobs the mobile Universal Scan page does, each keyed off a uniquely
 * formatted label:
 *   - receiving — a real carrier tracking number (first scan-in at the door)
 *   - testing   — a PO/carton label (`R-####` / `RCV-####` / `PO-####`)
 *   - cms       — a product/unit label (`SKU-YYWW-SEQ` or a unit serial)
 */
export type ScanMode = 'receiving' | 'testing' | 'cms';

/**
 * Best-effort mode detection from a scanned value's format. Returns null when
 * the format is ambiguous so the caller can keep the operator's current mode.
 *
 * Composed entirely from existing classifiers — no new regex:
 *   - looksLikeReceivingRef / looksLikePoNumber  (resolve-testing-scan)
 *   - looksLikeUnitId                            (resolve-testing-scan)
 *   - classifyInput().type                       (scan-resolver / carrier patterns)
 */
export function detectScanMode(raw: string): ScanMode | null {
  const v = (raw ?? '').trim();
  if (!v) return null;

  // TEST / demo shortcut → receiving. Mirrors the API's isTestTracking
  // (lookup-po) so a typed `TEST…` value reaches the instant-match test carton
  // instead of being mistaken for a partial serial and routed to CMS.
  if (/^TEST/i.test(v)) return 'receiving';

  // PO / carton handles → testing.
  if (looksLikeReceivingRef(v) || looksLikePoNumber(v)) return 'testing';

  // Printed unit label (SKU-YYWW-SEQ) → product/CMS view.
  if (looksLikeUnitId(v)) return 'cms';

  const classified = classifyInput(v);
  if (classified.type === 'tracking') return 'receiving';
  if (classified.type === 'serial_full' || classified.type === 'serial_partial') return 'cms';

  return null;
}
