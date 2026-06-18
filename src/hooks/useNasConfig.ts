'use client';

import { useEffect, useState } from 'react';
import { setNasBaseUrl } from '@/lib/nas-photos';

/**
 * Fetch the runtime NAS config (active base URL + this operator's folder) from
 * GET /api/nas-config and push the base URL into the nas-photos module so every
 * consumer (picker listing, thumbnails, capture PUT) targets the admin-selected
 * test/prod NAS without a rebuild.
 *
 * Module-memoized: the endpoint is hit once per page load and shared across all
 * callers. Returns null until the first fetch resolves.
 */
export interface NasConfig {
  baseUrl: string;
  folder: string;
}

let cached: NasConfig | null = null;
let inflight: Promise<NasConfig | null> | null = null;

async function fetchConfig(): Promise<NasConfig | null> {
  try {
    const res = await fetch('/api/nas-config', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    const cfg: NasConfig = {
      baseUrl:
        process.env.NODE_ENV !== 'production'
          ? '/api/nas-dev'
          : String(data?.baseUrl || ''),
      folder: String(data?.folder || ''),
    };
    cached = cfg;
    setNasBaseUrl(cfg.baseUrl);
    return cfg;
  } catch {
    return null;
  }
}

export function useNasConfig(): NasConfig | null {
  const [config, setConfig] = useState<NasConfig | null>(cached);

  useEffect(() => {
    let alive = true;
    const devProxy = process.env.NODE_ENV !== 'production' ? '/api/nas-dev' : null;
    if (cached) {
      const cfg =
        devProxy && cached.baseUrl !== devProxy
          ? { ...cached, baseUrl: devProxy }
          : cached;
      setNasBaseUrl(cfg.baseUrl);
      setConfig(cfg);
      if (cfg !== cached) cached = cfg;
      return;
    }
    if (!inflight) inflight = fetchConfig();
    void inflight.then((c) => {
      if (alive && c) setConfig(c);
    });
    return () => {
      alive = false;
    };
  }, []);

  return config;
}
