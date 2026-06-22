'use client';

/**
 * FNSKU detail-panel selection for the FBA board, with up/down navigation
 * bounded to the currently-filtered list. Extracted from fba/page; behaviour is
 * unchanged.
 */

import { useCallback, useState } from 'react';
import type { FbaBoardItem } from '@/components/fba/FbaBoardTable';

export interface FbaDetailPanel {
  detailItem: FbaBoardItem | null;
  setDetailItem: React.Dispatch<React.SetStateAction<FbaBoardItem | null>>;
  handleDetailNavigate: (direction: 'up' | 'down') => void;
}

export function useFbaDetailPanel(filteredPendingItems: FbaBoardItem[]): FbaDetailPanel {
  const [detailItem, setDetailItem] = useState<FbaBoardItem | null>(null);

  const handleDetailNavigate = useCallback(
    (direction: 'up' | 'down') => {
      if (!detailItem) return;
      const list = filteredPendingItems;
      const idx = list.findIndex((i) => i.fnsku === detailItem.fnsku);
      const next = direction === 'up' ? idx - 1 : idx + 1;
      if (next >= 0 && next < list.length) setDetailItem(list[next]);
    },
    [detailItem, filteredPendingItems],
  );

  return { detailItem, setDetailItem, handleDetailNavigate };
}
