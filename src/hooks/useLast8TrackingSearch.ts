import { useCallback } from 'react';
import { normalizeTrackingLast8, normalizeTrackingNumber } from '@/lib/tracking-format';

export function useLast8TrackingSearch() {
  /** Extract last 8 digits — most resilient matching strategy (sidesteps USPS prefix entirely). */
  const normalizeTrackingQuery = useCallback((query: string) => {
    return normalizeTrackingLast8(query);
  }, []);

  /** Strip USPS IMpb routing prefix (420+ZIP) + canonical normalization. */
  const normalizeTracking = useCallback((input: string) => {
    return normalizeTrackingNumber(input);
  }, []);

  return { normalizeTrackingQuery, normalizeTracking };
}
