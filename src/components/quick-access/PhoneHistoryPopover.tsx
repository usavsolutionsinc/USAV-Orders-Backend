'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, Image, X } from '@/components/Icons';
import { getLast4 } from '@/components/ui/CopyChip';
import { useAuth } from '@/contexts/AuthContext';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { safeChannelName, getScanLogChannelName } from '@/lib/realtime/channels';
import { IconButton } from '@/design-system/primitives';

interface ScanHistoryEntry {
  id: number;
  rawValue: string;
  kind: string;
  scannedAt: string;
  type: 'receiving' | 'receiving-line' | 'serial-unit';
  typeLabel: string;
  desktopHref: string;
}

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
  return 'bg-surface-sunken text-text-muted border-border-soft';
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
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const staffId = user?.staffId ?? 0;
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scans, setScans] = useState<ScanHistoryEntry[] | null>(null);

  const fetchScans = useCallback(async () => {
    try {
      const res = await fetch('/api/scan/history?limit=20', {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) {
        setScans([]);
        return;
      }
      const data = (await res.json()) as { entries?: ScanHistoryEntry[] };
      setScans(Array.isArray(data.entries) ? data.entries : []);
    } catch {
      setScans([]);
    }
  }, []);

  useEffect(() => {
    void fetchScans();
  }, [fetchScans]);

  // Live-prepend: when this staff scans a receiving label on their phone, the
  // resolver publishes on scanlog:{staffId} — refetch so it appears instantly.
  const scanLogChannel = safeChannelName(() => getScanLogChannelName(orgId!, staffId));
  useAblyChannel(
    scanLogChannel,
    'scan_logged',
    () => { void fetchScans(); },
    !!scanLogChannel && staffId > 0,
  );

  const handleOpenScan = useCallback(
    (entry: ScanHistoryEntry) => {
      onClose();
      router.push(entry.desktopHref);
    },
    [onClose, router],
  );

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
      className="flex w-[320px] flex-col overflow-hidden rounded-xl border border-border-soft bg-surface-card shadow-xl"
    >
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-border-hairline px-4 py-3">
        <div>
          <p className="text-micro font-black uppercase tracking-widest text-text-soft">
            Phone history
          </p>
          <p className="mt-0.5 text-sm font-black text-text-default">
            Recent packs · tap to resume
          </p>
        </div>
        <IconButton
          ariaLabel="Close"
          onClick={onClose}
          icon={<X className="h-3.5 w-3.5" />}
        />
      </header>

      {/* Fixed-height body: scans + packs load/refetch at different times, so
          a max-height container resizes the whole popover as sections pop in.
          Locking the height keeps the frame still — content scrolls inside. */}
      <div className="h-[min(480px,calc(100vh-8rem))] overflow-y-auto overscroll-contain px-4 py-2">
        {scans && scans.length > 0 && (
          <section className="mb-3">
            <p className="mb-1 text-micro font-black uppercase tracking-widest text-text-soft">
              Phone scans · tap to open
            </p>
            <div className="overflow-hidden rounded-lg border border-border-hairline divide-y divide-border-hairline">
              {scans.map((s) => (
                // ds-raw-button: text-left scan row (type badge + raw value + time), not a single DS Button
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handleOpenScan(s)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors active:bg-surface-hover hover:bg-surface-hover"
                >
                  <span className="inline-flex shrink-0 items-center rounded-md border border-border-soft bg-surface-canvas px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-wider text-text-muted">
                    {s.typeLabel}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-label font-bold text-text-default">
                    {s.rawValue}
                  </span>
                  <span className="shrink-0 text-micro text-text-faint">{timeAgo(s.scannedAt)}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {entries === null ? (
          <div className="flex items-center justify-center py-6">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-border-soft border-t-gray-600" />
          </div>
        ) : entries.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-soft bg-surface-canvas/60 px-3 py-5 text-center text-caption italic text-text-faint">
            {error ?? 'No recent packs yet — pack an order to see history here.'}
          </p>
        ) : (
          <div className="space-y-2">
          {first && (
            // ds-raw-button: multi-line text-left "resume last pack" card tile, not a single DS Button
            <button
              type="button"
              onClick={() => handleResume(first)}
              className="w-full rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-3 text-left transition-colors active:bg-emerald-100"
            >
              <p className="text-eyebrow font-black uppercase tracking-widest text-emerald-700">
                Resume last pack
              </p>
              <p className="mt-0.5 truncate text-sm font-black text-text-default">
                {first.productTitle || first.tracking || `Log #${first.packerLogId}`}
              </p>
              <div className="mt-1 flex items-center gap-2 text-micro text-text-muted">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {timeAgo(first.packedAt)}
                </span>
                {first.carrier && (
                  <span
                    className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-wider ${carrierBadgeColor(first.carrier)}`}
                  >
                    {first.carrier}
                  </span>
                )}
                {first.photos.length > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-text-faint">
                    <Image className="h-3 w-3" />
                    {first.photos.length}
                  </span>
                )}
              </div>
            </button>
          )}

          {rest.length > 0 && (
            <div className="max-h-[260px] overflow-y-auto rounded-lg border border-border-hairline divide-y divide-border-hairline">
              {rest.map((entry) => (
                // ds-raw-button: text-left multi-line history row (title + meta + photo count), not a single DS Button
                <button
                  key={entry.packerLogId}
                  type="button"
                  onClick={() => handleResume(entry)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors active:bg-surface-hover"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-label font-bold text-text-default">
                      {entry.productTitle || entry.tracking || `Log #${entry.packerLogId}`}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2 text-micro text-text-soft">
                      <span>{timeAgo(entry.packedAt)}</span>
                      {entry.tracking && (
                        <span className="font-mono">TRK {getLast4(entry.tracking)}</span>
                      )}
                      {entry.sku && <span className="truncate">{entry.sku}</span>}
                    </div>
                  </div>
                  {entry.photos.length > 0 && (
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-micro text-text-faint">
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
    </div>
  );
}
