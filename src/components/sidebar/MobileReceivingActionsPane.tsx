'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Camera, ClipboardList } from '@/components/Icons';
import { ReceivingPhotoStrip } from '@/components/sidebar/ReceivingPhotoStrip';
import { usePersistedStaffId } from '@/hooks/usePersistedStaffId';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

interface ReceivingLinesPayload {
  receiving_lines: ReceivingLineRow[];
}

/**
 * Focused mobile Actions pane — replaces the full ReceivingSidebarPanel on
 * mobile. Surfaces only what a tech needs after tapping a row in History:
 * the PO/item it belongs to, a one-tap "Take Photos" CTA, and any photos
 * already captured for that carton.
 *
 * Selection is URL-driven (`?recvId=`) so it survives Actions↔History flips
 * even though RouteShell unmounts the inactive pane.
 */
export function MobileReceivingActionsPane() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [staffId] = usePersistedStaffId();
  const rawRecvId = searchParams.get('recvId');
  const receivingId = rawRecvId && /^\d+$/.test(rawRecvId) ? Number(rawRecvId) : null;

  // Mirror the row that was just tapped in History so we can show product /
  // PO context immediately without waiting on the lines fetch. The event
  // payload carries the row directly.
  const [seedRow, setSeedRow] = useState<ReceivingLineRow | null>(null);
  useEffect(() => {
    const handler = (event: Event) => {
      const row = (event as CustomEvent<ReceivingLineRow | null>).detail;
      if (row && row.receiving_id === receivingId) setSeedRow(row);
    };
    window.addEventListener('receiving-select-line', handler);
    return () => window.removeEventListener('receiving-select-line', handler);
  }, [receivingId]);

  const { data: linesData } = useQuery<ReceivingLinesPayload>({
    queryKey: ['receiving-lines-for-carton', receivingId],
    enabled: receivingId != null,
    queryFn: async () => {
      const res = await fetch(
        `/api/receiving-lines?receiving_id=${receivingId}&include=serials`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 15_000,
  });

  const lines = linesData?.receiving_lines ?? (seedRow ? [seedRow] : []);
  const firstLine = lines[0] ?? null;
  const poDisplay =
    firstLine?.zoho_purchaseorder_number ||
    firstLine?.zoho_purchaseorder_id ||
    (receivingId ? `Carton #${receivingId}` : '');

  const goToActions = (id: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('pane', 'actions');
    params.set('recvId', String(id));
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  // Empty state — user landed on Actions without a row selection.
  if (!receivingId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-white px-6 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-600">
          <ClipboardList className="h-6 w-6" />
        </span>
        <p className="text-[13px] font-black uppercase tracking-[0.18em] text-gray-800">
          No carton selected
        </p>
        <p className="max-w-[260px] text-[11px] font-semibold text-gray-500">
          Open <span className="font-black text-gray-800">History</span> and tap a row to start capturing photos.
        </p>
      </div>
    );
  }

  const photosHref = `/m/r/${receivingId}/photos${
    staffId > 0 ? `?staffId=${staffId}` : ''
  }`;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {/* Compact carton header */}
      <div className="shrink-0 border-b border-gray-200 px-4 py-3">
        <p className="text-[9px] font-black uppercase tracking-[0.22em] text-gray-400">PO</p>
        <p className="mt-0.5 truncate text-[15px] font-black tracking-tight text-gray-900">
          {poDisplay}
        </p>
        {firstLine?.item_name ? (
          <p className="mt-1 line-clamp-2 text-[12px] font-semibold text-gray-600">
            {firstLine.item_name}
          </p>
        ) : null}
        {lines.length > 1 ? (
          <p className="mt-2 text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">
            {lines.length} lines on this carton
          </p>
        ) : null}
      </div>

      {/* Take Photos CTA — the only primary action on mobile */}
      <div className="shrink-0 px-4 pt-4">
        <button
          type="button"
          onClick={() => router.push(photosHref)}
          className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-blue-600 text-white shadow-sm transition-colors active:bg-blue-700"
        >
          <Camera className="h-6 w-6" />
          <span className="text-[13px] font-black uppercase tracking-[0.18em]">
            Take Photos for this PO
          </span>
        </button>
      </div>

      {/* Existing photos — live-updating thumbnail strip */}
      <div className="mt-4 border-t border-gray-100">
        <ReceivingPhotoStrip receivingId={receivingId} staffId={staffId} />
      </div>

      {/* Quick line jumper — tapping flips the highlighted row back in History */}
      {lines.length > 1 ? (
        <div className="mt-2 min-h-0 flex-1 overflow-y-auto border-t border-gray-100">
          <p className="px-4 pb-1 pt-3 text-[9px] font-black uppercase tracking-[0.22em] text-gray-400">
            Lines on this carton
          </p>
          {lines.map((line) => (
            <button
              key={line.id}
              type="button"
              onClick={() => goToActions(line.receiving_id ?? receivingId)}
              className="flex w-full items-center justify-between gap-2 border-b border-gray-50 px-4 py-2.5 text-left transition-colors active:bg-blue-50"
            >
              <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-gray-800">
                {line.item_name || line.sku || `Line #${line.id}`}
              </span>
              <span className="shrink-0 text-[10px] font-black uppercase tracking-widest text-gray-400">
                {line.quantity_received}/{line.quantity_expected ?? '?'}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="min-h-0 flex-1" />
      )}
    </div>
  );
}
