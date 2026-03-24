'use client';

import { motion } from 'framer-motion';
import type { Dispatch } from 'react';
import { Check, Clock } from '@/components/Icons';
import type { EnrichedItem, TableAction } from './types';
import { dueDateLabel } from './utils';
import { PrintTableCheckbox } from './Checkbox';

export function ShipmentGroupHeaderRow({
  group,
  selected,
  dispatch,
  reducedMotion,
  labelReady,
}: {
  group: {
    shipment_id: number;
    shipment_ref: string;
    amazon_shipment_id: string | null;
    due_date: string | null;
    destination_fc: string | null;
    items: EnrichedItem[];
  };
  selected: Set<number>;
  dispatch: Dispatch<TableAction>;
  reducedMotion: boolean;
  labelReady?: boolean;
}) {
  const ids = group.items.map((i) => i.item_id);
  const allSel = ids.length > 0 && ids.every((id) => selected.has(id));
  const someSel = !allSel && ids.some((id) => selected.has(id));
  const due = dueDateLabel(group.due_date);

  return (
    <motion.tr
      className="border-y border-zinc-100 bg-zinc-50/70"
      layout={!reducedMotion}
    >
      <td colSpan={3} className="pl-3 pr-3 py-1.5 sm:pl-4">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-600">
          <PrintTableCheckbox
            checked={allSel}
            indeterminate={someSel}
            reducedMotion={reducedMotion}
            label={allSel ? `Deselect shipment ${group.shipment_ref}` : `Select shipment ${group.shipment_ref}`}
            onChange={() => dispatch({ type: 'SELECT_SHIPMENT', shipment_id: group.shipment_id })}
          />
          <span className="font-mono font-semibold text-zinc-900">{group.shipment_ref}</span>
          {group.amazon_shipment_id ? (
            <span className="font-mono text-zinc-500">{group.amazon_shipment_id}</span>
          ) : (
            <span className="text-zinc-400">No Amazon ID</span>
          )}
          {group.destination_fc ? (
            <span className="text-zinc-400">FC {group.destination_fc}</span>
          ) : null}
          {labelReady ? (
            <span title="Label set complete" aria-label="Label set complete" className="inline-flex items-center justify-center text-emerald-700">
              <Check className="h-3.5 w-3.5" />
            </span>
          ) : null}
          <span className={`ml-auto inline-flex items-center gap-1 ${due.cls}`}>
            <Clock className="h-3.5 w-3.5" />
            <span>{due.text}</span>
          </span>
        </div>
      </td>
    </motion.tr>
  );
}
