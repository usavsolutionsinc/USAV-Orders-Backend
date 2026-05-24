'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { sectionLabel } from '@/design-system/tokens/typography/presets';

type HealthState = 'ok' | 'degraded' | 'down' | 'unknown';

interface Probe {
  key: string;
  label: string;
  /** ms timeout for the probe before we call it degraded */
  timeoutMs?: number;
  /** url to GET — must return JSON; 2xx = ok, 5xx = down, other = degraded */
  url: string;
}

const PROBES: Probe[] = [
  { key: 'app',      label: 'App',       url: '/api/health' },
  { key: 'db',       label: 'Database',  url: '/api/db/ping' },
  { key: 'realtime', label: 'Realtime',  url: '/api/realtime/token' },
  { key: 'ai',       label: 'AI',        url: '/api/ai/health' },
  { key: 'zoho',     label: 'Zoho',      url: '/api/zoho/health' },
];

async function probe(url: string, timeoutMs = 4000): Promise<HealthState> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (res.ok) return 'ok';
    if (res.status >= 500) return 'down';
    return 'degraded';
  } catch {
    return 'down';
  } finally {
    clearTimeout(t);
  }
}

const TONE: Record<HealthState, { dot: string; ring: string; chip: string; label: string }> = {
  ok:       { dot: 'bg-emerald-500', ring: 'bg-emerald-50',  chip: 'text-emerald-700', label: 'Online' },
  degraded: { dot: 'bg-amber-500',   ring: 'bg-amber-50',    chip: 'text-amber-700',   label: 'Degraded' },
  down:     { dot: 'bg-rose-500',    ring: 'bg-rose-50',     chip: 'text-rose-700',    label: 'Down' },
  unknown:  { dot: 'bg-[#C4BAA8]',   ring: 'bg-[#F5F3EF]',   chip: 'text-[#6B6356]',   label: 'Checking' },
};

export function SystemHealthRow() {
  const { data } = useQuery({
    queryKey: ['ops-system-health'],
    queryFn: async () => {
      const results = await Promise.all(
        PROBES.map(async (p) => ({ key: p.key, state: await probe(p.url, p.timeoutMs) })),
      );
      return Object.fromEntries(results.map((r) => [r.key, r.state])) as Record<string, HealthState>;
    },
    refetchInterval: 60000,
    refetchOnWindowFocus: false,
  });

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <span className={`${sectionLabel} !text-[#A89F91]`}>System health</span>
          <h2 className="text-[16px] sm:text-[18px] font-extrabold tracking-tight text-[#2D2A26] mt-0.5">
            Everything that needs to be up
          </h2>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
        {PROBES.map((p, i) => {
          const state: HealthState = data?.[p.key] ?? 'unknown';
          const tone = TONE[state];
          return (
            <motion.div
              key={p.key}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="flex items-center gap-2.5 bg-white rounded-2xl border border-[#F0EDE8] px-3 py-2.5 shadow-[0_2px_8px_rgba(161,140,90,0.04)]"
            >
              <div className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${tone.ring}`}>
                <span className="relative flex h-2 w-2">
                  {state !== 'unknown' && (
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${tone.dot}`} />
                  )}
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${tone.dot}`} />
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-[12px] font-bold text-[#2D2A26] leading-none truncate">{p.label}</p>
                <p className={`text-[10px] font-black uppercase tracking-[0.14em] mt-1 ${tone.chip}`}>
                  {tone.label}
                </p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
