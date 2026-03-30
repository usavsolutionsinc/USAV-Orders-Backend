'use client';

import { useCallback, useEffect, useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Loader2, Package } from '@/components/Icons';
import { FnskuChip } from '@/components/ui/CopyChip';
import { InlineQtyPrefix } from '@/components/ui/QtyBadge';
import { sectionLabel } from '@/design-system/tokens/typography/presets';

/* ── Types ─────────────────────────────────────────────────────────── */

export interface ShipmentCardItem {
  item_id: number;
  fnsku: string;
  display_title: string;
  expected_qty: number;
  actual_qty: number;
  status: string;
  shipment_id: number;
}

export interface ActiveShipment {
  id: number;
  shipment_ref: string;
  amazon_shipment_id: string | null;
  status: string;
  tracking_numbers: { tracking_number: string; carrier: string }[];
  items: ShipmentCardItem[];
}

/* ── Draggable FNSKU row ───────────────────────────────────────────── */

function DraggableFnskuRow({ item }: { item: ShipmentCardItem }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `item-${item.item_id}`,
    data: { item },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
    touchAction: 'none' as const,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`flex items-center gap-2 rounded-lg border bg-white px-2.5 py-2 transition-shadow ${
        isDragging
          ? 'border-purple-400 shadow-lg shadow-purple-200/50'
          : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
      }`}
    >
      {/* Drag handle dots */}
      <div className="flex shrink-0 flex-col gap-[2px] opacity-40">
        <div className="flex gap-[2px]">
          <span className="h-[3px] w-[3px] rounded-full bg-gray-500" />
          <span className="h-[3px] w-[3px] rounded-full bg-gray-500" />
        </div>
        <div className="flex gap-[2px]">
          <span className="h-[3px] w-[3px] rounded-full bg-gray-500" />
          <span className="h-[3px] w-[3px] rounded-full bg-gray-500" />
        </div>
        <div className="flex gap-[2px]">
          <span className="h-[3px] w-[3px] rounded-full bg-gray-500" />
          <span className="h-[3px] w-[3px] rounded-full bg-gray-500" />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="truncate text-[12px] font-bold text-gray-900">
          <InlineQtyPrefix quantity={item.expected_qty} />
          {item.display_title}
        </p>
        <FnskuChip value={item.fnsku} />
      </div>

      <div className="flex shrink-0 flex-col items-center text-center">
        <span className="text-[14px] font-black tabular-nums text-gray-900">{item.expected_qty}</span>
        <span className="text-[9px] font-bold text-gray-400">qty</span>
      </div>
    </div>
  );
}

/* ── Droppable shipment card ───────────────────────────────────────── */

export interface FbaShipmentCardProps {
  shipment: ActiveShipment;
  onRefresh: () => void;
}

export function FbaShipmentCard({ shipment, onRefresh }: FbaShipmentCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<ShipmentCardItem[]>(shipment.items);

  // Keep items in sync when parent data refreshes
  useEffect(() => {
    setItems(shipment.items);
  }, [shipment.items]);

  const { isOver, setNodeRef } = useDroppable({
    id: `shipment-${shipment.id}`,
    data: { shipment },
  });

  const primaryTracking = shipment.tracking_numbers[0]?.tracking_number || '—';
  const carrier = shipment.tracking_numbers[0]?.carrier || '';
  const totalQty = items.reduce((s, i) => s + i.expected_qty, 0);

  return (
    <motion.div
      ref={setNodeRef}
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ type: 'spring', damping: 22, stiffness: 300 }}
      className={`overflow-hidden rounded-xl border transition-colors ${
        isOver
          ? 'border-purple-400 bg-purple-50 shadow-md shadow-purple-200/40'
          : 'border-gray-200 bg-white'
      }`}
    >
      {/* Collapsed header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-gray-50"
      >
        <Package className="h-4 w-4 shrink-0 text-purple-500" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            {shipment.amazon_shipment_id && (
              <span className="truncate font-mono text-[11px] font-black text-gray-900">
                {shipment.amazon_shipment_id}
              </span>
            )}
            <span className="truncate text-[10px] font-bold text-gray-500">
              {items.length} FNSKU{items.length !== 1 ? 's' : ''} · {totalQty} units
            </span>
          </div>
          <p className="truncate font-mono text-[10px] font-bold text-gray-500">
            {carrier ? `${carrier} ` : ''}{primaryTracking}
          </p>
        </div>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Expanded: FNSKU list */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-1.5 border-t border-gray-100 px-2.5 py-2.5">
              <p className={sectionLabel}>
                FNSKUs — drag to move
              </p>
              {items.length === 0 ? (
                <p className="py-3 text-center text-[11px] font-bold text-gray-400">No items</p>
              ) : (
                items.map((item) => (
                  <DraggableFnskuRow key={item.item_id} item={item} />
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Drop target indicator */}
      {isOver && !expanded && (
        <div className="border-t border-purple-300 bg-purple-100 px-3 py-1.5 text-center">
          <p className="text-[10px] font-black uppercase tracking-widest text-purple-700">
            Drop here to move
          </p>
        </div>
      )}
    </motion.div>
  );
}
