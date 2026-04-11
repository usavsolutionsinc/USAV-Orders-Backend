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

/** Infer platform label from an item number / platform SKU pattern. */
export function getPlatformLabelByItemNumber(itemNumber: string | null | undefined): string {
  const item = String(itemNumber || '').trim();
  if (!item) return 'Unknown';
  if (/^B0[A-Z0-9]{8}$/i.test(item)) return 'Amazon';
  if (/^X0[A-Z0-9]{8}$/i.test(item)) return 'Amazon FBA';
  if (/^\d{15}$/.test(item)) return 'Walmart';
  if (/^\d{12}$/.test(item)) return 'eBay';
  // Fallback: anything else (shorter/different pattern) is assumed to be Ecwid
  return 'Ecwid';
}

/** Infer the canonical platform key (lowercase, for DB writes) from an item number. */
export function getPlatformKeyByItemNumber(itemNumber: string | null | undefined): string {
  const label = getPlatformLabelByItemNumber(itemNumber);
  const map: Record<string, string> = {
    'Amazon': 'amazon',
    'Amazon FBA': 'amazon_fba',
    'Walmart': 'walmart',
    'eBay': 'ebay',
    'Ecwid': 'ecwid',
  };
  return map[label] || 'ecwid';
}

/**
 * Platform-aware external URL.
 * Uses the known platform to construct the correct marketplace/admin URL.
 */
export function getExternalUrlByPlatform(
  platform: string,
  identifier: string | null | undefined,
): string | null {
  const id = String(identifier || '').trim();
  if (!id) return null;
  const p = platform.toLowerCase();

  if (p === 'zoho' || p === 'ecwid') return `https://usavshop.com/products/search?keyword=${encodeURIComponent(id)}`;
  if (p.startsWith('ebay')) return `https://www.ebay.com/itm/${id}`;
  if (p === 'amazon' || p === 'amazon_fba') return `https://www.amazon.com/dp/${id}`;
  if (p === 'walmart') return `https://www.walmart.com/ip/${id}`;

  // Fallback: infer from identifier pattern
  return getExternalUrlByItemNumber(id);
}

/** `SKU:qty` scans — substring before `:` (catalog SKU / item keyword for usavshop). */
export function skuScanPrefixBeforeColon(value: string | null | undefined): string {
  const s = String(value ?? '').trim();
  if (!s.includes(':')) return '';
  return s.split(':')[0]?.trim() ?? '';
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

