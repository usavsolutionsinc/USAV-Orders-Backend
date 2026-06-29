'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { velocityTierMeta } from '@/lib/velocity-tier-tone';

interface VelocityRow {
  sku: string;
  product_title: string;
  out_qty: number;
  in_qty: number;
  current_stock: number;
  velocity_tier: 'A' | 'B' | 'C' | 'D' | null;
}

interface DeadStockRow {
  sku: string;
  product_title: string;
  stock: number;
  days_dormant: number | null;
}

async function safeJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function TierDonut({ counts }: { counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((s, x) => s + x, 0) || 1;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let cumulative = 0;
  return (
    <div className="relative w-[140px] h-[140px] shrink-0 mx-auto">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="#F0EDE8" strokeWidth="10" />
        {(['A', 'B', 'C', 'D'] as const).map((tier) => {
          const v = counts[tier] ?? 0;
          if (v === 0) return null;
          const slice = (v / total) * circumference;
          const dashArray = `${slice} ${circumference - slice}`;
          const dashOffset = -cumulative;
          cumulative += slice;
          return (
            <motion.circle
              key={tier}
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              strokeWidth="10"
              strokeDasharray={dashArray}
              strokeDashoffset={dashOffset}
              className={
                tier === 'A' ? 'stroke-emerald-500' :
                tier === 'B' ? 'stroke-amber-500' :
                tier === 'C' ? 'stroke-orange-500' : 'stroke-rose-500'
              }
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8 }}
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[24px] font-extrabold text-text-default tabular-nums leading-none">{total}</span>
        <span className="text-eyebrow font-black uppercase tracking-[0.16em] text-text-muted mt-1">
          SKUs scored
        </span>
      </div>
    </div>
  );
}

export function VelocityAndDeadStock() {
  const velocity = useQuery({
    queryKey: ['ops-velocity'],
    queryFn: () => safeJson<{ success: boolean; rows: VelocityRow[] }>('/api/reports/velocity?limit=2000'),
    refetchInterval: 300000,
    retry: false,
  });

  const dead = useQuery({
    queryKey: ['ops-dead-stock'],
    queryFn: () => safeJson<{ success: boolean; rows: DeadStockRow[] }>('/api/reports/dead-stock?minDays=90&limit=500'),
    refetchInterval: 300000,
    retry: false,
  });

  const velocityRows = velocity.data?.rows ?? [];
  const tierCounts = velocityRows.reduce<Record<string, number>>((acc, r) => {
    if (!r.velocity_tier) return acc;
    acc[r.velocity_tier] = (acc[r.velocity_tier] ?? 0) + 1;
    return acc;
  }, {});

  const topMovers = velocityRows
    .filter((r) => (r.out_qty ?? 0) > 0)
    .slice(0, 5);

  const deadRows = dead.data?.rows ?? [];
  const deadCount = deadRows.length;
  const oldestDormant = deadRows[0]?.days_dormant ?? null;

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <span className={`${sectionLabel} !text-text-muted`}>Inventory motion · 30 days</span>
          <h2 className="text-[18px] sm:text-[20px] font-extrabold tracking-tight text-text-default mt-0.5">
            What’s moving, what isn’t
          </h2>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Velocity tier mix donut */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl border border-border-soft p-5 shadow-[0_2px_12px_rgba(161,140,90,0.04)]"
        >
          <p className="text-label font-extrabold text-text-default tracking-tight mb-4">Velocity tier mix</p>
          <TierDonut counts={tierCounts} />
          <div className="grid grid-cols-2 gap-2 mt-5">
            {(['A', 'B', 'C', 'D'] as const).map((t) => {
              const tone = velocityTierMeta(t);
              return (
                <div key={t} className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${tone.bg}`} />
                  <span className="text-micro font-bold uppercase tracking-[0.12em] text-text-muted">
                    {tone.label}
                  </span>
                  <span className="ml-auto text-caption font-extrabold text-text-default tabular-nums">
                    {tierCounts[t] ?? 0}
                  </span>
                </div>
              );
            })}
          </div>
        </motion.div>

        {/* Top movers list */}
        <motion.a
          href="/products"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          whileHover={{ y: -2 }}
          className="block lg:col-span-1 bg-white rounded-2xl border border-border-soft p-5 shadow-[0_2px_12px_rgba(161,140,90,0.04)] hover:shadow-[0_4px_18px_rgba(161,140,90,0.08)] transition-shadow"
        >
          <div className="flex items-baseline justify-between mb-4">
            <p className="text-label font-extrabold text-text-default tracking-tight">Top movers</p>
            <span className="text-micro font-bold text-text-muted uppercase tracking-[0.14em]">30d</span>
          </div>
          {velocity.data === null ? (
            <p className="text-caption text-text-muted py-2">Source unavailable.</p>
          ) : topMovers.length === 0 ? (
            <p className="text-caption text-text-muted py-2">No movement in the last 30 days.</p>
          ) : (
            <ul className="space-y-2.5">
              {topMovers.map((row) => (
                <li key={row.sku} className="flex items-center gap-3">
                  <span className="text-micro font-black text-text-muted tabular-nums w-8">{row.out_qty}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-label font-bold text-text-default truncate leading-tight">{row.product_title || row.sku}</p>
                    <p className="text-micro font-medium text-text-muted font-mono truncate">{row.sku}</p>
                  </div>
                  {row.velocity_tier && (
                    <span className={`text-eyebrow font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full ${velocityTierMeta(row.velocity_tier).ring} ${
                      row.velocity_tier === 'A' ? 'text-emerald-700' :
                      row.velocity_tier === 'B' ? 'text-amber-700' :
                      row.velocity_tier === 'C' ? 'text-orange-700' : 'text-rose-700'
                    }`}>
                      {row.velocity_tier}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </motion.a>

        {/* Dead stock tile */}
        <motion.a
          href="/products?filter=dormant"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          whileHover={{ y: -2 }}
          className="block bg-white rounded-2xl border border-border-soft p-5 shadow-[0_2px_12px_rgba(161,140,90,0.04)] hover:shadow-[0_4px_18px_rgba(161,140,90,0.08)] transition-shadow"
        >
          <div className="flex items-baseline justify-between mb-3">
            <p className="text-label font-extrabold text-text-default tracking-tight">Dead stock</p>
            <span className="text-micro font-bold text-text-muted uppercase tracking-[0.14em]">≥ 90d</span>
          </div>
          <div className="text-[36px] font-extrabold text-text-default leading-none tabular-nums">
            {dead.isLoading ? '–' : deadCount}
          </div>
          <p className="text-caption font-medium text-text-muted mt-2">
            {oldestDormant != null
              ? `Oldest dormant: ${oldestDormant} days`
              : dead.data === null
              ? 'Source unavailable.'
              : 'No dormant SKUs flagged.'}
          </p>
          {deadRows[0] && (
            <div className="mt-4 pt-3 border-t border-border-soft">
              <p className="text-micro font-black uppercase tracking-[0.14em] text-text-muted mb-1">
                Oldest item
              </p>
              <p className="text-label font-bold text-text-default truncate">{deadRows[0].product_title || deadRows[0].sku}</p>
              <p className="text-micro text-text-muted font-mono truncate">{deadRows[0].sku}</p>
            </div>
          )}
        </motion.a>
      </div>
    </section>
  );
}
