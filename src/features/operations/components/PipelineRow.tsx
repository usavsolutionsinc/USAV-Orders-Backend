'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { sectionLabel } from '@/design-system/tokens/typography/presets';

interface FbaStageCountsResponse {
  success?: boolean;
  counts?: {
    PLANNED?: number;
    TESTED?: number;
    PACKED?: number;
    OUT_OF_STOCK?: number;
    LABEL_ASSIGNED?: number;
  };
}

interface RmaListResponse {
  ok?: boolean;
  authorizations?: { status: string }[];
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

interface StageBarProps {
  title: string;
  href: string;
  stages: { label: string; count: number; color: string }[];
  isLoading?: boolean;
  empty?: boolean;
}

function StageBar({ title, href, stages, isLoading, empty }: StageBarProps) {
  const total = stages.reduce((s, x) => s + x.count, 0);

  return (
    <motion.a
      href={href}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      className="block bg-white rounded-2xl border border-border-soft p-5 shadow-[0_2px_12px_rgba(161,140,90,0.04)] hover:shadow-[0_4px_18px_rgba(161,140,90,0.08)] transition-shadow"
    >
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-[13px] font-extrabold text-text-default tracking-tight">{title}</p>
        <div className="text-[22px] font-extrabold text-text-default tabular-nums leading-none">
          {isLoading ? '–' : total}
        </div>
      </div>

      {empty ? (
        <div className="text-caption text-text-muted py-3">
          Source unavailable — check feature flag / permissions.
        </div>
      ) : (
        <>
          {/* Stacked bar */}
          <div className="h-3 w-full rounded-full bg-surface-canvas overflow-hidden flex">
            {stages.map((s) => (
              <motion.div
                key={s.label}
                initial={{ width: 0 }}
                animate={{ width: total > 0 ? `${(s.count / total) * 100}%` : '0%' }}
                transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                className={`h-full ${s.color}`}
                title={`${s.label}: ${s.count}`}
              />
            ))}
          </div>

          {/* Legend */}
          <div className="grid grid-cols-2 gap-2 mt-4">
            {stages.map((s) => (
              <div key={s.label} className="flex items-center gap-2 min-w-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${s.color}`} />
                <span className="text-micro font-bold uppercase tracking-[0.12em] text-text-muted truncate">
                  {s.label}
                </span>
                <span className="ml-auto text-caption font-extrabold text-text-default tabular-nums">
                  {s.count}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </motion.a>
  );
}

export function PipelineRow() {
  const fba = useQuery({
    queryKey: ['ops-fba-stages'],
    queryFn: () => safeJson<FbaStageCountsResponse>('/api/fba/stage-counts'),
    refetchInterval: 120000,
    retry: false,
  });

  const rma = useQuery({
    queryKey: ['ops-rma-list'],
    queryFn: () => safeJson<RmaListResponse>('/api/rma'),
    refetchInterval: 120000,
    retry: false,
  });

  const fbaCounts = fba.data?.counts ?? {};
  const fbaStages = [
    { label: 'Planned',      count: fbaCounts.PLANNED       ?? 0, color: 'bg-[#C4BAA8]' },
    { label: 'Tested',       count: fbaCounts.TESTED        ?? 0, color: 'bg-emerald-500' },
    { label: 'Packed',       count: fbaCounts.PACKED        ?? 0, color: 'bg-amber-500' },
    { label: 'Out of stock', count: fbaCounts.OUT_OF_STOCK  ?? 0, color: 'bg-rose-500' },
  ];

  const rmaList = rma.data?.authorizations ?? [];
  const rmaByStatus = rmaList.reduce<Record<string, number>>((acc, r) => {
    const key = (r?.status ?? 'OTHER').toUpperCase();
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const rmaStages = [
    { label: 'Authorized',    count: rmaByStatus['AUTHORIZED']    ?? 0, color: 'bg-blue-500' },
    { label: 'Received',      count: rmaByStatus['RECEIVED']      ?? 0, color: 'bg-amber-500' },
    { label: 'Dispositioned', count: rmaByStatus['DISPOSITIONED'] ?? 0, color: 'bg-emerald-500' },
  ];

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <span className={`${sectionLabel} !text-text-muted`}>Pipelines</span>
          <h2 className="text-[18px] sm:text-[20px] font-extrabold tracking-tight text-text-default mt-0.5">
            FBA + RMA at a glance
          </h2>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <StageBar
          title="FBA pipeline"
          href="/fba"
          stages={fbaStages}
          isLoading={fba.isLoading}
          empty={fba.data === null}
        />
        <StageBar
          title="RMA pipeline"
          href="/support"
          stages={rmaStages}
          isLoading={rma.isLoading}
          empty={rma.data === null}
        />
      </div>
    </section>
  );
}
