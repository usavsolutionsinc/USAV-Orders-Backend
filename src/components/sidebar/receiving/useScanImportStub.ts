'use client';

/**
 * Optimistic "importing" rail row for scan surfaces (Unbox + Triage).
 *
 * Listens for `receiving-scan-importing` (dispatched at scan submit with the
 * tracking # + a client-minted `clientEventId`) and pins a transient row at the
 * top of the feed until `receiving-scan-resolved` + a short linger. The resolved
 * carton reconciles IN PLACE via `client_event_id` so the row morphs from
 * tracking# → PO title without a disappear-then-reappear flicker.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { safeRandomUUID } from '@/lib/safe-uuid';
import { buildUnmatchedStubRow } from './receiving-sidebar-shared';

// Synthetic receiving_id for the transient stub — max int32 so its negated row
// id can never collide with a real receiving row.
const IMPORTING_STUB_RECEIVING_ID = 2_147_483_647;

// Linger after resolve so the reconciled stub bridges until the feed row lands.
const STUB_LINGER_MS = 900;

export function useScanImportStub(resolvedLine: ReceivingLineRow | null) {
  const [importStub, setImportStub] = useState<ReceivingLineRow | null>(null);
  const importStubRef = useRef<ReceivingLineRow | null>(null);
  importStubRef.current = importStub;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onImporting = (e: Event) => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const detail = (e as CustomEvent<{ tracking?: string; clientEventId?: string }>).detail;
      const tracking = detail?.tracking?.trim() || '…';
      const clientEventId = detail?.clientEventId ?? safeRandomUUID();
      setImportStub({
        ...buildUnmatchedStubRow(IMPORTING_STUB_RECEIVING_ID, tracking),
        item_name: tracking,
        workflow_status: 'ARRIVED',
        client_event_id: clientEventId,
      });
    };
    const onResolved = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setImportStub(null), STUB_LINGER_MS);
    };
    window.addEventListener('receiving-scan-importing', onImporting);
    window.addEventListener('receiving-scan-resolved', onResolved);
    return () => {
      window.removeEventListener('receiving-scan-importing', onImporting);
      window.removeEventListener('receiving-scan-resolved', onResolved);
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const stub = importStubRef.current;
    if (!stub || !resolvedLine) return;
    const resolvedTracking = (resolvedLine.tracking_number ?? '').trim();
    if (!resolvedTracking || resolvedTracking !== (stub.tracking_number ?? '').trim()) return;
    if (resolvedLine.id === stub.id) return;
    const isUnmatched = resolvedLine.receiving_source === 'unmatched' || resolvedLine.id < 0;
    const cartonKey =
      resolvedLine.receiving_id != null && Number.isFinite(resolvedLine.receiving_id)
        ? `carton:${resolvedLine.receiving_id}`
        : stub.client_event_id;
    setImportStub({
      ...resolvedLine,
      item_name: resolvedLine.item_name || (isUnmatched ? 'Unfound PO' : stub.item_name),
      workflow_status: resolvedLine.workflow_status || (isUnmatched ? 'ARRIVED' : stub.workflow_status),
      client_event_id: cartonKey,
    });
  }, [resolvedLine]);

  const isImportingRow = useCallback(
    (row: ReceivingLineRow) =>
      importStub != null && row.client_event_id === importStub.client_event_id && row.id < 0,
    [importStub],
  );

  return { importingRow: importStub, isImportingRow };
}
