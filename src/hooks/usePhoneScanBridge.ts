'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { useAblyClient } from '@/contexts/AblyContext';
import { usePhonePair, type PhoneScanRecord } from '@/contexts/PhonePairContext';

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type ScanResultMsg = {
  tracking?: string;
  matched?: boolean;
  po_ids?: string[];
  receiving_id?: number | null;
  error?: string | null;
};

/**
 * Global bridge for phone-originated tracking scans.
 *
 * ─ Always: records the scan in PhonePairContext so the FAB popover can
 *   display "last scanned" + unread bubble.
 * ─ When the user is on /receiving AND the page's staff matches the paired
 *   staff: lets ReceivingSidebarPanel own the lookup + station echo, we just
 *   mirror the `phone_scan_result` it publishes back into lastScan.
 * ─ Otherwise: calls /api/receiving/lookup-po ourselves and echoes
 *   `phone_scan_result` on station:{staffId} so the phone still gets its
 *   matched/unmatched chip.
 */
export function usePhoneScanBridge(): void {
  const { session, recordScan, updateScan } = usePhonePair();
  const { getClient } = useAblyClient();
  const pathname = usePathname();

  const pairedStaffId = session?.staffId ?? 0;
  const phoneChannelName = pairedStaffId > 0 ? `phone:${pairedStaffId}` : 'phone:__idle__';
  const stationChannelName = pairedStaffId > 0 ? `station:${pairedStaffId}` : 'station:__idle__';

  // Track the most recent phone scan so we can correlate the incoming
  // station echo without needing a server-side scan id.
  const pendingByTrackingRef = useRef<Map<string, string>>(new Map());

  // Best-effort "is the sidebar live?" check — we consider /receiving the
  // canonical handler. If the user later splits staff between page + pair,
  // we just double-lookup; the API is idempotent.
  const sidebarOwnsScans = Boolean(pathname && pathname.startsWith('/receiving'));

  const resolveOffPage = useCallback(
    async (tracking: string, scanId: string) => {
      try {
        const res = await fetch('/api/receiving/lookup-po', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackingNumber: tracking, staffId: pairedStaffId }),
        });
        const data = await res.json();
        const matched = Boolean(data?.matched);
        const receivingId =
          typeof data?.receiving_id === 'number' ? data.receiving_id : null;
        const poIds: string[] = Array.isArray(data?.po_ids) ? data.po_ids : [];

        updateScan(scanId, {
          status: matched ? 'matched' : 'unmatched',
          po_ids: poIds,
          receiving_id: receivingId,
          error: data?.success === false ? String(data?.error || 'lookup failed') : null,
        });

        // Echo back to the phone so its chip resolves immediately.
        try {
          const client = await getClient();
          if (client) {
            const ch = client.channels.get(stationChannelName);
            await ch.publish('phone_scan_result', {
              tracking,
              matched,
              po_ids: poIds,
              receiving_id: receivingId,
              error: data?.success === false ? data?.error ?? null : null,
            });
          }
        } catch (err) {
          console.warn('phone-scan-bridge: echo publish failed', err);
        }
      } catch (err) {
        updateScan(scanId, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Lookup failed',
        });
      }
    },
    [getClient, pairedStaffId, stationChannelName, updateScan],
  );

  // Incoming phone scan — always record, optionally own the lookup.
  useAblyChannel(
    phoneChannelName,
    'phone_scan',
    (msg: { data?: { tracking?: string } }) => {
      const tracking = String(msg?.data?.tracking || '').trim();
      if (!tracking) return;

      const record: PhoneScanRecord = {
        id: randomId(),
        tracking,
        status: 'pending',
        po_ids: [],
        receiving_id: null,
        error: null,
        at: Date.now(),
      };
      pendingByTrackingRef.current.set(tracking, record.id);
      recordScan(record);

      if (!sidebarOwnsScans) {
        void resolveOffPage(tracking, record.id);
      }
    },
    pairedStaffId > 0,
  );

  // Station echo — whichever side (sidebar or bridge) did the lookup, the
  // phone_scan_result lets us refresh the FAB's last-scan chip.
  useAblyChannel(
    stationChannelName,
    'phone_scan_result',
    (msg: { data?: ScanResultMsg }) => {
      const data = msg?.data;
      if (!data?.tracking) return;
      const scanId = pendingByTrackingRef.current.get(data.tracking);
      if (!scanId) return;
      pendingByTrackingRef.current.delete(data.tracking);
      updateScan(scanId, {
        status: data.error ? 'error' : data.matched ? 'matched' : 'unmatched',
        po_ids: Array.isArray(data.po_ids) ? data.po_ids : [],
        receiving_id:
          typeof data.receiving_id === 'number' ? data.receiving_id : null,
        error: data.error ?? null,
      });
    },
    pairedStaffId > 0,
  );

  // Clear pending correlation map when the pair session changes — a new
  // session shouldn't inherit a previous session's in-flight scans.
  useEffect(() => {
    pendingByTrackingRef.current.clear();
  }, [pairedStaffId]);
}
