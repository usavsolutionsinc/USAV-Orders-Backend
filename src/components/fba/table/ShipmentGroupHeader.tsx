'use client';

import { motion } from 'framer-motion';
import type { Dispatch } from 'react';
import { Clock } from '@/components/Icons';
import type { StationTheme } from '@/utils/staff-colors';
import type { EnrichedItem, TableAction } from './types';
import { dueDateLabel } from './utils';
import { PrintTableCheckbox } from './Checkbox';
import { fbaPrintTableTokens as T } from './fbaPrintTableTokens';

export function ShipmentGroupHeaderRow({
  group,
  selected,
  dispatch,
  reducedMotion,
  stationTheme = 'lightblue',
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
  stationTheme?: StationTheme;
}) {
  const ids = group.items.map((i) => i.item_id);
  const allSel = ids.length > 0 && ids.every((id) => selected.has(id));
  const someSel = !allSel && ids.some((id) => selected.has(id));
  const due = dueDateLabel(group.due_date);

  return (
    <motion.tr className={T.shipmentRow} layout={!reducedMotion}>
      <td colSpan={3} className={T.shipmentCell}>
        <div className={T.shipmentFlex}>
          <PrintTableCheckbox
            checked={allSel}
            indeterminate={someSel}
            reducedMotion={reducedMotion}
            stationTheme={stationTheme}
            label={allSel ? `Deselect shipment ${group.shipment_ref}` : `Select shipment ${group.shipment_ref}`}
            onChange={() => dispatch({ type: 'SELECT_SHIPMENT', shipment_id: group.shipment_id })}
          />
          <span className={T.shipmentRef}>{group.shipment_ref}</span>
          {group.amazon_shipment_id ? (
            <span className={T.shipmentMonoMuted}>{group.amazon_shipment_id}</span>
          ) : (
            <span className={T.shipmentHint}>No Amazon ID</span>
          )}
          {group.destination_fc ? (
            <span className={T.shipmentHint}>FC {group.destination_fc}</span>
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
