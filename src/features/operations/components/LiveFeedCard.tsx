'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Barcode, Package, Wrench, Activity } from '@/components/Icons';
import type { DashboardData } from '@/features/operations/types';
import { sectionLabel } from '@/design-system/tokens/typography/presets';

interface LiveFeedCardProps {
  feed: DashboardData['activityFeed'] | undefined;
  isLoading?: boolean;
  ablyStatus?: 'connected' | 'connecting' | 'disconnected';
}

/** Friendly icon + tone per activity type — uses real station_activity_logs.activity_type */
function styleForType(type: string): {
  Icon: React.ComponentType<{ className?: string }>;
  ring: string;
  text: string;
  label: string;
} {
  switch (type) {
    case 'FNSKU_SCANNED':
      return { Icon: Barcode,  ring: 'bg-purple-50',   text: 'text-purple-600',  label: 'FNSKU scan' };
    case 'TRACKING_SCANNED':
      return { Icon: Barcode,  ring: 'bg-blue-50',     text: 'text-blue-600',    label: 'Tracking scan' };
    case 'PACK_SCAN':
    case 'PACK_COMPLETED':
      return { Icon: Package,  ring: 'bg-amber-50',    text: 'text-amber-700',   label: 'Pack' };
    case 'FBA_READY':
      return { Icon: Package,  ring: 'bg-emerald-50',  text: 'text-emerald-600', label: 'FBA ready' };
    default:
      // Repair / tech / catch-all
      if (type.startsWith('REPAIR')) {
        return { Icon: Wrench, ring: 'bg-orange-50', text: 'text-orange-600', label: 'Repair' };
      }
      return { Icon: Activity, ring: 'bg-[#F5F3EF]', text: 'text-[#6B6356]', label: type.replace(/_/g, ' ').toLowerCase() };
  }
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function LiveFeedCard({ feed, isLoading, ablyStatus = 'connected' }: LiveFeedCardProps) {
  const rows = (feed ?? []).slice(0, 12);

  return (
    <section>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <span className={`${sectionLabel} !text-[#A89F91]`}>
            Live feed
          </span>
          <h2 className="text-[20px] sm:text-[22px] font-extrabold tracking-tight text-[#2D2A26] mt-1">
            What’s happening on the floor
          </h2>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-[#E8E4DD] shrink-0">
          <span className="relative flex h-1.5 w-1.5">
            <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping ${
              ablyStatus === 'connected' ? 'bg-emerald-500' :
              ablyStatus === 'connecting' ? 'bg-amber-400' : 'bg-rose-400'
            }`} />
            <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${
              ablyStatus === 'connected' ? 'bg-emerald-500' :
              ablyStatus === 'connecting' ? 'bg-amber-500' : 'bg-rose-500'
            }`} />
          </span>
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-[#6B6356]">
            {ablyStatus === 'connected' ? 'Live' : ablyStatus}
          </span>
        </div>
      </div>

      <div className="bg-white rounded-[28px] shadow-[0_4px_24px_rgba(161,140,90,0.06)] p-3 sm:p-4">
        {isLoading && rows.length === 0 ? (
          <ul className="divide-y divide-[#F5F3EF]">
            {Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-3 animate-pulse">
                <div className="w-9 h-9 rounded-xl bg-[#F5F3EF]" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-[#F5F3EF] rounded w-1/2" />
                  <div className="h-2.5 bg-[#F5F3EF] rounded w-1/3" />
                </div>
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-[13px] font-semibold text-[#6B6356]">No activity yet today.</p>
            <p className="text-[11px] text-[#A89F91] mt-1">New scans, packs, and tests will appear here in real time.</p>
          </div>
        ) : (
          <ul className="divide-y divide-[#F5F3EF]">
            <AnimatePresence initial={false}>
              {rows.map((row) => {
                const { Icon, ring, text, label } = styleForType(row.type);
                return (
                  <motion.li
                    key={row.id}
                    layout
                    initial={{ opacity: 0, x: -8, height: 0 }}
                    animate={{ opacity: 1, x: 0, height: 'auto' }}
                    exit={{ opacity: 0, x: 8, height: 0 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    className="flex items-center gap-3 px-3 py-3"
                  >
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${ring} ${text}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase tracking-[0.14em] text-[#A89F91]">
                          {label}
                        </span>
                        {row.source && (
                          <span className="text-[10px] font-bold text-[#C4BAA8] uppercase">
                            · {row.source}
                          </span>
                        )}
                      </div>
                      <p className="text-[13px] font-semibold text-[#2D2A26] truncate leading-tight mt-0.5">
                        {row.summary}
                      </p>
                      {row.actor_name && (
                        <p className="text-[10px] text-[#A89F91] font-medium mt-0.5 truncate">
                          by {row.actor_name}
                        </p>
                      )}
                    </div>
                    <span className="text-[10px] font-semibold text-[#A89F91] tabular-nums shrink-0">
                      {timeAgo(row.timestamp)}
                    </span>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </section>
  );
}
