'use client';

import { useEffect, useState } from 'react';
import type { FbaBoardItem } from '@/components/fba/FbaBoardTable';
import { FBA_BOARD_SELECTION, FBA_PAIRED_SELECTION } from '@/lib/fba/events';

function dedupeByItemId(items: FbaBoardItem[]): FbaBoardItem[] {
  const byId = new Map<number, FbaBoardItem>();
  for (const item of items) {
    byId.set(item.item_id, item);
  }
  return Array.from(byId.values());
}

export function useFbaBoardSelection(options?: { includePairedSelection?: boolean }) {
  const includePairedSelection = options?.includePairedSelection ?? true;
  const [selectedItems, setSelectedItems] = useState<FbaBoardItem[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const items = (e as CustomEvent<FbaBoardItem[]>).detail;
      setSelectedItems(dedupeByItemId(Array.isArray(items) ? items : []));
    };
    window.addEventListener(FBA_BOARD_SELECTION, handler);
    if (includePairedSelection) {
      window.addEventListener(FBA_PAIRED_SELECTION, handler);
    }
    return () => {
      window.removeEventListener(FBA_BOARD_SELECTION, handler);
      if (includePairedSelection) {
        window.removeEventListener(FBA_PAIRED_SELECTION, handler);
      }
    };
  }, [includePairedSelection]);

  return selectedItems;
}
