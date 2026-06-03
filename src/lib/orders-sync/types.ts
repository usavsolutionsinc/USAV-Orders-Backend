export interface TransferOrderDetail {
  orderId: string;
  productTitle: string;
  sku: string;
  itemNumber: string;
  tracking: string;
  titleSource: 'sheet' | 'sku_catalog' | 'platform_lookup' | 'none';
  /**
   * For `updated` / `deleted` rows: the original order's account_source and
   * created_at. Lets the dialog show provenance like "originally inserted by
   * Ecwid on 2026-05-20" so users can tell *why* a sheet row matched an
   * existing DB row instead of inserting a new one.
   */
  existingAccountSource?: string | null;
  existingCreatedAt?: string | null;
}

export interface TransferOrderDetails {
  inserted: TransferOrderDetail[];
  updated: TransferOrderDetail[];
  deleted: TransferOrderDetail[];
  unknownTitle: TransferOrderDetail[];
  /**
   * Rows whose sheet tracking value could not be recognized as a carrier
   * tracking number (carrier detection failed — e.g. a double-scanned or
   * malformed value). These are NOT linked to any shipment, so they surface
   * as a warning instead of silently disappearing.
   */
  unresolvedTracking: TransferOrderDetail[];
}

export interface OrderExceptionResolutionDetail {
  exceptionId: number;
  tracking: string;
  matchedOrderId?: number;
  sourceStation?: string | null;
}

export type SyncTaskStatus = 'idle' | 'running' | 'done' | 'error';

export interface TransferTabState {
  status: SyncTaskStatus;
  summary?: string;
  details?: TransferOrderDetails | null;
  error?: string;
  tabName?: string;
  inserted?: number;
  updated?: number;
  deleted?: number;
  /** How many of the `updated` rows were tracking-number attachments. */
  trackingAttached?: number;
  /** Rows whose tracking value failed carrier detection (not linked). */
  unresolvedTracking?: number;
  processedRows?: number;
}

export interface ExceptionsTabState {
  status: SyncTaskStatus;
  summary?: string;
  resolved?: OrderExceptionResolutionDetail[];
  stillOpen?: OrderExceptionResolutionDetail[];
  scanned?: number;
  matched?: number;
  error?: string;
  phase?: SyncPhase;
}

/**
 * Phases emitted by the transfer / exception sync jobs. Used to drive the
 * dialog's "Status…" labels while a long-running step is in flight.
 */
export type SyncPhase =
  | 'starting'
  | 'fetching_sheet'
  | 'fetching_ecwid'
  | 'resolving_tracking'
  | 'matching_orders'
  | 'inserting'
  | 'updating'
  | 'publishing'
  | 'scanning_exceptions'
  | 'done';

/**
 * NDJSON events streamed back from /api/google-sheets/transfer-orders,
 * /api/ecwid/transfer-orders, and /api/orders-exceptions/sync. Each line of
 * the response body is one JSON event.
 */
export type SyncStreamEvent =
  | { type: 'phase'; phase: SyncPhase; message?: string; count?: number }
  | { type: 'detail'; kind: 'inserted' | 'updated' | 'deleted' | 'unknownTitle' | 'unresolvedTracking'; row: TransferOrderDetail }
  | { type: 'exception'; kind: 'resolved' | 'open'; row: OrderExceptionResolutionDetail }
  | { type: 'result'; result: Record<string, unknown> }
  | { type: 'error'; error: string };

/** Progress callback handed to the underlying jobs. Returns void; errors are swallowed. */
export type SyncProgress = (event: SyncStreamEvent) => void;
