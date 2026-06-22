/**
 * Two-step mobile packer scan state machine (P1-MOB-01).
 *
 * The packer flow auto-progresses on scan states:
 *   scan 1 (order# / tracking)  →  ORDER_DETAILS  (who/what/where to ship)
 *   scan 2 (product / SKU label) → WHAT_TO_PACK    (the pre-packed line for that SKU)
 *
 * Modelled as a tiny explicit, fully-typed reducer rather than pulling in XState
 * — the repo has no xstate dependency and the rest of the mobile scan surface
 * (UniversalScan) drives mode progression with plain typed React state, so this
 * matches the house idiom. The states/events are still an explicit machine so
 * the progression is auditable and reversible.
 *
 * Read-only: this module never mints or mutates a serial. It only classifies a
 * scan and tracks which step the operator is on; data fetching lives in the
 * caller (reusing resolveTestingScan / orders-lookup / get-title-by-sku).
 */

import { classifyInput, parseScannedUrl } from '@/lib/scan-resolver';
import {
  looksLikeUnitId,
  looksLikeReceivingCode,
} from '@/lib/testing/resolve-testing-scan';

/** Where the packer is in the two-scan flow. */
export type PackScanStateName = 'idle' | 'order_details' | 'what_to_pack';

/** A scan classified into the role it plays in the packer flow. */
export type PackScanKind = 'order' | 'product' | 'unknown';

/**
 * Classify a raw scan into the role it plays in the two-step packer flow,
 * composed entirely from existing classifiers (no new regex):
 *
 *   order   — a carrier tracking number, a GS1 `order` Digital-Link URL, or any
 *             plain alphanumeric token that isn't a recognised product code
 *             (an order number / packing-slip reference). This anchors scan 1.
 *   product — a printed unit-id ({SKU}-{YYWW}-{SEQ6}), a canonical receiving
 *             code (R-/L-/U-/H- handle, GS1 unit URL), a full/partial serial,
 *             or a `stock` SKU URL. This is the "what to pack" identity (scan 2).
 *   unknown — empty input.
 *
 * The order-vs-product split mirrors how the packer physically works: the first
 * scan is the shipment/order label on the slip; the second is the product's own
 * SKU/serial sticker. When ambiguous we lean toward `order` for the FIRST scan
 * (the caller passes the current step so a plain token after an order anchors as
 * a product SKU lookup) — see {@link classifyPackScan}.
 */
export function classifyPackScan(raw: string, step: PackScanStateName): PackScanKind {
  const v = (raw ?? '').trim();
  if (!v) return 'unknown';

  // Canonical product codes / printed unit ids / GS1 unit URLs → always product.
  if (looksLikeReceivingCode(v) || looksLikeUnitId(v)) return 'product';

  const url = parseScannedUrl(v);
  if (url?.type === 'unit' || url?.type === 'stock') return 'product';
  if (url?.type === 'order' || url?.type === 'package') return 'order';

  const classified = classifyInput(v);
  // A carrier tracking number is an order-level identity (packing slip).
  if (classified.type === 'tracking') return 'order';
  // A full/partial serial is a product identity.
  if (classified.type === 'serial_full' || classified.type === 'serial_partial') {
    return 'product';
  }

  // Ambiguous plain token (order number, SKU text, packing-slip ref). Use the
  // step as the tie-breaker: before an order is anchored the first scan is the
  // order; once anchored the next plain token is the product SKU to pack.
  return step === 'idle' ? 'order' : 'product';
}

export interface PackScanContext {
  /** The order identity from scan 1 (order_id string or tracking number). */
  orderRef: string | null;
  /** The product/SKU identity from scan 2. */
  productRef: string | null;
}

export interface PackScanState {
  name: PackScanStateName;
  context: PackScanContext;
}

export type PackScanEvent =
  | { type: 'SCAN'; raw: string; kind: PackScanKind }
  /** Operator backed out of the product step → back to the order details. */
  | { type: 'BACK' }
  /** Operator cleared the whole flow (e.g. closed the panel). */
  | { type: 'RESET' };

export const INITIAL_PACK_SCAN_STATE: PackScanState = {
  name: 'idle',
  context: { orderRef: null, productRef: null },
};

/**
 * Pure transition. Given the current state and an event, return the next state.
 *
 * Progression rules (the "auto-progresses on scan" behaviour):
 *   - An `order` scan ALWAYS (re)anchors the flow on that order → ORDER_DETAILS,
 *     clearing any prior product (a new order starts a fresh pack).
 *   - A `product` scan only advances once an order is anchored → WHAT_TO_PACK.
 *     Scanning a product with no order yet is ignored (stay idle) so the
 *     operator can't skip step 1.
 *   - `unknown` scans never change state (the caller surfaces a not-found hint).
 */
export function packScanReducer(state: PackScanState, event: PackScanEvent): PackScanState {
  switch (event.type) {
    case 'RESET':
      return INITIAL_PACK_SCAN_STATE;

    case 'BACK':
      // From the product step, drop back to the anchored order details.
      if (state.name === 'what_to_pack') {
        return {
          name: 'order_details',
          context: { orderRef: state.context.orderRef, productRef: null },
        };
      }
      // From order details, BACK clears the flow entirely.
      if (state.name === 'order_details') return INITIAL_PACK_SCAN_STATE;
      return state;

    case 'SCAN': {
      const ref = event.raw.trim();
      if (!ref) return state;

      if (event.kind === 'order') {
        // Scan 1 (or a re-anchor): always jump to order details, fresh product.
        return { name: 'order_details', context: { orderRef: ref, productRef: null } };
      }

      if (event.kind === 'product') {
        // Scan 2: only valid once an order is anchored.
        if (state.context.orderRef == null) return state;
        return {
          name: 'what_to_pack',
          context: { orderRef: state.context.orderRef, productRef: ref },
        };
      }

      // unknown → no transition.
      return state;
    }

    default:
      return state;
  }
}
