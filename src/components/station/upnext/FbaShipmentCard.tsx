'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { fbaPaths } from '@/lib/fba/api-paths';
import { Package } from '@/components/Icons';
import { FbaTrackingGroupDisplay } from '@/components/fba/sidebar/FbaTrackingGroupDisplay';
import { FbaStatusBadge } from '@/components/fba/shared/FbaStatusBadge';
import { InlineEditableValue, framerGesture } from '@/design-system';
import { UndoToast } from '@/components/fba/table/UndoToast';
import { ChevronToggle } from '@/design-system/primitives';
import type { StationTheme } from '@/utils/staff-colors';
import type { ActiveShipment, ShipmentCardItem, TrackingBundle } from '@/lib/fba/types';
export type { ActiveShipment, ShipmentCardItem, TrackingBundle } from '@/lib/fba/types';

/* ── Tracking section — UPS tracking inline-edit + read-only items ─────── */

function TrackingSection({
  bundle,
  shipmentId,
  editable,
  stationTheme,
  onChanged,
  showUndoToast,
}: {
  bundle: TrackingBundle;
  shipmentId: number;
  editable: boolean;
  stationTheme: StationTheme;
  onChanged?: () => void;
  showUndoToast: (label: string, rollback: () => Promise<void>) => void;
}) {
  const [editVal, setEditVal] = useState(bundle.tracking_number);

  useEffect(() => { setEditVal(bundle.tracking_number); }, [bundle.tracking_number]);

  const saveTracking = useCallback(async () => {
    const next = editVal.trim().toUpperCase();
    const prev = bundle.tracking_number;
    if (!next || next === prev) return;
    try {
      const res = await fetch(fbaPaths.planTracking(shipmentId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link_id: bundle.link_id, tracking_number: next, carrier: 'UPS' }),
      });
      if (!res.ok) { setEditVal(prev); return; }
      showUndoToast(`Tracking → ${next.slice(0, 12)}…`, async () => {
        await fetch(fbaPaths.planTracking(shipmentId), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ link_id: bundle.link_id, tracking_number: prev, carrier: 'UPS' }),
        });
        setEditVal(prev);
      });
      onChanged?.();
    } catch {
      setEditVal(prev);
    }
  }, [editVal, bundle.link_id, bundle.tracking_number, shipmentId, onChanged, showUndoToast]);

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      {editable ? (
        <div className="w-full min-w-0 border-t border-blue-100/70 bg-blue-50/50 px-2 py-2">
          <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-blue-400/90">UPS tracking</p>
          <InlineEditableValue
            className="w-full min-w-0"
            value={editVal}
            placeholder="UPS 1Z…"
            onChange={(v) => setEditVal(v.toUpperCase())}
            onSubmit={() => void saveTracking()}
            monospace
            tone="blue"
            showEditIcon
            editIconPosition="end"
            valueClassName="text-[11px] text-blue-800 break-all !whitespace-normal"
            inputClassName="text-[11px]"
          />
        </div>
      ) : null}

      {/* Read-only items — edits happen via the edit button → FbaShipmentEditorForm. */}
      <FbaTrackingGroupDisplay
        bundle={bundle}
        items={bundle.items}
        stationTheme={stationTheme}
        editable={false}
        hideCheckbox
      />
    </div>
  );
}

/* ── Shipment card ─────────────────────────────────────────────────── */

export interface FbaShipmentCardProps {
  shipment: ActiveShipment;
  stationTheme?: StationTheme;
  editable?: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onChanged?: () => void;
}

/**
 * Station / up-next shipment card.
 *
 * Display-only surface below the two inline chip edits (FBA Shipment ID and
 * per-bundle UPS tracking). Item selection / qty / allocation changes happen
 * through the edit button → FBA_OPEN_SHIPMENT_EDITOR → FbaShipmentEditorForm.
 */
export function FbaShipmentCard({
  shipment,
  stationTheme = 'green',
  editable = false,
  isExpanded,
  onToggleExpand,
  onChanged,
}: FbaShipmentCardProps) {
  const [editableAmazonId, setEditableAmazonId] = useState(shipment.amazon_shipment_id || '');

  const [undoState, setUndoState] = useState<{
    open: boolean;
    label: string;
    rollback: (() => Promise<void>) | null;
  }>({ open: false, label: '', rollback: null });
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showUndoToast = useCallback((label: string, rollback: () => Promise<void>) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoState({ open: true, label, rollback });
    undoTimerRef.current = setTimeout(() => {
      setUndoState({ open: false, label: '', rollback: null });
    }, 4500);
  }, []);

  const handleUndo = useCallback(async () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    const rollback = undoState.rollback;
    setUndoState({ open: false, label: '', rollback: null });
    if (rollback) {
      try { await rollback(); onChanged?.(); } catch { /* silent */ }
    }
  }, [undoState.rollback, onChanged]);

  useEffect(() => () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }, []);

  const saveAmazonShipmentId = useCallback(async () => {
    const newVal = editableAmazonId.trim().toUpperCase();
    const prevVal = shipment.amazon_shipment_id || '';
    if (newVal === prevVal.trim().toUpperCase()) return;

    try {
      const res = await fetch(fbaPaths.plan(shipment.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amazon_shipment_id: newVal || null }),
      });
      if (!res.ok) { setEditableAmazonId(prevVal); return; }

      showUndoToast(`FBA ID → ${newVal || '(cleared)'}`, async () => {
        await fetch(fbaPaths.plan(shipment.id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amazon_shipment_id: prevVal || null }),
        });
        setEditableAmazonId(prevVal);
      });
      onChanged?.();
    } catch {
      setEditableAmazonId(prevVal);
    }
  }, [editableAmazonId, shipment.id, shipment.amazon_shipment_id, showUndoToast, onChanged]);

  useEffect(() => {
    setEditableAmazonId(shipment.amazon_shipment_id || '');
  }, [shipment.amazon_shipment_id]);

  const items = shipment.items;
  const primaryTracking =
    shipment.tracking_number_raw ||
    shipment.tracking_numbers[0]?.tracking_number ||
    '—';
  const carrier =
    shipment.tracking_carrier ||
    shipment.tracking_numbers[0]?.carrier ||
    '';
  const totalQty = items.reduce((s, i) => s + Math.max(0, Number(i.expected_qty)), 0);
  const isShipped = shipment.status === 'SHIPPED';
  const shippedDateLabel = (() => {
    if (!shipment.shipped_at) return null;
    try {
      const d = new Date(shipment.shipped_at);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch { return null; }
  })();

  const syntheticBundle = useMemo((): TrackingBundle | null => {
    if ((shipment.bundles?.length ?? 0) > 0) return null;
    const linkId = Number(shipment.tracking_link_id || 0);
    if (!linkId) return null;
    const tn = shipment.tracking_number_raw || shipment.tracking_numbers[0]?.tracking_number || '';
    if (!String(tn).trim()) return null;
    return {
      link_id: linkId,
      tracking_number: String(tn).trim(),
      carrier: shipment.tracking_carrier || shipment.tracking_numbers[0]?.carrier || 'UPS',
      items,
    };
  }, [
    shipment.bundles,
    shipment.tracking_link_id,
    shipment.tracking_number_raw,
    shipment.tracking_numbers,
    shipment.tracking_carrier,
    items,
  ]);

  const hasBundles = (shipment.bundles?.length ?? 0) > 0;

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      whileHover={framerGesture.cardHover}
      whileTap={framerGesture.tapPress}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="[overflow:clip] border border-gray-200 bg-white transition-colors"
    >
      {/* Header */}
      <button
        type="button"
        onClick={onToggleExpand}
        className="flex w-full items-center justify-between gap-2 bg-white px-3 py-2.5 text-left transition-colors hover:bg-gray-50"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Package className="h-4 w-4 shrink-0 text-purple-500" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex min-w-0 items-baseline gap-1.5">
              {shipment.amazon_shipment_id && (
                <span className="truncate font-mono text-[12px] font-black text-gray-900">
                  {shipment.amazon_shipment_id}
                </span>
              )}
              <span className="shrink-0 text-[10px] font-bold text-gray-400">
                {items.length} SKU · {totalQty} units
              </span>
              <FbaStatusBadge
                status={shipment.status}
                size="xs"
                iconOnly={
                  shipment.status === 'PLANNED' || shipment.status === 'READY_TO_GO'
                }
              />
            </div>
            <div className="flex min-w-0 items-center gap-1.5">
              <p className="truncate font-mono text-[10px] font-bold text-gray-400">
                {shipment.tracking_numbers.length > 1
                  ? `${shipment.tracking_numbers.length} trackings`
                  : `${carrier ? `${carrier} · ` : ''}${primaryTracking}`}
              </p>
              {isShipped && shippedDateLabel ? (
                <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-black text-emerald-700">
                  {shippedDateLabel}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <ChevronToggle isExpanded={isExpanded} tone="purple" />
      </button>

      {/* Expanded — FBA ID inline edit + read-only tracking groups */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-gray-100 px-3">
              {editable ? (
                <div className="border-b border-gray-100 py-2.5">
                  <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">FBA Shipment ID</p>
                  <InlineEditableValue
                    value={editableAmazonId}
                    placeholder="FBA1234ABCD"
                    onChange={(v) => setEditableAmazonId(v.toUpperCase())}
                    onSubmit={saveAmazonShipmentId}
                    monospace
                    tone="purple"
                    showEditIcon
                  />
                </div>
              ) : null}

              {hasBundles ? (
                shipment.bundles.map((bundle) => (
                  <TrackingSection
                    key={bundle.link_id}
                    bundle={bundle}
                    shipmentId={shipment.id}
                    editable={editable}
                    stationTheme={stationTheme}
                    onChanged={onChanged}
                    showUndoToast={showUndoToast}
                  />
                ))
              ) : items.length === 0 ? (
                <p className="py-3 text-center text-[11px] font-bold text-gray-400">No items</p>
              ) : syntheticBundle ? (
                <FbaTrackingGroupDisplay
                  bundle={syntheticBundle}
                  items={items}
                  stationTheme={stationTheme}
                  editable={false}
                  hideCheckbox
                />
              ) : (
                <FbaTrackingGroupDisplay
                  bundle={{ link_id: 0, tracking_number: '', carrier: '', items }}
                  items={items}
                  stationTheme={stationTheme}
                  editable={false}
                  hideCheckbox
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <UndoToast
        open={undoState.open}
        label={undoState.label}
        onUndo={() => void handleUndo()}
      />
    </motion.div>
  );
}
