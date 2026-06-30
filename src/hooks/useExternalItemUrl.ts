'use client';

import { useCallback } from 'react';
// Pure URL builders live in a server-safe util (no React) so server code can
// reuse the exact same SoT. Re-exported here so existing client imports from
// `@/hooks/useExternalItemUrl` keep working unchanged.
import {
  getExternalUrlByItemNumber,
  getPlatformLabelByItemNumber,
  getPlatformKeyByItemNumber,
  getExternalUrlByPlatform,
  skuScanPrefixBeforeColon,
} from '@/utils/external-item-url';

export {
  getExternalUrlByItemNumber,
  getPlatformLabelByItemNumber,
  getPlatformKeyByItemNumber,
  getExternalUrlByPlatform,
  skuScanPrefixBeforeColon,
};

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

