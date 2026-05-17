'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, Image, X } from '@/components/Icons';
import { getLast4 } from '@/components/ui/CopyChip';

interface HistoryPhoto {
  id: number;
  url: string;
  photoType: string;
  createdAt: string;
}

interface HistoryEntry {
  packerLogId: number;
  trackingType: string;
  packedAt: string;
  tracking: string | null;
  carrier: string | null;
  orderId: string | null;
  productTitle: string | null;
  condition: string | null;
  quantity: number;
  sku: string | null;
  itemNumber: string | null;
  photos: HistoryPhoto[];
  resumeHref: string;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function carrierBadgeColor(carrier: string | null): string {
  const c = (carrier || '').toLowerCase();
  if (c.includes('ups')) return 'bg-amber-100 text-amber-700 border-amber-200';
  if (c.includes('fedex')) return 'bg-purple-100 text-purple-700 border-purple-200';
  if (c.includes('usps')) return 'bg-blue-100 text-blue-700 border-blue-200';
  return 'bg-gray-100 text-gray-600 border-gray-200';
}

interface PhoneHistoryPopoverProps {
  onClose: () => void;
}

/**
 * Replaces the older phone-pair status panel in QuickAccessFab. Lists the
 * signed-in staff's most recently packed orders (auth-cookie backed via
 * /api/packing-logs/history) and lets them tap to resume in the packer.
 */
export function PhoneHistoryPopover({ onClose }: PhoneHistoryPopoverProps) {
  const router = useRouter();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/packing-logs/history?limit=10', {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) {
        setError('Could not load history');
        setEntries([]);
        return;
      }
      const data = (await res.json()) as { entries?: HistoryEntry[] };
      setEntries(Array.isArray(data.entries) ? data.entries : []);
      setError(null);
    } catch {
      setEntries([]);
      setError('Could not load history');
    }
  }, []);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    const handler = () => { void fetchHistory(); };
    window.addEventListener('usav-refresh-data', handler);
    return () => window.removeEventListener('usav-refresh-data', handler);
  }, [fetchHistory]);

  const handleResume = useCallback(
    (entry: HistoryEntry) => {
      onClose();
      router.push(entry.resumeHref);
    },
    [onClose, router],
  );

  const [first, ...rest] = entries ?? [];

  return (
    <div
      role="dialog"
      aria-label="Phone history"
      className="w-[320px] rounded-xl border border-gray-200 bg-white p-4 shadow-xl"
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
            Phone history
          </p>
          <p className="mt-0.5 text-[13px] font-black text-gray-900">
            Recent packs · tap to resume
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-gray-400 hover:text-gray-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {entries === null ? (
        <div className="mt-3 flex items-center justify-center py-6">
          <div className="h-5 w-5 rounded-full border-2 border-gray-200 border-t-gray-600 animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 px-3 py-6 text-center text-[11px] italic text-gray-400">
          {error ?? 'No recent packs yet — pack an order to see history here.'}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {first && (
            <button
              type="button"
              onClick={() => handleResume(first)}
              className="w-full rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-3 text-left transition-colors active:bg-emerald-100"
            >
              <p className="text-[9px] font-black uppercase tracking-widest text-emerald-700">
                Resume last pack
              </p>
              <p className="mt-0.5 truncate text-[13px] font-black text-gray-900">
                {first.productTitle || first.tracking || `Log #${first.packerLogId}`}
              </p>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-gray-600">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {timeAgo(first.packedAt)}
                </span>
                {first.carrier && (
                  <span
                    className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${carrierBadgeColor(first.carrier)}`}
                  >
                    {first.carrier}
                  </span>
                )}
                {first.photos.length > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-gray-400">
                    <Image className="h-3 w-3" />
                    {first.photos.length}
                  </span>
                )}
              </div>
            </button>
          )}

          {rest.length > 0 && (
            <div className="max-h-[260px] overflow-y-auto rounded-lg border border-gray-100 divide-y divide-gray-100">
              {rest.map((entry) => (
                <button
                  key={entry.packerLogId}
                  type="button"
                  onClick={() => handleResume(entry)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors active:bg-gray-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-bold text-gray-900">
                      {entry.productTitle || entry.tracking || `Log #${entry.packerLogId}`}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-gray-500">
                      <span>{timeAgo(entry.packedAt)}</span>
                      {entry.tracking && (
                        <span className="font-mono">TRK {getLast4(entry.tracking)}</span>
                      )}
                      {entry.sku && <span className="truncate">{entry.sku}</span>}
                    </div>
                  </div>
                  {entry.photos.length > 0 && (
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-gray-400">
                      <Image className="h-3 w-3" />
                      {entry.photos.length}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default PhoneHistoryPopover;
