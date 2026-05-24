'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Clock } from '@/components/Icons';
import type { DashboardData } from '@/features/operations/types';

interface Props {
  summary: DashboardData['summary'] | undefined;
}

/**
 * Surfaces data already returned by /api/dashboard/operations but never rendered:
 * - summary.outOfStock — pending orders flagged out-of-stock
 * - summary.pendingLate — late TEST work_assignments
 */
export function SecondaryKPITiles({ summary }: Props) {
  const oos = summary?.outOfStock.value ?? 0;
  const late = summary?.pendingLate.value ?? 0;

  const tiles = [
    {
      label: 'Out of stock',
      value: oos,
      sub: 'Pending orders flagged',
      Icon: AlertCircle,
      tone: { ring: 'bg-rose-50', text: 'text-rose-700', pulse: 'bg-rose-500' },
      href: '/orders?filter=out_of_stock',
    },
    {
      label: 'Tests overdue',
      value: late,
      sub: 'Past their deadline',
      Icon: Clock,
      tone: { ring: 'bg-amber-50', text: 'text-amber-700', pulse: 'bg-amber-500' },
      href: '/operations',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4">
      {tiles.map((t, i) => (
        <motion.a
          key={t.label}
          href={t.href}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
          whileHover={{ y: -2 }}
          className="block bg-white rounded-2xl border border-[#F0EDE8] p-4 shadow-[0_2px_8px_rgba(161,140,90,0.04)] hover:shadow-[0_4px_14px_rgba(161,140,90,0.08)] transition-shadow"
        >
          <div className="flex items-center justify-between mb-2.5">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${t.tone.ring} ${t.tone.text}`}>
              <t.Icon className="w-4 h-4" />
            </div>
            {t.value > 0 && (
              <span className="relative flex h-2 w-2">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${t.tone.pulse}`} />
                <span className={`relative inline-flex rounded-full h-2 w-2 ${t.tone.pulse}`} />
              </span>
            )}
          </div>
          <div className="text-[24px] font-extrabold text-[#2D2A26] leading-none tabular-nums">{t.value}</div>
          <p className="text-[11px] font-bold text-[#2D2A26] mt-1.5">{t.label}</p>
          <p className="text-[10px] font-medium text-[#A89F91] mt-0.5">{t.sub}</p>
        </motion.a>
      ))}
    </div>
  );
}
