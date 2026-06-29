'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Package, AlertCircle, TrendingUp, Activity } from '@/components/Icons';
import { sectionLabel } from '@/design-system/tokens/typography/presets';

interface BinsOverviewResponse {
  success: boolean;
  buckets?: {
    total: number;
    fill?: number;
    stale: number;
    low_stock: number;
    over_capacity: number;
  };
}

const CARDS = [
  { key: 'total',         label: 'Bins total',     Icon: Package,      tone: { ring: 'bg-surface-canvas',  text: 'text-text-muted' } },
  { key: 'low_stock',     label: 'Low stock',      Icon: TrendingUp,   tone: { ring: 'bg-amber-50',   text: 'text-amber-700' } },
  { key: 'stale',         label: 'Stale > 90d',    Icon: Activity,     tone: { ring: 'bg-blue-50',    text: 'text-blue-700' } },
  { key: 'over_capacity', label: 'Over capacity',  Icon: AlertCircle,  tone: { ring: 'bg-rose-50',    text: 'text-rose-700' } },
] as const;

export function InventoryHealthRow() {
  const { data, isLoading } = useQuery<BinsOverviewResponse>({
    queryKey: ['ops-inventory-health'],
    queryFn: async () => {
      const res = await fetch('/api/inventory/bins-overview', { cache: 'no-store' });
      if (!res.ok) throw new Error(`bins-overview ${res.status}`);
      return res.json();
    },
    refetchInterval: 120000,
    retry: false,
  });

  const buckets = data?.buckets;

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <span className={`${sectionLabel} !text-text-muted`}>Inventory health</span>
          <h2 className="text-[18px] sm:text-[20px] font-extrabold tracking-tight text-text-default mt-0.5">
            Where the warehouse needs attention
          </h2>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {CARDS.map((c, i) => {
          const value = buckets ? (buckets as any)[c.key] ?? 0 : undefined;
          const isAlert = c.key !== 'total' && (value ?? 0) > 0;
          return (
            <motion.a
              key={c.key}
              href="/inventory"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              whileHover={{ y: -2 }}
              className="block bg-white rounded-2xl border border-border-soft p-4 shadow-[0_2px_12px_rgba(161,140,90,0.04)] hover:shadow-[0_4px_18px_rgba(161,140,90,0.08)] transition-shadow"
            >
              <div className="flex items-start justify-between mb-3">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${c.tone.ring} ${c.tone.text}`}>
                  <c.Icon className="w-4 h-4" />
                </div>
                {isAlert && (
                  <span className="text-eyebrow font-black uppercase tracking-[0.14em] bg-rose-50 text-rose-700 rounded-full px-1.5 py-0.5">
                    Alert
                  </span>
                )}
              </div>
              <div className="text-[28px] font-extrabold text-text-default leading-none tabular-nums">
                {isLoading ? '–' : (value ?? 0)}
              </div>
              <p className="text-caption font-medium text-text-muted mt-1.5 leading-tight">{c.label}</p>
            </motion.a>
          );
        })}
      </div>
    </section>
  );
}
