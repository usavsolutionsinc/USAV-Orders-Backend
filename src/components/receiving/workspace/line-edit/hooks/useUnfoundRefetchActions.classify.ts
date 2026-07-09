/**
 * Pure response → UI-state classifiers for {@link useUnfoundRefetchActions}.
 *
 * Kept in a React-free module (no react / react-query / toast imports) so the
 * retry-pair and amazon-return-lookup UI-state mappings are unit-testable under
 * the repo's node `tsx --test` runner without a DOM.
 */

export type RefetchStatus =
  | 'idle'
  | 'loading'
  | 'matched'
  | 'no-match'
  | 'error'
  | 'unsupported';

export interface RefetchState {
  status: RefetchStatus;
  /** Short human message for the inline notice (null while idle/loading). */
  message: string | null;
}

export interface RefetchOutcome {
  state: RefetchState;
  /** True = a successful match → promote-in-place / invalidate feeds. */
  promote: boolean;
}

/** Map a POST /unfound-queue/retry-pair response to a card state. */
export function classifyZohoRetry(ok: boolean, data: unknown): RefetchOutcome {
  const d = (data ?? {}) as {
    success?: boolean;
    promoted?: boolean;
    zoho_purchaseorder_id?: unknown;
    error?: string;
  };
  if (!ok || !d.success) {
    return { state: { status: 'error', message: d.error || 'Re-check failed' }, promote: false };
  }
  if (d.promoted) {
    const poId = d.zoho_purchaseorder_id ? String(d.zoho_purchaseorder_id) : '';
    return {
      state: { status: 'matched', message: poId ? `Matched to PO ${poId}` : 'Matched to a PO' },
      promote: true,
    };
  }
  return {
    state: { status: 'no-match', message: 'Still no Zoho match — try again later, or link a PO manually.' },
    promote: false,
  };
}

/** Map a POST /[id]/amazon-return-lookup response to a card state. */
export function classifyAmazonLookup(status: number, ok: boolean, data: unknown): RefetchOutcome {
  const d = (data ?? {}) as {
    success?: boolean;
    matched?: boolean;
    unsupported?: boolean;
    customer_order_id?: string | null;
    error?: string;
  };
  // The connection lacks External Fulfillment (Seller Flex) authorization, or no
  // Amazon account is connected — a config gap, not a scan failure.
  if (status === 403 || d.unsupported) {
    return {
      state: {
        status: 'unsupported',
        message: d.error || 'Amazon Returns access is not enabled for this connection.',
      },
      promote: false,
    };
  }
  if (!ok || !d.success) {
    return { state: { status: 'error', message: d.error || 'Amazon lookup failed' }, promote: false };
  }
  if (d.matched) {
    const order = d.customer_order_id ? ` · order ${d.customer_order_id}` : '';
    return {
      state: { status: 'matched', message: `Amazon return found${order}. Carton tagged as Amazon Return.` },
      promote: true,
    };
  }
  return {
    state: { status: 'no-match', message: 'No matching Amazon return for this tracking.' },
    promote: false,
  };
}

const NOTICE_PRIORITY: Record<RefetchStatus, number> = {
  matched: 0,
  error: 1,
  unsupported: 1,
  'no-match': 2,
  loading: 98,
  idle: 99,
};

/** One inline banner for the strip — prefer matched, then errors, then no-match. */
export function pickMergedRefetchNotice(
  zoho: RefetchState,
  amazon: RefetchState,
): RefetchState | null {
  const active = [zoho, amazon].filter(
    (s) => s.status !== 'idle' && s.status !== 'loading' && s.message,
  );
  if (active.length === 0) return null;
  return [...active].sort(
    (a, b) => NOTICE_PRIORITY[a.status] - NOTICE_PRIORITY[b.status],
  )[0];
}
