/**
 * Backward-compatible wrapper around the canonical receiving_lines-first
 * Zoho inbound sync service.
 *
 * Legacy callers may still import from this module, but the implementation now
 * delegates to src/lib/zoho-receiving-sync.ts so purchase orders no longer
 * materialize synthetic receiving rows.
 */

export {
  importZohoPurchaseOrderToReceiving,
  syncZohoPurchaseOrdersToReceiving,
  type ImportPOResult,
  type BulkSyncOptions,
  type BulkSyncSummary,
} from '@/lib/zoho-receiving-sync';
