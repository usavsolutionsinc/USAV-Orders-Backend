'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShippedOrderCompare } from '@/lib/receiving/returned-serial-link';

/**
 * Data layer behind the "Order #" search lane in {@link UnfoundMatchStrip}.
 *
 * `search(orderNumber)` fires `GET /api/receiving/shipped-order-lookup`,
 * aborting any in-flight request first (latest-wins), and resolves to the
 * shipped order + serial-compare against the carton's received serial. Read-only
 * — this never mutates; the operator links (import-sales-order) or tickets from
 * the resolved display. Mirrors {@link useUnfoundRefetchActions} in shape so the
 * three Auto-match lanes stay symmetric.
 */

export type CompareStatus = 'idle' | 'loading' | 'found' | 'not-found' | 'error';

export interface CompareState {
  status: CompareStatus;
  /** Short human message for the inline notice (null while idle/loading/found). */
  message: string | null;
  /** The resolved order + serial compare, present on 'found' (and 'not-found'). */
  result: ShippedOrderCompare | null;
}

const IDLE: CompareState = { status: 'idle', message: null, result: null };

export function useShippedOrderCompare() {
  const [state, setState] = useState<CompareState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(IDLE);
  }, []);

  const search = useCallback(
    async (orderNumber: string, receivedSerial?: string | null) => {
      const trimmed = (orderNumber ?? '').trim();
      abortRef.current?.abort();
      if (!trimmed) {
        abortRef.current = null;
        setState(IDLE);
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setState({ status: 'loading', message: null, result: null });
      try {
        const qs = new URLSearchParams({ order_number: trimmed });
        const serial = (receivedSerial ?? '').trim();
        if (serial) qs.set('received_serial', serial);
        const res = await fetch(`/api/receiving/shipped-order-lookup?${qs.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const data = (await res.json().catch(() => null)) as
          | (ShippedOrderCompare & { success?: boolean; error?: string })
          | null;
        if (controller.signal.aborted) return;
        if (!res.ok || !data?.success) {
          setState({ status: 'error', message: data?.error || 'Lookup failed', result: null });
          return;
        }
        if (!data.found) {
          setState({ status: 'not-found', message: `No shipped order “${trimmed}”.`, result: data });
          return;
        }
        setState({ status: 'found', message: null, result: data });
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Lookup failed',
          result: null,
        });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [],
  );

  // Abort any in-flight request on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  return { state, search, reset };
}
