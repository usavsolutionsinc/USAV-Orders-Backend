'use client';

import React, { useCallback, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { Info } from 'lucide-react';
import { AlertCircle, Clock } from '@/components/Icons';
import type { DashboardData } from '@/features/operations/types';
import { DataSourcePopover, type DataSourceInfo } from '@/features/operations/components/DataSourcePopover';
import { OPERATIONS_SECONDARY_KPI_SOURCES } from '@/features/operations/operations-data-sources';

interface Props {
  summary: DashboardData['summary'] | undefined;
}

/** Tile: click body navigates; (i) opens data-source without navigation */
function SecondaryTile({
  label,
  value,
  sub,
  Icon,
  tone,
  href,
  sourceDef,
}: {
  label: string;
  value: number;
  sub: string;
  Icon: typeof AlertCircle;
  tone: { ring: string; text: string; pulse: string };
  href: string;
  sourceDef: DataSourceInfo;
}) {
  const router = useRouter();
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);

  const go = useCallback(() => {
    router.push(href);
  }, [href, router]);

  return (
    <motion.div
      ref={anchorRef}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      className={`relative rounded-2xl border border-[#F0EDE8] bg-white p-4 shadow-[0_2px_8px_rgba(161,140,90,0.04)] transition-shadow hover:shadow-[0_4px_14px_rgba(161,140,90,0.08)] ${'cursor-pointer'}`}
      role="button"
      tabIndex={0}
      aria-label={`${label}: ${value}. ${sub}`}
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          go();
        }
      }}
    >
      <DataSourcePopover
        info={sourceDef}
        anchorRef={anchorRef}
        open={sourceOpen}
        onOpenChange={setSourceOpen}
      />
      <button
        type="button"
        aria-label={`Data source for ${label}`}
        aria-expanded={sourceOpen}
        className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-lg text-[#A89F91] transition-colors hover:bg-[#F5F3EF] hover:text-[#5C5548]"
        onClick={(e) => {
          e.stopPropagation();
          setSourceOpen((o) => !o);
        }}
      >
        <Info className="h-3.5 w-3.5" strokeWidth={2.25} />
      </button>

      <div className="flex items-start justify-between pr-7">
        <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${tone.ring} ${tone.text}`}>
          <Icon className="h-4 w-4" />
        </div>
        {value > 0 && (
          <span className="relative flex h-2 w-2">
            <span
              className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${tone.pulse}`}
            />
            <span className={`relative inline-flex h-2 w-2 rounded-full ${tone.pulse}`} />
          </span>
        )}
      </div>
      <div className="mt-2 tabular-nums text-[24px] font-extrabold leading-none text-[#2D2A26]">{value}</div>
      <p className="mt-1.5 text-[11px] font-bold text-[#2D2A26]">{label}</p>
      <p className="mt-0.5 text-[10px] font-medium text-[#A89F91]">{sub}</p>
    </motion.div>
  );
}

/**
 * Data from `/api/dashboard/operations`:
 * summary.outOfStock, summary.pendingLate
 */
export function SecondaryKPITiles({ summary }: Props) {
  const oos = summary?.outOfStock.value ?? 0;
  const late = summary?.pendingLate.value ?? 0;

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4">
      <SecondaryTile
        label="Out of stock"
        value={oos}
        sub="Pending orders flagged"
        Icon={AlertCircle}
        tone={{ ring: 'bg-rose-50', text: 'text-rose-700', pulse: 'bg-rose-500' }}
        href="/orders?filter=out_of_stock"
        sourceDef={OPERATIONS_SECONDARY_KPI_SOURCES.outOfStock}
      />
      <SecondaryTile
        label="Tests overdue"
        value={late}
        sub="Past their deadline"
        Icon={Clock}
        tone={{ ring: 'bg-amber-50', text: 'text-amber-700', pulse: 'bg-amber-500' }}
        href="/operations"
        sourceDef={OPERATIONS_SECONDARY_KPI_SOURCES.testsOverdue}
      />
    </div>
  );
}
