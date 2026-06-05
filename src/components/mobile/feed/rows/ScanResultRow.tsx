'use client';

import Link from 'next/link';
import { ChevronRight, Package, AlertCircle, Loader2, Check } from '@/components/Icons';
import { MobileRowCard } from '@/components/mobile/feed/MobileRowCard';

/**
 * Normalized scan-result item. Both the Universal Scan (/m/scan) and Receive
 * (/m/receive) screens map their bespoke local-state rows onto this shape so
 * they can share one row component + the shared MobileFeed.
 */
export interface ScanFeedItem {
  id: string;
  /** The scanned value, shown mono (tracking / SKU / id). */
  primary: string;
  at: Date;
  state: 'pending' | 'ok' | 'warn' | 'error';
  /** Short status pill text, e.g. "Matched PO 123", "Resolving…", "No match". */
  statusLabel: string;
  /** Optional trailing meta, e.g. "3 lines". */
  meta?: string | null;
  /** Tap target; chevron + link only render when set. */
  href?: string | null;
}

const STATE_TILE: Record<ScanFeedItem['state'], string> = {
  pending: 'bg-blue-50 text-blue-500',
  ok: 'bg-emerald-50 text-emerald-600',
  warn: 'bg-amber-50 text-amber-600',
  error: 'bg-rose-50 text-rose-600',
};

const STATE_PILL: Record<ScanFeedItem['state'], string> = {
  pending: 'bg-blue-50 border-blue-100 text-blue-600',
  ok: 'bg-emerald-50 border-emerald-100 text-emerald-700',
  warn: 'bg-amber-50 border-amber-100 text-amber-700',
  error: 'bg-rose-50 border-rose-100 text-rose-700',
};

function StateIcon({ state }: { state: ScanFeedItem['state'] }) {
  if (state === 'pending') return <Loader2 className="h-5 w-5 animate-spin" />;
  if (state === 'ok') return <Package className="h-5 w-5" />;
  return <AlertCircle className="h-5 w-5" />;
}

/**
 * One scan-result row. Reuses the shared MobileRowCard chrome so it matches the
 * receiving/packing feed; status colour communicates resolve outcome.
 */
export function ScanResultRow({ item, fresh = false }: { item: ScanFeedItem; fresh?: boolean }) {
  const inner = (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl shadow-sm ${STATE_TILE[item.state]}`}>
          <StateIcon state={item.state} />
        </div>
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-black tracking-tight text-blue-950">{item.primary}</p>
          <div className="mt-0.5 flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${STATE_PILL[item.state]}`}
            >
              {item.state === 'ok' ? <Check className="mr-1 h-2.5 w-2.5" /> : null}
              {item.statusLabel}
            </span>
            {item.meta && (
              <span className="text-[9px] font-bold uppercase tracking-wider text-blue-300">{item.meta}</span>
            )}
            <span className="text-[9px] font-bold uppercase text-blue-200">
              {item.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>
      </div>
      {item.href && <ChevronRight className="h-4 w-4 shrink-0 text-blue-200" />}
    </div>
  );

  return (
    <MobileRowCard variant="collapsed" fresh={fresh}>
      {item.href ? (
        <Link href={item.href} prefetch={false} className="pointer-events-auto">
          {inner}
        </Link>
      ) : (
        inner
      )}
    </MobileRowCard>
  );
}

export default ScanResultRow;
