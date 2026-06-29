'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { AlertCircle, Package, Wrench } from '@/components/Icons';
import { sectionLabel } from '@/design-system/tokens/typography/presets';

async function safeJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface TrackingExceptionsResponse {
  success?: boolean;
  rows?: unknown[];
  total?: number;
}

interface ReplenTasksResponse {
  ok?: boolean;
  tasks?: { detected_at?: string }[];
}

export function ExceptionsRow() {
  const tracking = useQuery({
    queryKey: ['ops-exceptions-tracking'],
    queryFn: () => safeJson<TrackingExceptionsResponse>('/api/tracking-exceptions?status=open&domain=receiving&limit=1'),
    refetchInterval: 120000,
    retry: false,
  });

  const trackingOrders = useQuery({
    queryKey: ['ops-exceptions-tracking-orders'],
    queryFn: () => safeJson<TrackingExceptionsResponse>('/api/tracking-exceptions?status=open&domain=orders&limit=1'),
    refetchInterval: 120000,
    retry: false,
  });

  const replen = useQuery({
    queryKey: ['ops-exceptions-replen'],
    queryFn: () => safeJson<ReplenTasksResponse>('/api/replenishment/tasks'),
    refetchInterval: 120000,
    retry: false,
  });

  // tracking-exceptions endpoint may return `total` OR just `rows.length`
  const trackingCount =
    (tracking.data?.total ?? tracking.data?.rows?.length ?? 0) +
    (trackingOrders.data?.total ?? trackingOrders.data?.rows?.length ?? 0);

  const replenTasks = replen.data?.tasks ?? [];
  const replenCount = replenTasks.length;
  const oldestReplen = replenTasks.reduce<Date | null>((oldest, t) => {
    if (!t?.detected_at) return oldest;
    const d = new Date(t.detected_at);
    if (Number.isNaN(d.getTime())) return oldest;
    return !oldest || d < oldest ? d : oldest;
  }, null);
  const oldestReplenHours = oldestReplen
    ? Math.max(0, Math.round((Date.now() - oldestReplen.getTime()) / 36e5))
    : null;

  const cards = [
    {
      key: 'tracking',
      label: 'Tracking exceptions',
      value: trackingCount,
      sub: 'Open across receiving + orders',
      Icon: AlertCircle,
      tone: { ring: 'bg-rose-50', text: 'text-rose-700', accent: 'bg-rose-500' },
      href: '/audit-log',
      disabled: tracking.data === null && trackingOrders.data === null,
    },
    {
      key: 'replen',
      label: 'Replenishment backlog',
      value: replenCount,
      sub: oldestReplenHours != null ? `Oldest: ${oldestReplenHours}h ago` : 'No open tasks',
      Icon: Package,
      tone: { ring: 'bg-amber-50', text: 'text-amber-700', accent: 'bg-amber-500' },
      href: '/inventory?section=replenish',
      disabled: replen.data === null,
    },
    {
      key: 'aged',
      label: 'Aged repairs > 48h',
      value: '–',
      sub: 'Wire from /api/work-orders when ready',
      Icon: Wrench,
      tone: { ring: 'bg-orange-50', text: 'text-orange-700', accent: 'bg-orange-500' },
      href: '/repair',
      disabled: true,
    },
  ];

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <span className={`${sectionLabel} !text-text-muted`}>Exceptions</span>
          <h2 className="text-[18px] sm:text-[20px] font-extrabold tracking-tight text-text-default mt-0.5">
            What needs human eyes today
          </h2>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        {cards.map((c, i) => (
          <motion.a
            key={c.key}
            href={c.disabled ? undefined : c.href}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            whileHover={c.disabled ? undefined : { y: -2 }}
            className={`block bg-white rounded-2xl border border-border-soft p-5 shadow-[0_2px_12px_rgba(161,140,90,0.04)] ${
              c.disabled ? 'opacity-60 cursor-not-allowed' : 'hover:shadow-[0_4px_18px_rgba(161,140,90,0.08)] transition-shadow'
            }`}
          >
            <div className="flex items-start justify-between mb-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${c.tone.ring} ${c.tone.text}`}>
                <c.Icon className="w-4 h-4" />
              </div>
              {typeof c.value === 'number' && c.value > 0 && (
                <span className="relative flex h-2 w-2 mt-1">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${c.tone.accent}`} />
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${c.tone.accent}`} />
                </span>
              )}
            </div>
            <div className="text-[30px] font-extrabold text-text-default leading-none tabular-nums">
              {c.value}
            </div>
            <p className="text-label font-bold text-text-default mt-2">{c.label}</p>
            <p className="text-caption font-medium text-text-muted mt-0.5">{c.sub}</p>
          </motion.a>
        ))}
      </div>
    </section>
  );
}
