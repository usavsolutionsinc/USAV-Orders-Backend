import { useCallback, useState } from 'react';

interface QtyItem {
  item_id: number;
}

/**
 * Manages qty overrides for a list of items.
 *
 * Replaces the duplicated `qtyOverrides` state + `getQty()` helper found in
 * TrackingGroup (FbaActiveShipments) and FbaPairedReviewPanel.
 */
export function useQtyOverrides<T extends QtyItem>(
  getBaseline: (item: T) => number,
) {
  const [overrides, setOverrides] = useState<Record<number, number>>({});

  const getQty = useCallback(
    (item: T) => overrides[item.item_id] ?? getBaseline(item),
    [overrides, getBaseline],
  );

  const setQty = useCallback((itemId: number, qty: number) => {
    setOverrides((prev) => ({ ...prev, [itemId]: qty }));
  }, []);

  const removeItem = useCallback((itemId: number) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  }, []);

  const reset = useCallback(() => setOverrides({}), []);

  return { overrides, getQty, setQty, removeItem, reset };
}
