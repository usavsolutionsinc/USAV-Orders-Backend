'use client';

import React from 'react';
import { motion } from 'framer-motion';

export type StatCategory = 'all' | 'tested' | 'repair' | 'outOfStock' | 'pendingLate' | 'fba';

interface StatCardProps {
  category: StatCategory;
  label: string;
  value: number | string;
  delta?: number;
  icon?: React.ReactNode;
  isLoading?: boolean;
  className?: string;
  maxValue?: number;
}

/**
 * Category → semantic tone tokens (theme registry vars, NOT raw Tailwind hues)
 * so every theme — including mono's grayscale — restyles the dashboard without
 * touching this file. Tone meaning: all=info, tested=success, repair=warning,
 * outOfStock/pendingLate=danger, fba=fulfillment.
 */
const CATEGORY_STYLES: Record<StatCategory, {
  text: string;
  progress: string;
  accent: string;
}> = {
  all: {
    text: 'text-text-info',
    progress: 'bg-fill-info',
    accent: 'bg-fill-info',
  },
  tested: {
    text: 'text-text-success',
    progress: 'bg-fill-success',
    accent: 'bg-fill-success',
  },
  repair: {
    text: 'text-text-warning',
    progress: 'bg-fill-warning',
    accent: 'bg-fill-warning',
  },
  outOfStock: {
    text: 'text-text-danger',
    progress: 'bg-fill-danger',
    accent: 'bg-fill-danger',
  },
  pendingLate: {
    text: 'text-text-danger',
    progress: 'bg-fill-danger',
    accent: 'bg-fill-danger',
  },
  fba: {
    text: 'text-text-fulfillment',
    progress: 'bg-fill-fulfillment',
    accent: 'bg-fill-fulfillment',
  },
};

/**
 * StatCard - A modern 2026 design system component for displaying key performance indicators.
 * Grounded in the USAV design system with semantic category coloring.
 */
export function StatCard({ 
  category, 
  label, 
  value, 
  delta, 
  icon, 
  isLoading, 
  className = '',
  maxValue = 500
}: StatCardProps) {
  const styles = CATEGORY_STYLES[category] || CATEGORY_STYLES.all;
  const numValue = typeof value === 'number' ? value : 0;
  const progressPercent = Math.min(100, (numValue / maxValue) * 100);

  return (
    <div className={`group relative flex flex-col justify-between h-[110px] bg-surface-card px-4 py-3.5 transition-all duration-300 hover:bg-surface-hover border-r border-border-hairline last:border-r-0 ${className}`}>
      {/* 2026 Top Accent Line - subtle normally, vibrant on hover */}
      <div className={`absolute top-0 left-0 right-0 h-[3px] ${styles.accent} opacity-10 group-hover:opacity-100 transition-opacity duration-300`} />
      
      <div className="flex items-center justify-between">
        <span className="text-micro font-black uppercase tracking-[0.15em] text-text-faint group-hover:text-text-muted transition-colors truncate pr-2">
          {label}
        </span>
        <div className="text-text-faint group-hover:text-text-soft transition-colors shrink-0">
          {icon && React.isValidElement(icon) ? React.cloneElement(icon as React.ReactElement, { className: 'w-3.5 h-3.5' }) : null}
        </div>
      </div>

      <div className="flex items-baseline gap-2 mt-1.5">
        {isLoading ? (
          <div className="h-8 w-20 bg-surface-sunken animate-pulse rounded-sm" />
        ) : (
          <motion.span 
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl font-black tracking-tight text-text-default tabular-nums"
          >
            {typeof value === 'number' ? value.toLocaleString() : value}
          </motion.span>
        )}

        {!isLoading && delta !== undefined && delta !== 0 && (
          <motion.span 
            initial={{ opacity: 0, x: -5 }}
            animate={{ opacity: 1, x: 0 }}
            className={`text-caption font-black tabular-nums flex items-center gap-0.5 ${delta >= 0 ? 'text-text-success' : 'text-text-danger'}`}
          >
            <span className="text-mini font-normal">{delta > 0 ? '▲' : '▼'}</span>
            {Math.abs(delta)}%
          </motion.span>
        )}
      </div>

      {/* Modern Progress Indicator - refined 2026 thin bar */}
      <div className="mt-3">
        <div className="h-1 w-full bg-surface-sunken rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 1, ease: "easeOut" }}
            className={`h-full ${styles.progress} opacity-60 group-hover:opacity-100 transition-opacity`}
          />
        </div>
      </div>
    </div>
  );
}
