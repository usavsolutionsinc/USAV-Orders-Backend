'use client';

/**
 * Serial-scan flow for the receiving sidebar's Unbox mode: scan a serial into
 * the armed PO line, detect returns, optionally print a product label, and
 * broadcast the result to the main panel.
 *
 * Owns the serial input + the returns banner + the multi-candidate picker
 * state. Reads the active carton (`poContext`) and armed line as inputs (those
 * cells live in usePoContext). Extracted from ReceivingSidebarPanel; behaviour
 * is unchanged.
 */

import { useCallback, useRef, useState } from 'react';
import { useLocalStorage } from '@/hooks';
import { toast } from '@/lib/toast';
import { printProductLabel } from '@/lib/print/printProductLabel';
import {
  randomId,
  type PoContext,
  type PoLineSummary,
} from '@/components/sidebar/receiving/receiving-sidebar-shared';
import type { ReturnEvent } from '@/components/sidebar/ReceivingReturnBanner';

interface UseSerialScanArgs {
  poContext: PoContext | null;
  armedLineId: number | null;
  staffId: string;
}

export interface SerialScanState {
  serialInput: string;
  setSerialInput: React.Dispatch<React.SetStateAction<string>>;
  serialInputRef: React.RefObject<HTMLInputElement | null>;
  serialSubmitting: boolean;
  returns: ReturnEvent[];
  pendingCandidates: PoLineSummary[];
  setPendingCandidates: React.Dispatch<React.SetStateAction<PoLineSummary[]>>;
  submitSerialScan: (explicitLineId?: number, rawSerial?: string) => Promise<void>;
  dismissReturn: (id: string) => void;
  clearReturns: () => void;
  /** Clear the serial input + pending candidates (used when clearing a carton). */
  resetSerialInputs: () => void;
}

export function useSerialScan({
  poContext,
  armedLineId,
  staffId,
}: UseSerialScanArgs): SerialScanState {
  const [serialInput, setSerialInput] = useState('');
  const [serialSubmitting, setSerialSubmitting] = useState(false);
  const [returns, setReturns] = useState<ReturnEvent[]>([]);
  const [pendingCandidates, setPendingCandidates] = useState<PoLineSummary[]>([]);
  // Read-only setting (no toggle in this panel); persisted format is compatible
  // with the prior hand-rolled 'true'/'false' string.
  const [printOnScan] = useLocalStorage('receiving.printOnScan', true);
  const serialInputRef = useRef<HTMLInputElement>(null);

  const submitSerialScan = useCallback(
    async (explicitLineId?: number, rawSerial?: string) => {
      const serial = (rawSerial ?? serialInput).trim();
      if (!serial || !poContext || serialSubmitting) return;

      setSerialSubmitting(true);
      setPendingCandidates([]);

      const effectiveLineId = explicitLineId ?? armedLineId;

      try {
        const res = await fetch('/api/receiving/scan-serial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            receiving_id: poContext.receiving_id,
            receiving_line_id: effectiveLineId ?? undefined,
            serial_number: serial,
            staff_id: Number(staffId),
          }),
        });
        const data = await res.json();

        if (data?.needs_line_selection) {
          setPendingCandidates(data.candidate_lines || []);
          return;
        }

        if (!data?.success) {
          toast.error(data?.error || `Scan failed (${res.status})`);
          return;
        }

        // Same serial already on this line — friendly no-op. Serials are
        // sidecar metadata, so this never affects quantity.
        if (data.already_attached) {
          toast.info(`Already added — ${serial}`);
          setSerialInput('');
          setTimeout(() => serialInputRef.current?.focus(), 40);
          return;
        }

        const state: {
          id: number;
          sku: string | null;
          item_name: string | null;
          quantity_received: number;
          quantity_expected: number | null;
          workflow_status?: string | null;
          is_complete: boolean;
        } = data.line_state;

        // Clear input immediately for the next scan
        setSerialInput('');

        // Return detection banner
        if (data.is_return) {
          setReturns((prev) =>
            [
              {
                id: randomId(),
                serial_number: serial,
                line_id: state.id,
                sku: state.sku,
                prior_status: data.prior_status ?? null,
                // Originating order resolved server-side on the scan (shipped↔returned).
                order_id: data.matched_order?.order_id ?? null,
                at: Date.now(),
              },
              ...prev,
            ].slice(0, 3),
          );
        }

        // Print-on-scan (unboxing only, opt-out via toggle)
        if (printOnScan && state.sku) {
          printProductLabel({
            sku: state.sku,
            title: state.item_name ?? undefined,
            serialNumber: serial,
          });
        }

        // Broadcast to main panel so the chip list refreshes. Quantity is
        // unchanged by a serial scan — no qty payload here.
        window.dispatchEvent(
          new CustomEvent('receiving-serial-scanned', {
            detail: {
              line_id: state.id,
              serial_unit: data.serial_unit,
              is_return: !!data.is_return,
            },
          }),
        );

        setTimeout(() => serialInputRef.current?.focus(), 40);
      } catch {
        /* silently fail — user can re-scan */
      } finally {
        setSerialSubmitting(false);
      }
    },
    [serialInput, poContext, armedLineId, serialSubmitting, staffId, printOnScan],
  );

  const dismissReturn = useCallback((id: string) => {
    setReturns((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const clearReturns = useCallback(() => setReturns([]), []);

  const resetSerialInputs = useCallback(() => {
    setPendingCandidates([]);
    setSerialInput('');
  }, []);

  return {
    serialInput,
    setSerialInput,
    serialInputRef,
    serialSubmitting,
    returns,
    pendingCandidates,
    setPendingCandidates,
    submitSerialScan,
    dismissReturn,
    clearReturns,
    resetSerialInputs,
  };
}
