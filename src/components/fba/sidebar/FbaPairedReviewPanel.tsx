'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Loader2, Minus, Plus } from '@/components/Icons';
import type { FbaBoardItem } from '@/components/fba/FbaBoardTable';
import { FbaSelectedLineRow } from '@/components/fba/sidebar/FbaSelectedLineRow';
import { DeferredQtyInput } from '@/design-system/primitives';
import { FormField } from '@/design-system/components';
import { microBadge } from '@/design-system/tokens/typography/presets';
import type { StationTheme } from '@/utils/staff-colors';
import { fbaSidebarThemeChrome } from '@/utils/staff-colors';
import { getUniquePlanIds } from '@/lib/fba/pairing';
import { fbaPaths } from '@/lib/fba/api-paths';
import {
  FBA_BOARD_DESELECT_ITEM,
  FBA_BOARD_REMOVE_ITEMS,
  FBA_PAIRED_SELECTION,
  FBA_PRINT_SHIPPED,
  FBA_SELECTION_ADJUSTED,
  FBA_SEND_SHIPMENT_TO_PAIRED_REVIEW,
  USAV_REFRESH_DATA,
} from '@/lib/fba/events';
import { emitOpenQuickAddFnsku } from '@/components/fba/FbaQuickAddFnskuModal';

interface FbaPairedReviewPanelProps {
  selectedItems: FbaBoardItem[];
  stationTheme?: StationTheme;
  /** Full form vs compact strip (driven by FbaSidebar + `fba-paired-review-toggle`). */
  expanded?: boolean;
  onToggleExpanded?: () => void;
}

export function FbaPairedReviewPanel({
  selectedItems,
  stationTheme = 'green',
  expanded = true,
  onToggleExpanded,
}: FbaPairedReviewPanelProps) {
  const chrome = fbaSidebarThemeChrome[stationTheme];

  const [amazonShipmentId, setAmazonShipmentId] = useState('');
  /** Locked FBA Shipment ID — persists across saves so user can attach multiple UPS trackings. */
  const [lockedFbaId, setLockedFbaId] = useState<string | null>(null);
  const [upsTracking, setUpsTracking] = useState('');
  const [qtyOverrides, setQtyOverrides] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  /** Plan IDs that have already been stamped with the locked FBA Shipment ID. */
  const [stampedPlanIds, setStampedPlanIds] = useState<Set<number>>(new Set());
  /** From active shipment X → paired: enables split when FBA ID is edited vs prefilled. */
  const [activeSplit, setActiveSplit] = useState<{
    sourcePlanId: number;
    prefilledAmazonShipmentId: string;
  } | null>(null);

  const planIds = getUniquePlanIds(selectedItems);
  const activeFbaId = lockedFbaId || amazonShipmentId.trim();

  // Clean up overrides for items that left the selection
  useEffect(() => {
    const currentIds = new Set(selectedItems.map((i) => i.item_id));
    setQtyOverrides((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const id of Object.keys(next)) {
        if (!currentIds.has(Number(id))) { delete next[Number(id)]; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [selectedItems]);

  const getQty = useCallback(
    (item: FbaBoardItem) => {
      const override = qtyOverrides[item.item_id];
      if (override !== undefined) return Math.max(0, Number(override));
      return Math.max(1, Number(item.actual_qty || 0));
    },
    [qtyOverrides],
  );

  // Emit adjusted totals so microcopy stays in sync with the qty steppers.
  useEffect(() => {
    const totalQty = selectedItems.reduce((sum, item) => sum + getQty(item), 0);
    window.dispatchEvent(new CustomEvent(FBA_SELECTION_ADJUSTED, {
      detail: { selected: selectedItems.length, selectedQty: totalQty },
    }));
  }, [selectedItems, qtyOverrides, getQty]);

  // Active shipment card → prefill FBA ID + UPS and set combine selection.
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<{
        items: FbaBoardItem[];
        amazonShipmentId: string;
        upsTracking: string;
        activeShipmentSplit?: { sourcePlanId: number; prefilledAmazonShipmentId: string };
      }>).detail;
      if (!d?.items?.length) return;
      setAmazonShipmentId(String(d.amazonShipmentId || '').trim());
      setUpsTracking(String(d.upsTracking || '').trim().toUpperCase());
      setLockedFbaId(null);
      setStampedPlanIds(new Set());
      setActiveSplit(d.activeShipmentSplit ?? null);
      setError(null);
      setSuccess(null);
      setQtyOverrides((prev) => {
        const merged = { ...prev };
        for (const it of d.items) {
          merged[it.item_id] = Math.max(0, Number(it.expected_qty || 0));
        }
        return merged;
      });
      window.dispatchEvent(new CustomEvent(FBA_PAIRED_SELECTION, { detail: d.items }));
    };
    window.addEventListener(FBA_SEND_SHIPMENT_TO_PAIRED_REVIEW, handler as EventListener);
    return () => window.removeEventListener(FBA_SEND_SHIPMENT_TO_PAIRED_REVIEW, handler as EventListener);
  }, []);

  const adjustQty = useCallback((item: FbaBoardItem, delta: number) => {
    const cur = getQty(item);
    const next = cur + delta;
    if (next <= 0) {
      window.dispatchEvent(new CustomEvent(FBA_BOARD_DESELECT_ITEM, { detail: item.item_id }));
      setQtyOverrides((prev) => {
        const copy = { ...prev };
        delete copy[item.item_id];
        return copy;
      });
      return;
    }
    setQtyOverrides((prev) => ({ ...prev, [item.item_id]: next }));
  }, [getQty]);

  const removeSelectedItem = useCallback((item: FbaBoardItem) => {
    window.dispatchEvent(new CustomEvent(FBA_BOARD_DESELECT_ITEM, { detail: item.item_id }));
    setQtyOverrides((prev) => {
      const copy = { ...prev };
      delete copy[item.item_id];
      return copy;
    });
  }, []);

  const handleDismissFbaId = useCallback(() => {
    setLockedFbaId(null);
    setAmazonShipmentId('');
    setStampedPlanIds(new Set());
    setActiveSplit(null);
    setSuccess(null);
    setError(null);
  }, []);

  const handleAttach = useCallback(async () => {
    const trackingRaw = upsTracking.trim();
    if (!trackingRaw) {
      setError('Enter a UPS tracking number');
      return;
    }
    if (planIds.length === 0) {
      setError('No items selected');
      return;
    }

    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const selectedLines = selectedItems
        .map((item) => ({ item, selectedQty: getQty(item) }))
        .filter((row) => row.selectedQty > 0);

      if (selectedLines.length === 0) {
        throw new Error('Select at least one qty');
      }

      // Persist selected qty for the selected board rows so combine+save is one action.
      for (const { item, selectedQty } of selectedLines) {
        const qty = Math.max(1, selectedQty);
        if (qty === Number(item.expected_qty || 0)) continue;
        await fetch(fbaPaths.planItem(item.shipment_id, item.item_id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expected_qty: qty }),
        });
      }

      const prefilledUpper = (activeSplit?.prefilledAmazonShipmentId ?? '').trim().toUpperCase();
      const newFbaUpper = activeFbaId.trim().toUpperCase();
      const shouldSplitNewPlan =
        activeSplit != null &&
        newFbaUpper.length > 0 &&
        newFbaUpper !== prefilledUpper;

      if (shouldSplitNewPlan) {
        if (planIds.length !== 1 || planIds[0] !== activeSplit.sourcePlanId) {
          throw new Error(
            'Changing the FBA Shipment ID here only works when every line is from the same active shipment you opened from.',
          );
        }
        const splitRes = await fetch(fbaPaths.splitForPairedReview(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_shipment_id: activeSplit.sourcePlanId,
            new_amazon_shipment_id: newFbaUpper,
            tracking_number: trackingRaw,
            carrier: 'UPS',
            label: 'UPS',
            lines: selectedLines.map(({ item, selectedQty }) => ({
              shipment_item_id: Number(item.item_id),
              quantity: Math.max(1, selectedQty),
            })),
          }),
        });
        const splitData = await splitRes.json().catch(() => ({}));
        if (!splitRes.ok) throw new Error(splitData?.error || 'Failed to split into new shipment');
        setActiveSplit(null);
      } else {
        for (const pid of planIds) {
          const planAllocations = selectedLines
            .filter(({ item }) => Number(item.shipment_id) === pid)
            .map(({ item, selectedQty }) => ({
              shipment_item_id: Number(item.item_id),
              quantity: Math.max(1, selectedQty),
            }));
          if (planAllocations.length === 0) continue;

          const res = await fetch(fbaPaths.planTracking(pid), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tracking_number: trackingRaw,
              carrier: 'UPS',
              label: 'UPS',
              allocations: planAllocations,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.error || `Failed for plan ${pid}`);
        }

        // Stamp FBA Shipment ID on plans that haven't been stamped yet (same FBA as card / board flow).
        const fbaId = activeFbaId;
        if (fbaId) {
          const unstamped = planIds.filter((pid) => !stampedPlanIds.has(pid));
          for (const pid of unstamped) {
            await fetch(fbaPaths.plan(pid), {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ amazon_shipment_id: fbaId }),
            });
          }
          setLockedFbaId(fbaId);
          setStampedPlanIds((prev) => {
            const next = new Set(prev);
            for (const pid of planIds) next.add(pid);
            return next;
          });
        }
        setActiveSplit(null);
      }

      // Remove combined items from the board and deselect them.
      const combinedIds = selectedLines.map(({ item }) => item.item_id);
      window.dispatchEvent(new CustomEvent(FBA_BOARD_REMOVE_ITEMS, { detail: combinedIds }));
      window.dispatchEvent(new CustomEvent('fba-board-toggle-all', { detail: 'none' }));

      // Clear UPS tracking for next batch — FBA Shipment ID stays locked.
      setUpsTracking('');
      setQtyOverrides({});
      const msg = `Combined ${selectedLines.length} line${selectedLines.length === 1 ? '' : 's'}`;
      setSuccess(msg);
      window.dispatchEvent(new CustomEvent('fba-scan-status', { detail: msg }));
      window.dispatchEvent(new CustomEvent(FBA_PRINT_SHIPPED));
      window.dispatchEvent(new CustomEvent('fba-active-shipments-refresh'));
      window.dispatchEvent(new CustomEvent(USAV_REFRESH_DATA));
    } catch (err: any) {
      setError(err?.message || 'Failed to attach tracking');
    } finally {
      setSaving(false);
    }
  }, [upsTracking, activeFbaId, planIds, selectedItems, getQty, stampedPlanIds, activeSplit]);

  const collapsedTotalQty = selectedItems.reduce((sum, item) => sum + getQty(item), 0);

  // Compact strip when collapsed — always tappable to expand.
  if (!expanded && onToggleExpanded) {
    return (
      <div className="shrink-0 border-b border-gray-100 px-3 py-2">
        <button
          type="button"
          onClick={onToggleExpanded}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50/90 px-2.5 py-2 text-left transition-colors hover:bg-gray-100"
          aria-expanded={false}
        >
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-600">
            Combine review
          </span>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            {selectedItems.length > 0 ? (
              <span className="truncate text-[10px] font-bold tabular-nums text-gray-500">
                {selectedItems.length} · {collapsedTotalQty}
              </span>
            ) : lockedFbaId ? (
              <span className="truncate font-mono text-[10px] font-bold text-emerald-700">{lockedFbaId}</span>
            ) : (
              <span className="text-[10px] font-semibold text-gray-400">Tap to expand</span>
            )}
            <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
          </div>
        </button>
      </div>
    );
  }

  // Panel stays visible when FBA ID is locked (even with 0 items selected).
  if (selectedItems.length === 0 && !lockedFbaId) return null;

  const hasItems = selectedItems.length > 0;

  return (
    <div className="border-b border-gray-100">
      {onToggleExpanded ? (
        <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Combine review</p>
          <button
            type="button"
            onClick={onToggleExpanded}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Collapse combine review"
            title="Collapse"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      <div className="space-y-2 px-3 pb-3 pt-1">
      {/* FBA Shipment ID — sticky with dismiss button */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">FBA Shipment ID</p>
          {lockedFbaId && (
            <button
              type="button"
              onClick={handleDismissFbaId}
              className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 transition-colors hover:bg-emerald-200"
              aria-label="Done — clear FBA Shipment ID"
              title="Done with this FBA Shipment ID"
            >
              <Check className="h-3 w-3" />
            </button>
          )}
        </div>
        <input
          value={lockedFbaId || amazonShipmentId}
          onChange={(e) => {
            if (lockedFbaId) return;
            setAmazonShipmentId(e.target.value.toUpperCase());
          }}
          placeholder="FBA1234ABCD"
          disabled={saving || Boolean(lockedFbaId)}
          className={`${chrome.monoInput} ${lockedFbaId ? '!bg-emerald-50 !border-emerald-200 !text-emerald-800' : ''}`}
        />
        {activeSplit ? (
          <p className="mt-1.5 text-[9px] font-semibold leading-snug text-amber-800">
            If you change this FBA ID from the prefilled value, Save creates a new active shipment for these
            FNSKUs with this Amazon ID and UPS; the original card keeps its FBA ID for remaining lines.
          </p>
        ) : null}
      </div>

      <FormField label="UPS Tracking">
        <input
          value={upsTracking}
          onChange={(e) => setUpsTracking(e.target.value.toUpperCase())}
          placeholder="1Z999AA10123456784"
          disabled={saving}
          autoFocus={Boolean(lockedFbaId)}
          className={chrome.monoInput}
        />
      </FormField>

      {error && <p className={`${microBadge} tracking-wider text-red-600`}>{error}</p>}
      {success && <p className={`${microBadge} tracking-wider text-emerald-600`}>{success}</p>}

      {hasItems ? (
        <button
          type="button"
          onClick={() => void handleAttach()}
          disabled={saving}
          className={`flex h-10 items-center justify-center gap-1.5 ${chrome.primaryButton}`}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-white" /> : null}
          {lockedFbaId ? 'Save UPS Tracking' : 'Save Shipment + UPS'}
        </button>
      ) : lockedFbaId ? (
        <p className={`${microBadge} tracking-wider text-emerald-600`}>
          Select more items to add another UPS tracking to {lockedFbaId}
        </p>
      ) : null}

      {hasItems ? (
        <div className="border-t border-gray-200">
          {selectedItems.map((item) => {
            const qty = getQty(item);
            const baseline = Math.max(1, Number(item.actual_qty || 0));
            const overPlanned = qty > baseline;
            return (
              <FbaSelectedLineRow
                key={item.item_id}
                displayTitle={item.display_title || 'No title'}
                fnsku={String(item.fnsku || '').toUpperCase()}
                stationTheme={stationTheme}
                checked
                onCheckedChange={(nextChecked) => {
                  if (!nextChecked) removeSelectedItem(item);
                }}
                onEditDetails={() =>
                  emitOpenQuickAddFnsku({
                    fnsku: String(item.fnsku || '').trim(),
                    product_title: item.display_title || null,
                    asin: item.asin ?? null,
                    sku: item.sku ?? null,
                    condition: item.condition ?? null,
                  })
                }
                rightSlot={
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        adjustQty(item, 1);
                      }}
                      className="flex h-6 w-10 items-center justify-center rounded-t-md border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50"
                      aria-label={`Increase ${item.fnsku} quantity`}
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                    <DeferredQtyInput
                      value={qty}
                      min={0}
                      onChange={(v) => {
                        if (v <= 0) {
                          removeSelectedItem(item);
                          return;
                        }
                        setQtyOverrides((prev) => ({ ...prev, [item.item_id]: v }));
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className={`h-7 w-10 border-x bg-white text-center text-[13px] font-black tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
                        overPlanned
                          ? 'border-amber-300 text-amber-700'
                          : 'border-gray-200 text-gray-900'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        adjustQty(item, -1);
                      }}
                      disabled={qty <= 0}
                      className={`flex h-6 w-10 items-center justify-center rounded-b-md border transition-colors ${
                        qty <= 1
                          ? 'border-red-300 text-red-500 hover:bg-red-50'
                          : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                      } disabled:opacity-40`}
                      aria-label={`Decrease ${item.fnsku} quantity`}
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                  </>
                }
              />
            );
          })}
        </div>
      ) : null}
      </div>
    </div>
  );
}
