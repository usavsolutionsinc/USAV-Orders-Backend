'use client';

/**
 * Serial-match result band for the RETURN receiving flow.
 *
 * When a line's receiving type is RETURN, committing a serial (Enter / barcode
 * scan) runs an exact lookup against `serial_units`. This renders the outcome
 * directly under the SERIAL input on the design-system {@link InlineNotice}
 * surface, with the matched unit's facts shown as the same rounded ring-inset
 * pills the condition picker uses:
 *
 *   idle       → nothing (no serial checked yet)
 *   searching  → neutral notice + spinner ("Checking serial…")
 *   found      → success notice + the unit's status / SKU / grade / bin pills.
 *                A unit whose prior status is SHIPPED is a genuine return — we
 *                badge it "Returned item".
 *   not-found  → warning notice ("No match found").
 *
 * Presentational only: state + data are owned by the caller (see
 * {@link useSerialLookup} for the fetch side).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2 } from '@/components/Icons';
import { InlineNotice } from '@/design-system/components';
import { Button } from '@/design-system/primitives';
import { ListingUrlChip } from '@/components/ui/CopyChip';
import { getExternalUrlByItemNumber } from '@/utils/external-item-url';

export type SerialMatchState = 'idle' | 'searching' | 'found' | 'not-found';

export interface SerialMatchUnit {
  serial_number: string;
  sku: string | null;
  current_status: string;
  condition_grade: string | null;
  current_location: string | null;
  updated_at: string | null;
  /** Matched unit was previously SHIPPED → this is a genuine return. */
  is_return: boolean;
}

/**
 * The original sales order a returned serial was shipped on, resolved by
 * `/api/serial-units/lookup` (order_unit_allocations → orders). Present only
 * when the matched unit is a genuine return AND we can trace its order.
 */
export interface SerialMatchedOrder {
  order_id: string | null;
  /** Marketplace item number → the listing link (opens in a new page). */
  item_number?: string | null;
  /** Server-built listing URL (from item_number); present on the scan response. */
  listing_url?: string | null;
  /** Channel/platform the unit sold on (ebay/amazon/...). */
  account_source?: string | null;
  product_title: string | null;
  sku: string | null;
  condition: string | null;
  tracking_number: string | null;
  allocation_state: string | null;
}

/** Human label for an enum-ish value (current_status / condition_grade). */
function prettyEnum(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Fact chip — same rounded ring-inset, uppercase-black language as the
 * condition pills, sized down for a metadata row.
 */
function MetaPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-card px-2 py-0.5 text-micro font-black uppercase tracking-[0.1em] text-emerald-800 ring-1 ring-inset ring-emerald-200">
      <span className="text-emerald-500/70">{label}</span>
      <span>{value}</span>
    </span>
  );
}

export function SerialMatchResult({
  state,
  unit,
  serial,
  matchedOrder,
  onFileClaim,
  className,
}: {
  state: SerialMatchState;
  /** Present when state === 'found'. */
  unit?: SerialMatchUnit | null;
  /** The serial that was searched — echoed on the not-found row. */
  serial?: string;
  /** Original shipped order for a returned serial (found + is_return). */
  matchedOrder?: SerialMatchedOrder | null;
  /**
   * When provided and the match is a genuine return, renders a "File return
   * claim" CTA. The caller pairs the order with the carton + opens the
   * prefilled claim modal.
   */
  onFileClaim?: (matchedOrder: SerialMatchedOrder | null) => void;
  className?: string;
}) {
  if (state === 'idle') return null;

  if (state === 'searching') {
    return (
      <InlineNotice
        tone="neutral"
        size="sm"
        className={className}
        icon={<Loader2 className="h-4 w-4 animate-spin text-text-faint" />}
      >
        Checking serial…
      </InlineNotice>
    );
  }

  if (state === 'not-found') {
    return (
      <InlineNotice
        tone="warning"
        size="sm"
        className={className}
        title="Returned serial — no order match"
        icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
      >
        {serial ? (
          <>
            Serial <span className="font-mono font-semibold">{serial}</span> has no
            sales-order match. It&apos;s recorded for review — keep going; just double-check
            the serial, or that the item is ours.
          </>
        ) : (
          'This returned serial has no sales-order match. It’s recorded for review — keep going; just double-check the serial, or that the item is ours.'
        )}
      </InlineNotice>
    );
  }

  // state === 'found'
  const isReturn = !!unit?.is_return;
  // Listing link built from the order's item number — the exact shipped-details
  // mechanism (getExternalUrlByItemNumber → open in a new page).
  const listingUrl = matchedOrder ? getExternalUrlByItemNumber(matchedOrder.item_number) : null;
  return (
    <InlineNotice
      tone="success"
      size="sm"
      className={className}
      icon={<Check className="h-4 w-4 text-emerald-500" />}
      title={
        <span className="flex items-center gap-2">
          Match found
          {isReturn ? (
            <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-micro font-black uppercase tracking-[0.1em] text-emerald-700 ring-1 ring-inset ring-emerald-500/25">
              Returned item
            </span>
          ) : null}
        </span>
      }
    >
      {unit ? (
        <div className="space-y-2">
          {/* Originating order — the headline of a return match. Shows the
              product title we shipped + the order # so the operator can
              confirm the pairing before filing a claim. */}
          {isReturn && matchedOrder && (matchedOrder.product_title || matchedOrder.order_id) ? (
            <div className="rounded-lg bg-surface-card/70 px-2.5 py-2 ring-1 ring-inset ring-emerald-200">
              {matchedOrder.product_title ? (
                // Truncation reveal of the full product title on a non-interactive clipped <p>.
                // ds-allow-title
                <p className="truncate text-label font-bold text-emerald-900" title={matchedOrder.product_title}>
                  {matchedOrder.product_title}
                </p>
              ) : null}
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {matchedOrder.order_id ? (
                  <MetaPill label="Order" value={matchedOrder.order_id} />
                ) : null}
                {matchedOrder.condition ? (
                  <MetaPill label="Sold as" value={prettyEnum(matchedOrder.condition)} />
                ) : null}
                {matchedOrder.tracking_number ? (
                  <MetaPill label="Shipped" value={matchedOrder.tracking_number.slice(-8)} />
                ) : null}
              </div>
              {/* Listing link — opens the marketplace listing in a new page,
                  resolved from the order's item number (shipped-details parity). */}
              {listingUrl ? (
                <div className="mt-1.5 flex items-center gap-1">
                  <ListingUrlChip rawUrl={listingUrl} openHref={listingUrl} previewDisplay="View listing" />
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            <MetaPill label="Status" value={prettyEnum(unit.current_status)} />
            {unit.sku ? <MetaPill label="SKU" value={unit.sku} /> : null}
            {unit.condition_grade ? (
              <MetaPill label="Grade" value={prettyEnum(unit.condition_grade)} />
            ) : null}
            {unit.current_location ? (
              <MetaPill label="Bin" value={unit.current_location} />
            ) : null}
          </div>
          {/* Return CTA — pairs the order with the carton + opens a prefilled
              claim for the operator to review. Only for genuine returns. */}
          {isReturn && onFileClaim ? (
            <Button
              size="sm"
              onClick={() => onFileClaim(matchedOrder ?? null)}
              iconRight={<span aria-hidden>→</span>}
              className="bg-emerald-600 text-micro font-black uppercase tracking-wider text-white hover:bg-emerald-700 active:bg-emerald-700"
            >
              File return claim
            </Button>
          ) : null}
        </div>
      ) : (
        'This serial is already in our records.'
      )}
    </InlineNotice>
  );
}

/* ───────────────────────────── fetch hook ───────────────────────────────── */

interface SerialLookupResponse {
  success?: boolean;
  found?: boolean;
  is_return?: boolean;
  unit?: SerialMatchUnit | null;
  matched_order?: SerialMatchedOrder | null;
}

/**
 * Latest-wins serial lookup. `check(serial)` fires `GET
 * /api/serial-units/lookup`, aborting any in-flight request first so a fast
 * scan stream only ever resolves to the most recent serial. Exposes the
 * presentational state for {@link SerialMatchResult}.
 */
export function useSerialLookup() {
  const [state, setState] = useState<SerialMatchState>('idle');
  const [unit, setUnit] = useState<SerialMatchUnit | null>(null);
  const [matchedOrder, setMatchedOrder] = useState<SerialMatchedOrder | null>(null);
  const [serial, setSerial] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState('idle');
    setUnit(null);
    setMatchedOrder(null);
    setSerial('');
  }, []);

  const check = useCallback(async (raw: string) => {
    const trimmed = (raw ?? '').trim();
    abortRef.current?.abort();
    if (!trimmed) {
      abortRef.current = null;
      setState('idle');
      setUnit(null);
      setSerial('');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setSerial(trimmed);
    setState('searching');
    setUnit(null);
    setMatchedOrder(null);
    try {
      const res = await fetch(
        `/api/serial-units/lookup?serial=${encodeURIComponent(trimmed)}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      const data = (await res.json().catch(() => null)) as SerialLookupResponse | null;
      if (controller.signal.aborted) return;
      if (!res.ok || !data?.success) {
        // Treat a lookup error as inconclusive rather than a false "no match".
        setState('idle');
        return;
      }
      if (data.found && data.unit) {
        setUnit({ ...data.unit, is_return: !!data.is_return });
        setMatchedOrder(data.matched_order ?? null);
        setState('found');
      } else {
        setUnit(null);
        setMatchedOrder(null);
        setState('not-found');
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      setState('idle');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  /**
   * Drive the band straight from a scan-serial POST response — no second GET.
   * Lets a return detected on ANY line (not just a pre-typed RETURN) light up
   * the match band with the server-resolved + persisted originating order.
   */
  const applyResult = useCallback(
    (payload: {
      serial: string;
      found?: boolean;
      is_return?: boolean;
      unit?: SerialMatchUnit | null;
      matchedOrder?: SerialMatchedOrder | null;
    }) => {
      abortRef.current?.abort();
      abortRef.current = null;
      setSerial(payload.serial);
      if (payload.found && payload.unit) {
        setUnit({ ...payload.unit, is_return: !!payload.is_return });
        setMatchedOrder(payload.matchedOrder ?? null);
        setState('found');
      } else if (payload.found === false) {
        setUnit(null);
        setMatchedOrder(null);
        setState('not-found');
      }
    },
    [],
  );

  // Abort any in-flight request on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  return { state, unit, matchedOrder, serial, check, applyResult, reset };
}
