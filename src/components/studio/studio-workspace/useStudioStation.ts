'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { StudioStationResponse, StudioStationView, StudioZoom } from '../studio-types';

export interface StudioStationParams {
  active: boolean;
  z: StudioZoom;
  focus: string | null;
}

/** L2 station detail: fetch the focused node's bound station (read-only). */
export function useStudioStation({ active, z, focus }: StudioStationParams) {
  const [station, setStation] = useState<StudioStationView | null>(null);
  const [stationLoading, setStationLoading] = useState(false);
  const [stationReloadNonce, setStationReloadNonce] = useState(0);
  const stationAbort = useRef<AbortController | null>(null);
  const reloadStation = useCallback(() => setStationReloadNonce((n) => n + 1), []);

  useEffect(() => {
    if (!active || z !== 2 || !focus) {
      setStation(null);
      return;
    }
    stationAbort.current?.abort();
    const controller = new AbortController();
    stationAbort.current = controller;
    setStationLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/studio/nodes/${encodeURIComponent(focus)}/station`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const data = (await res.json()) as StudioStationResponse;
        if (!controller.signal.aborted) setStation(data.ok ? data.station : null);
      } catch {
        if (!controller.signal.aborted) setStation(null);
      } finally {
        if (!controller.signal.aborted) setStationLoading(false);
      }
    })();
    return () => controller.abort();
  }, [active, z, focus, stationReloadNonce]);

  // Abort any in-flight station fetch on unmount.
  useEffect(() => () => stationAbort.current?.abort(), []);

  return { station, stationLoading, reloadStation };
}
