import type { SerialMatchedOrder } from '@/components/receiving/workspace/SerialMatchResult';

export interface UnfoundLine {
  id: number;
  sku: string | null;
  item_name: string | null;
  quantity_expected: number | null;
  quantity_received: number | null;
  condition_grade: string;
  workflow_status: string | null;
  listing_reference: string | null;
  location_code: string | null;
  image_url?: string | null;
  /** `/api/receiving/[id]` populates this when the carton has serials saved against any line. */
  serials?: Array<{ id: number; serial_number: string }>;
}

/** Helpers passed to a custom {@link UnmatchedItemsSectionProps.renderLineActions}. */
export interface UnmatchedLineRenderHelpers {
  /** Update condition_grade via /api/receiving/lines/[id]/condition. */
  onConditionChange: (next: string) => void;
  /** Optimistic-set + refresh trigger so the parent can know to refetch. */
  refresh: () => void;
}

export interface UnmatchedItemsSectionProps {
  receivingId: number;
  /** Staff id for serial scans (POST /api/receiving/scan-serial). */
  staffId?: string;
  sourcePlatformHint?: string;
  receivingTypeHint?: string;
  listingUrlHint?: string;
  /**
   * RETURN flow: a per-line serial that matched a shipped order fires this so
   * the parent can pair the order with the carton + open a prefilled claim.
   */
  onFileReturnClaim?: (matchedOrder: SerialMatchedOrder | null, serial: string) => void;
  /**
   * Fired whenever a condition grade is picked on this carton (per-line pill or
   * the carton-level serial-scan card). LineEditPanel mirrors it into the panel
   * `cond` state so the printed/previewed label reflects the operator's last
   * grade — matched cartons report this up via ActiveLineConditionSerial, so
   * without it the label would never update for an unfound carton.
   */
  onActiveConditionChange?: (condition: string) => void;
  /**
   * Optional render override for the per-line action area (replaces the
   * default `ConditionPills` + serial card). Use this from the testing
   * workspace to drop in `TestingStatusPills` + `InlineSerialAdder` per line so
   * an unmatched carton's items can be tested without round-tripping through
   * receiving. When omitted, the section keeps its default receiving behavior.
   */
  renderLineActions?: (line: UnfoundLine, helpers: UnmatchedLineRenderHelpers) => React.ReactNode;
  /** "Scan a serial number" card. Hidden in triage — serials are an unbox step. */
  showSerialScan?: boolean;
  /**
   * Triage only: header CTA that re-opens this carton in unbox mode (deep
   * link `/receiving?recvId=…`). Omitted in the unbox workspace itself.
   */
  onOpenInUnbox?: () => void;
  /**
   * Render bare (no own WorkspaceCard chrome, no add pencil) — used when
   * composed inside the unified {@link POUnboxingSection} wrapper, which
   * supplies the single shared card + edit pencil. Defaults to the standalone
   * card so the testing display and any other caller are unaffected.
   */
  embedded?: boolean;
  /**
   * Embedded-only: node rendered at the right of the "PO items · N" header row
   * (e.g. the wrapper's shared edit pencil), so the unified wrapper can place
   * its single control on the same row as the item count.
   */
  headerRight?: React.ReactNode;
  /**
   * Fired after an Ecwid/repair pairing flips the carton off the Unfound queue.
   * The host (which owns the selected `row`) uses it to update the open
   * LineEditPanel IMMEDIATELY from the server's returned row — no refetch wait:
   *   • `carton` → the recomputed PO#/source/platform for the carton header.
   *   • `line`   → the full new receiving_line. When the host was on an unfound
   *     STUB (synthetic negative id, no real line), it re-selects this real line
   *     so the detail pane upgrades from "Unfound PO" → the actual item (title,
   *     SKU, qty, listing) in one paint, then reconciles via invalidate.
   */
  onLinked?: (result: {
    carton: {
      zoho_purchaseorder_number: string | null;
      source: string | null;
      source_platform: string | null;
    };
    line?: {
      id: number;
      sku: string | null;
      item_name: string | null;
      quantity_expected: number | null;
      quantity_received: number;
      condition_grade: string | null;
      listing_url: string | null;
      source_platform_pill: string | null;
    } | null;
  }) => void;
}

export interface CartonResponse {
  success: boolean;
  lines?: UnfoundLine[];
  /**
   * Carton header — used to seed the door-classification pill row from the
   * stored intake columns (GET /api/receiving/[id] returns this). The
   * intake_type column maps onto `columnsToClassification`'s `receiving_type`.
   */
  receiving?: {
    is_return?: boolean | null;
    return_platform?: string | null;
    source_platform?: string | null;
    intake_type?: string | null;
  } | null;
  error?: string;
}

/**
 * Infer the sales platform from an order number's shape — Amazon order ids
 * are 3-7-7 digit groups, eBay's are 2-5-5. Anything else returns null (the
 * operator keeps whatever pill they set). Used to tag a return-matched carton
 * without a server round-trip; the order # itself is the authoritative link.
 */
export function inferPlatformFromOrderId(orderId: string): string | null {
  if (/^\d{3}-\d{7}-\d{7}$/.test(orderId)) return 'amazon';
  if (/^\d{2}-\d{5}-\d{5}$/.test(orderId)) return 'ebay';
  return null;
}
