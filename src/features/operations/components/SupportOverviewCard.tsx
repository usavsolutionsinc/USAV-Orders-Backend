'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Headset } from 'lucide-react';
import { sectionLabel } from '@/design-system/tokens/typography/presets';

interface SupportOverviewResponse {
  success?: boolean;
  totals?: {
    zendeskTickets: number;
    attentionItems: number;
  };
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

export function SupportOverviewCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['ops-support-overview'],
    queryFn: () => safeJson<SupportOverviewResponse>('/api/support/overview'),
    refetchInterval: 180000,
    retry: false,
  });

  const totals = data?.totals;
  const hasAttention = (totals?.attentionItems ?? 0) > 0;

  const tiles = [
    { label: 'Zendesk tickets', value: totals?.zendeskTickets ?? 0, tone: 'text-emerald-700', ring: 'bg-emerald-50' },
  ];

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <span className={`${sectionLabel} !text-text-muted`}>Customer support</span>
          <h2 className="text-[18px] sm:text-[20px] font-extrabold tracking-tight text-text-default mt-0.5">
            Who needs a reply
          </h2>
        </div>
        {hasAttention && (
          <span className="text-micro font-black uppercase tracking-[0.14em] bg-amber-50 text-amber-700 rounded-full px-2 py-1">
            {totals?.attentionItems} need attention
          </span>
        )}
      </div>

      <motion.a
        href="/support"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ y: -2 }}
        className="block bg-surface-card rounded-2xl border border-border-soft p-5 shadow-[0_2px_12px_rgba(161,140,90,0.04)] hover:shadow-[0_4px_18px_rgba(161,140,90,0.08)] transition-shadow"
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-surface-canvas text-text-muted flex items-center justify-center shrink-0">
            <Headset className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <p className="text-[13px] font-extrabold text-text-default tracking-tight">Zendesk tickets</p>
            <p className="text-caption font-medium text-text-muted">Open support queue</p>
          </div>
        </div>

        {data === null ? (
          <p className="text-caption text-text-muted">Source unavailable.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {tiles.map((t) => (
              <div key={t.label} className={`rounded-xl p-3 ${t.ring}`}>
                <div className="text-[24px] font-extrabold text-text-default tabular-nums leading-none">
                  {isLoading ? '–' : t.value}
                </div>
                <p className={`text-micro font-black uppercase tracking-[0.14em] mt-1.5 ${t.tone}`}>
                  {t.label}
                </p>
              </div>
            ))}
          </div>
        )}
      </motion.a>
    </section>
  );
}
