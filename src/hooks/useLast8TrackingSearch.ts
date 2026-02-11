import { useCallback } from 'react';
import { normalizeTrackingLast8 } from '@/lib/tracking-format';

export function useLast8TrackingSearch() {
  const normalizeTrackingQuery = useCallback((query: string) => {
    return normalizeTrackingLast8(query);
  }, []);

  return { normalizeTrackingQuery };
}
