'use client';

import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useBodyScrollLock, useEscapeClose } from '@/design-system/hooks';
import { formatDistanceToNowStrict } from 'date-fns';
import type { DashboardData } from '@/features/operations/types';
import { useRepairsTable } from '@/hooks/useRepairs';

export type KpiKind = 'velocity' | 'tested' | 'fba' | 'repair';

type ActivityRow = DashboardData['activityFeed'][number];

type KpiDetailsModalProps = {
  kind: KpiKind | null;
  value?: number;
  activityFeed?: DashboardData['activityFeed'];
  onClose: () => void;
};

const TITLES: Record<KpiKind, { title: string; subtitle: string; tone: 'amber' | 'emerald' | 'orange'; emptyHint: string }> = {
  velocity: {
    title: 'Daily velocity',
    subtitle: 'Every unit your floor has touched today',
    tone: 'amber',
    emptyHint: 'No scans logged yet today. Activity will appear here as soon as your team starts working.',
  },
  tested: {
    title: 'Tested today',
    subtitle: 'Units cleared through QA at the Tech bench',
    tone: 'emerald',
    emptyHint: 'No items have been tested yet today.',
  },
  fba: {
    title: 'FBA intake',
    subtitle: 'FNSKU units scanned into Amazon shipments',
    tone: 'amber',
    emptyHint: 'No FBA scans logged today yet.',
  },
  repair: {
    title: 'Repair queue',
    subtitle: 'Units currently waiting on the repair bench',
    tone: 'orange',
    emptyHint: 'The repair queue is clear — nothing pending right now.',
  },
};

const TONE_RING: Record<'amber' | 'emerald' | 'orange', string> = {
  amber: 'bg-amber-50 text-amber-700',
  emerald: 'bg-emerald-50 text-emerald-600',
  orange: 'bg-orange-50 text-orange-600',
};

const ACTIVITY_LABEL: Record<string, string> = {
  TRACKING_SCANNED: 'Receiving scan',
  FNSKU_SCANNED: 'FBA scan',
  PACK_SCAN: 'Pack scan',
  PACK_COMPLETED: 'Packed',
  FBA_READY: 'FBA ready',
};

const ACTIVITY_DOT: Record<string, string> = {
  TRACKING_SCANNED: 'bg-blue-500',
  FNSKU_SCANNED: 'bg-amber-500',
  PACK_SCAN: 'bg-purple-500',
  PACK_COMPLETED: 'bg-emerald-500',
  FBA_READY: 'bg-emerald-600',
};

const REPAIR_STATUS_TONE: Record<string, string> = {
  'Incoming Shipment': 'bg-blue-50 text-blue-600',
  'Awaiting Parts': 'bg-orange-50 text-orange-600',
  'Awaiting Additional Parts Payment': 'bg-orange-50 text-orange-600',
  'Pending Repair': 'bg-amber-50 text-amber-700',
  'Awaiting Pickup': 'bg-emerald-50 text-emerald-600',
  'Awaiting Payment': 'bg-rose-50 text-rose-600',
  'Repaired, Contact Customer': 'bg-blue-50 text-blue-600',
};

function relativeTime(iso: string): string {
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
  } catch {
    return '';
  }
}

function filterFeed(kind: KpiKind, feed: ActivityRow[] | undefined): ActivityRow[] {
  if (!feed) return [];
  if (kind === 'velocity') {
    return feed.filter((r) =>
      ['TRACKING_SCANNED', 'FNSKU_SCANNED', 'PACK_SCAN', 'PACK_COMPLETED', 'FBA_READY'].includes(r.type),
    );
  }
  if (kind === 'tested') {
    return feed.filter((r) => r.source === 'TECH' && ['TRACKING_SCANNED', 'FNSKU_SCANNED'].includes(r.type));
  }
  if (kind === 'fba') {
    return feed.filter((r) => r.type === 'FNSKU_SCANNED');
  }
  return [];
}

function ActivityList({ rows, emptyHint }: { rows: ActivityRow[]; emptyHint: string }) {
  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-[12px] font-medium text-[#A89F91]">
        {emptyHint}
      </div>
    );
  }

  return (
    <ul className="divide-y divide-[#F0EDE8]">
      {rows.map((row) => {
        const label = ACTIVITY_LABEL[row.type] ?? row.type.replace(/_/g, ' ').toLowerCase();
        const dot = ACTIVITY_DOT[row.type] ?? 'bg-[#C4BAA8]';
        return (
          <li key={row.id} className="flex items-start gap-3 px-4 py-3">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-[#2D2A26]">{label}</span>
                {row.source ? (
                  <span className="rounded-full bg-[#FAFAF8] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#6B6356]">
                    {row.source}
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 truncate text-[12px] font-medium text-[#4A4239]">{row.summary || '—'}</p>
              <div className="mt-0.5 flex items-center gap-2 text-[10px] font-semibold text-[#A89F91]">
                {row.actor_name ? <span>{row.actor_name}</span> : null}
                {row.actor_name ? <span>·</span> : null}
                <span className="tabular-nums">{relativeTime(row.timestamp)}</span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function RepairList({ emptyHint }: { emptyHint: string }) {
  const { data: repairs = [], isLoading } = useRepairsTable(null, 'active');

  const sorted = useMemo(() => {
    return [...repairs].sort((a, b) => {
      const at = new Date(a.updated_at || a.created_at).getTime();
      const bt = new Date(b.updated_at || b.created_at).getTime();
      return at - bt;
    });
  }, [repairs]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] font-semibold text-[#A89F91]">
        Loading repair queue…
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-[12px] font-medium text-[#A89F91]">
        {emptyHint}
      </div>
    );
  }

  return (
    <ul className="divide-y divide-[#F0EDE8]">
      {sorted.map((r) => {
        const statusTone = REPAIR_STATUS_TONE[r.status] ?? 'bg-[#FAFAF8] text-[#6B6356]';
        const customer = r.customer_name || r.contact_info || 'Unknown customer';
        const age = relativeTime(r.created_at);
        return (
          <li key={r.id} className="flex items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-[#FAFAF8] px-2 py-0.5 font-mono text-[10px] font-bold text-[#2D2A26]">
                  #{r.ticket_number}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${statusTone}`}>
                  {r.status}
                </span>
              </div>
              <p className="mt-1 truncate text-[12px] font-semibold text-[#2D2A26]">{customer}</p>
              <p className="mt-0.5 truncate text-[11px] font-medium text-[#6B6356]">{r.product_title || r.issue || '—'}</p>
            </div>
            <span className="shrink-0 whitespace-nowrap pt-1 text-[10px] font-semibold tabular-nums text-[#A89F91]">
              {age}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function KpiDetailsModal({ kind, value, activityFeed, onClose }: KpiDetailsModalProps) {
  useEscapeClose(Boolean(kind), onClose);
  useBodyScrollLock(Boolean(kind));

  if (typeof document === 'undefined') return null;

  const meta = kind ? TITLES[kind] : null;
  const filtered = kind && kind !== 'repair' ? filterFeed(kind, activityFeed) : [];

  return createPortal(
    <AnimatePresence>
      {kind && meta ? (
        <motion.div
          key="kpi-modal"
          className="fixed inset-0 z-[300] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div
            className="absolute inset-0 bg-[#2D2A26]/40 backdrop-blur-[2px]"
            onClick={onClose}
            aria-hidden
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={meta.title}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 4 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="relative flex w-full max-w-[520px] flex-col overflow-hidden rounded-3xl border border-[#E8E4DD] bg-white shadow-[0_24px_60px_rgba(45,42,38,0.18)]"
            style={{ maxHeight: 'min(600px, 88vh)' }}
          >
            <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
              <div className="min-w-0">
                <p className="text-[18px] font-extrabold leading-tight text-[#2D2A26]">{meta.title}</p>
                <p className="mt-0.5 text-[12px] font-medium leading-snug text-[#6B6356]">{meta.subtitle}</p>
              </div>
              <div className="flex items-center gap-2">
                {typeof value === 'number' ? (
                  <span className={`rounded-full px-2.5 py-1 text-[12px] font-extrabold tabular-nums ${TONE_RING[meta.tone]}`}>
                    {value.toLocaleString()}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-[#6B6356] transition-colors hover:bg-[#FAFAF8] hover:text-[#2D2A26]"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" strokeWidth={2.25} />
                </button>
              </div>
            </div>

            <div className="border-t border-[#F0EDE8]" />

            <div className="flex-1 overflow-y-auto">
              {kind === 'repair' ? (
                <RepairList emptyHint={meta.emptyHint} />
              ) : (
                <ActivityList rows={filtered} emptyHint={meta.emptyHint} />
              )}
            </div>

            <div className="border-t border-[#F0EDE8] px-5 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-[#A89F91]">
              {kind === 'repair'
                ? 'Live queue · updates as tickets close'
                : 'Most recent activity · refreshes every minute'}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
