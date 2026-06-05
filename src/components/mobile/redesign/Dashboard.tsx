'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Package,
  PackageCheck,
  ChevronRight,
  History,
} from '@/components/Icons';
import {
  MobileCard,
  TOKENS,
  SectionHeader,
} from '@/components/mobile/redesign/DesignSystem';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { MobileTopBar } from '@/components/mobile/redesign/MobileTopBar';

/** One recent phone scan, as returned by GET /api/scan/history. */
interface ScanEntry {
  id: number;
  rawValue: string;
  kind: string;
  scannedAt: string;
  type: 'receiving' | 'receiving-line' | 'serial-unit';
  typeLabel: string;
  desktopHref: string;
  mobileHref: string;
}

const TYPE_COPY: Record<ScanEntry['type'], { title: string; received: boolean }> = {
  receiving: { title: 'Receiving label', received: true },
  'receiving-line': { title: 'Line label', received: true },
  'serial-unit': { title: 'Serial unit', received: false },
};

function timeAgo(dateStr: string): string {
  const diffMin = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

export default function RedesignedMobileDashboard() {
  const { user } = useAuth();
  const router = useRouter();
  const staffId = user?.staffId ?? 0;

  const [scans, setScans] = useState<ScanEntry[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchScans = useCallback(async () => {
    try {
      // Pull the full recent list; the window shows ~8 and scrolls up for more.
      const res = await fetch('/api/scan/history?limit=40', {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) {
        setScans([]);
        return;
      }
      const data = (await res.json()) as { entries?: ScanEntry[] };
      setScans(Array.isArray(data.entries) ? data.entries : []);
    } catch {
      setScans([]);
    }
  }, []);

  useEffect(() => {
    void fetchScans();
  }, [fetchScans]);

  // Live-prepend: the scan resolver publishes on scanlog:{staffId} whenever this
  // staffer scans on their phone — refetch so the activity feed updates instantly.
  useAblyChannel(
    staffId > 0 ? `scanlog:${staffId}` : 'scanlog:__idle__',
    'scan_logged',
    () => { void fetchScans(); },
    staffId > 0,
  );

  // The feed reads bottom-up (newest at the bottom, by the thumb) — keep the
  // most recent entry in view as data loads / streams in.
  useEffect(() => {
    if (scans && scans.length > 0) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [scans]);

  // API returns newest-first; reverse so oldest sits on top and newest is last.
  const ordered = scans ? [...scans].reverse() : null;

  return (
    <div className={`flex h-[100dvh] flex-col ${TOKENS.colors.background}`}>
      {/* Shared top bar — identical across every primary mobile page. The
          daily-goal chip rides along here on the dashboard. */}
      <MobileTopBar title="Recent" eyebrow="Activity" icon={History} showGoal />

      {/* Recent Activity — a contained window: the latest ~8 sit at the bottom by
          the nav bar; scroll up to reveal the full recent list. */}
      <div ref={scrollRef} className="flex flex-1 min-h-0 flex-col overflow-y-auto px-4">
        {/* spacer pushes the list to the bottom when it's short */}
        <div className="mt-auto" />
        <div className="pt-6 pb-28">
          <SectionHeader
            title="Recent Activity"
            actionLabel="View All"
            onAction={() => router.push('/m/receiving')}
          />

          <div className="mt-1 flex flex-col gap-3">
          {ordered === null ? (
            // loading skeletons
            [0, 1, 2, 3].map((i) => (
              <MobileCard key={i} className="flex items-center gap-4 py-3.5">
                <div className="h-11 w-11 shrink-0 animate-pulse rounded-2xl bg-blue-50" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-2/3 animate-pulse rounded bg-blue-50" />
                  <div className="h-2 w-1/3 animate-pulse rounded bg-blue-50/70" />
                </div>
              </MobileCard>
            ))
          ) : ordered.length === 0 ? (
            <MobileCard className="py-10 text-center">
              <History className="mx-auto mb-3 h-9 w-9 text-blue-200" />
              <p className="text-[11px] font-black uppercase tracking-widest text-blue-300">
                No scans yet
              </p>
              <p className="mt-1 text-xs font-medium text-blue-700/50">
                Scan a label on your phone to see it here.
              </p>
            </MobileCard>
          ) : (
            ordered.map((scan) => {
              const copy = TYPE_COPY[scan.type] ?? { title: scan.typeLabel, received: true };
              return (
                <motion.div
                  key={scan.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <MobileCard
                    onClick={() => router.push(scan.mobileHref)}
                    className="flex items-center gap-4 py-3.5 group"
                  >
                    <div
                      className={`h-11 w-11 rounded-2xl flex items-center justify-center shadow-sm ${
                        copy.received
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-blue-50 text-blue-600'
                      }`}
                    >
                      {copy.received ? (
                        <PackageCheck className="h-6 w-6" />
                      ) : (
                        <Package className="h-6 w-6" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5 gap-2">
                        <p className="text-sm font-black text-blue-950 truncate tracking-tight font-mono">
                          {scan.rawValue}
                        </p>
                        <span className="shrink-0 text-[9px] font-bold text-blue-300 uppercase">
                          {timeAgo(scan.scannedAt)}
                        </span>
                      </div>
                      <p className="text-[10px] font-bold text-blue-700/60 uppercase tracking-wider flex items-center gap-1.5">
                        <span className="inline-flex items-center rounded border border-blue-100 bg-blue-50/60 px-1.5 py-px text-blue-500">
                          {scan.typeLabel}
                        </span>
                        {copy.title}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-blue-100 group-active:translate-x-1 transition-transform" />
                  </MobileCard>
                </motion.div>
              );
            })
          )}
          {/* Bottom anchor — newest entry scrolls into view here. */}
          <div ref={bottomRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
