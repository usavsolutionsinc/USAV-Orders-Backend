'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Headset } from 'lucide-react';
import { sectionLabel } from '@/design-system/tokens/typography/presets';

interface SupportOverviewResponse {
  success?: boolean;
  totals?: {
    unreadMessages: number;
    returnRequests: number;
    zendeskTickets: number;
    attentionItems: number;
  };
  ebayAccounts?: { accountName: string; unreadMessages: { count: number }; returnRequests: { count: number } }[];
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
    { label: 'eBay messages',  value: totals?.unreadMessages ?? 0, tone: 'text-blue-700',  ring: 'bg-blue-50' },
    { label: 'Open returns',   value: totals?.returnRequests ?? 0, tone: 'text-amber-700', ring: 'bg-amber-50' },
    { label: 'Zendesk tickets',value: totals?.zendeskTickets ?? 0, tone: 'text-emerald-700', ring: 'bg-emerald-50' },
  ];

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <span className={`${sectionLabel} !text-[#A89F91]`}>Customer support</span>
          <h2 className="text-[18px] sm:text-[20px] font-extrabold tracking-tight text-[#2D2A26] mt-0.5">
            Who needs a reply
          </h2>
        </div>
        {hasAttention && (
          <span className="text-[10px] font-black uppercase tracking-[0.14em] bg-amber-50 text-amber-700 rounded-full px-2 py-1">
            {totals?.attentionItems} need attention
          </span>
        )}
      </div>

      <motion.a
        href="/support"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ y: -2 }}
        className="block bg-white rounded-2xl border border-[#F0EDE8] p-5 shadow-[0_2px_12px_rgba(161,140,90,0.04)] hover:shadow-[0_4px_18px_rgba(161,140,90,0.08)] transition-shadow"
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-[#F5F3EF] text-[#6B6356] flex items-center justify-center shrink-0">
            <Headset className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <p className="text-[13px] font-extrabold text-[#2D2A26] tracking-tight">eBay + Zendesk</p>
            <p className="text-[11px] font-medium text-[#A89F91]">Live across all active accounts</p>
          </div>
        </div>

        {data === null ? (
          <p className="text-[11px] text-[#A89F91]">Source unavailable.</p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {tiles.map((t) => (
              <div key={t.label} className={`rounded-xl p-3 ${t.ring}`}>
                <div className="text-[24px] font-extrabold text-[#2D2A26] tabular-nums leading-none">
                  {isLoading ? '–' : t.value}
                </div>
                <p className={`text-[10px] font-black uppercase tracking-[0.14em] mt-1.5 ${t.tone}`}>
                  {t.label}
                </p>
              </div>
            ))}
          </div>
        )}

        {data?.ebayAccounts && data.ebayAccounts.length > 0 && (
          <div className="mt-4 pt-4 border-t border-[#F5F3EF]">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#A89F91] mb-2">
              By eBay account
            </p>
            <ul className="space-y-1.5">
              {data.ebayAccounts.map((acc) => (
                <li key={acc.accountName} className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-[#2D2A26] truncate">{acc.accountName}</span>
                  <span className="text-[#A89F91] tabular-nums">
                    {acc.unreadMessages.count} msgs · {acc.returnRequests.count} returns
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </motion.a>
    </section>
  );
}
