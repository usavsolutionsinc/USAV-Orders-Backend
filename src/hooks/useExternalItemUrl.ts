'use client';

import { useCallback } from 'react';

export function getExternalUrlByItemNumber(itemNumber: string | null | undefined): string | null {
  const item = String(itemNumber || '').trim();
  if (!item) return null;
  if (/^B0/i.test(item)) return `https://www.amazon.com/dp/${item}`;
  if (/^\d{12}$/.test(item)) return `https://www.ebay.com/itm/${item}`;
  if (item.length < 12) return `https://usavshop.com/products/search?keyword=${encodeURIComponent(item)}`;
  return `https://usavshop.com/products/search?keyword=${encodeURIComponent(item)}`;
}

export function useExternalItemUrl() {
  const getExternalUrlByItemNumberCb = useCallback((itemNumber: string | null | undefined) => {
    return getExternalUrlByItemNumber(itemNumber);
  }, []);

  const openExternalByItemNumber = useCallback((itemNumber: string | null | undefined) => {
    const url = getExternalUrlByItemNumber(itemNumber);
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    return url;
  }, []);

  return {
    getExternalUrlByItemNumber: getExternalUrlByItemNumberCb,
    openExternalByItemNumber
  };
}

