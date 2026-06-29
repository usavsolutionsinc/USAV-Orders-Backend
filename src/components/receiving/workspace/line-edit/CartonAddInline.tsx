'use client';

/**
 * Inline carton-add surface — the Item / Web / Box add flow WITHOUT the popover
 * chrome, so it can live as a tab inside Package Pairing. Reuses the exact same
 * tab bodies the old `CartonAddPopover` used (`ItemTab`/`WebTab`/`BoxTab`); only
 * the host changed (inline panel instead of a portal modal).
 *
 * Matched cartons add OFF-PO (`allow_off_po`) — an extra item the Zoho PO
 * doesn't list; unmatched cartons add a normal line. On success it fires
 * `usav-refresh-data` (PoLinesAccordion refetches) + invalidates the receiving
 * feeds, so the new line shows immediately.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { safeRandomUUID } from '@/lib/safe-uuid';
import { invalidateReceivingFeeds } from '@/lib/queries/receiving-queries';
import { Button } from '@/design-system/primitives';
import { ItemTab } from '@/components/receiving/workspace/carton-add/ItemTab';
import { WebTab } from '@/components/receiving/workspace/carton-add/WebTab';
import { BoxTab } from '@/components/receiving/workspace/carton-add/BoxTab';
import {
  TAB_META,
  type AssignedBox,
  type CartonAddSelection,
  type CartonAddTab,
} from '@/components/receiving/workspace/carton-add/carton-add-types';

export function CartonAddInline({
  receivingId,
  allowOffPo,
  unitIds,
  onAssignedBox,
}: {
  receivingId: number;
  /** Matched carton → add as an off-PO extra (not on the Zoho PO). */
  allowOffPo: boolean;
  unitIds: number[];
  onAssignedBox?: (box: AssignedBox) => void;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<CartonAddTab>('item');
  const tabs: CartonAddTab[] = ['item', 'web', 'box'];

  const handleAddLine = async (sel: CartonAddSelection) => {
    const clientEventId = `add-line-${receivingId}-${safeRandomUUID()}`;
    const res = await fetch('/api/receiving/add-unmatched-line', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': clientEventId },
      body: JSON.stringify({
        receiving_id: receivingId,
        ...(allowOffPo ? { allow_off_po: true } : {}),
        ...(sel.sku_platform_id_row != null ? { sku_platform_id_row: sel.sku_platform_id_row } : {}),
        sku_catalog_id: sel.sku_catalog_id,
        sku: sel.sku || undefined,
        item_name: sel.item_name,
        client_event_id: clientEventId,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
    if (!res.ok || !body.success) {
      toast.error(body.error ?? `Add failed (${res.status})`);
      return;
    }
    toast.success(allowOffPo ? `Added off-PO · ${sel.item_name || sel.sku || 'item'}` : 'Item added');
    // PoLinesAccordion invalidates its siblings query on this event; the feeds
    // refresh keeps the rails/table in sync.
    window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    invalidateReceivingFeeds(queryClient);
  };

  return (
    <div className="space-y-3">
      {/* Item / Web / Box sub-tabs (same metadata as the old popover). */}
      <div className="flex gap-1">
        {tabs.map((t) => {
          const { label, Icon } = TAB_META[t];
          const active = t === tab;
          return (
            <Button
              key={t}
              type="button"
              variant={active ? 'brand' : 'ghost'}
              size="sm"
              icon={<Icon className="h-3.5 w-3.5" />}
              onClick={() => setTab(t)}
              className="h-7 gap-1.5 px-2.5 text-mini font-bold uppercase tracking-wider"
            >
              {label}
            </Button>
          );
        })}
      </div>

      {allowOffPo && tab !== 'box' ? (
        <p className="rounded-lg bg-amber-50 px-3 py-1.5 text-mini font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
          Adds as an off-PO item — not on the Zoho PO. Reconcile it in Zoho separately.
        </p>
      ) : null}

      <div className="min-h-0">
        {tab === 'item' ? <ItemTab onAddLine={handleAddLine} /> : null}
        {tab === 'web' ? <WebTab onAddLine={handleAddLine} /> : null}
        {tab === 'box' ? (
          <BoxTab unitIds={unitIds} onAssigned={onAssignedBox} onClose={() => setTab('item')} />
        ) : null}
      </div>
    </div>
  );
}
