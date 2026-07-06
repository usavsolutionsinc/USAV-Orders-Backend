'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { History, Loader2, Smartphone } from '@/components/Icons';
import { getLast4 } from '@/components/ui/CopyChip';
import { useAuth } from '@/contexts/AuthContext';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { safeChannelName, getScanLogChannelName } from '@/lib/realtime/channels';
import { cn } from '@/utils/_cn';
import { QuickAccessPanelShell } from './QuickAccessPanelShell';

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
  const diffMin = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function carrierChipClass(carrier: string | null): string {
  const c = (carrier || '').toLowerCase();
  if (c.includes('ups')) return 'bg-amber-50 text-amber-700 ring-amber-200';
  if (c.includes('fedex')) return 'bg-violet-50 text-violet-700 ring-violet-200';
  if (c.includes('usps')) return 'bg-blue-50 text-blue-700 ring-blue-200';
  return 'bg-surface-sunken text-text-muted ring-border-soft';
}

function PhotoStrip({ photos }: { photos: HistoryPhoto[] }) {
  if (photos.length === 0) return null;
  const visible = photos.slice(0, 2);
  const extra = photos.length - visible.length;

  return (
    <span className="flex shrink-0 items-center -space-x-1.5">
      {visible.map((photo) => (
        <span
          key={photo.id}
          className="relative h-8 w-8 overflow-hidden rounded-md ring-1 ring-border-soft"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.url} alt="" className="h-full w-full object-cover" />
        </span>
      ))}
      {extra > 0 ? (
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-sunken text-micro font-bold text-text-soft ring-1 ring-border-soft">
          +{extra}
        </span>
      ) : null}
    </span>
  );
}

function PanelSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="pb-2">
      <p className="px-2 pb-0.5 text-eyebrow font-black uppercase tracking-widest text-text-faint">
        {label}
      </p>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

function HistoryRow({
  title,
  meta,
  icon,
  trailing,
  active,
  onClick,
}: {
  title: string;
  meta: ReactNode;
  icon: React.ReactNode;
  trailing?: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors',
        active
          ? 'bg-blue-50 ring-1 ring-inset ring-blue-400'
          : 'hover:bg-surface-hover active:bg-surface-sunken',
      )}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-text-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-caption font-bold text-text-default">{title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-eyebrow font-semibold uppercase tracking-widest text-text-soft">
          {meta}
        </span>
      </span>
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </button>
  );
}

interface PhoneHistoryPopoverProps {
  onClose: () => void;
}

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
    void fetchScans();
    void fetchHistory();
  }, [fetchScans, fetchHistory]);

  useEffect(() => {
    const handler = () => { void fetchHistory(); };
    window.addEventListener('usav-refresh-data', handler);
    return () => window.removeEventListener('usav-refresh-data', handler);
  }, [fetchHistory]);

  const scanLogChannel = safeChannelName(() => getScanLogChannelName(orgId!, staffId));
  useAblyChannel(
    scanLogChannel,
    'scan_logged',
    () => { void fetchScans(); },
    !!scanLogChannel && staffId > 0,
  );

  const openScan = useCallback(
    (entry: ScanHistoryEntry) => {
      onClose();
      router.push(entry.desktopHref);
    },
    [onClose, router],
  );

  const resumePack = useCallback(
    (entry: HistoryEntry) => {
      onClose();
      router.push(entry.resumeHref);
    },
    [onClose, router],
  );

  return (
    <QuickAccessPanelShell
      title="Phone history"
      subtitle="Packs and scans from your phone"
      onClose={onClose}
    >
      {scans && scans.length > 0 ? (
        <PanelSection label="Recent scans">
          {scans.map((s) => (
            <HistoryRow
              key={s.id}
              title={s.rawValue}
              icon={<Smartphone className="h-3.5 w-3.5" />}
              meta={
                <>
                  <span>{s.typeLabel}</span>
                  <span>{timeAgo(s.scannedAt)}</span>
                </>
              }
              onClick={() => openScan(s)}
            />
          ))}
        </PanelSection>
      ) : null}

      {entries === null ? (
        <div className="flex items-center justify-center gap-2 py-8 text-caption text-text-soft">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading packs…
        </div>
      ) : entries.length === 0 ? (
        <p className="mx-2 rounded-xl border border-dashed border-border-soft bg-surface-canvas px-4 py-6 text-center text-caption text-text-soft">
          {error ?? 'No recent packs yet. Pack an order on your phone to see it here.'}
        </p>
      ) : (
        <PanelSection label="Recent packs">
          {entries.map((entry, index) => {
            const title = entry.productTitle || entry.tracking || `Log #${entry.packerLogId}`;
            return (
              <HistoryRow
                key={entry.packerLogId}
                active={index === 0}
                title={title}
                icon={<History className="h-3.5 w-3.5" />}
                meta={
                  <>
                    {index === 0 ? <span className="text-blue-700">Latest</span> : null}
                    <span>{timeAgo(entry.packedAt)}</span>
                    {entry.carrier ? (
                      <span
                        className={cn(
                          'inline-flex rounded-full px-1.5 py-0.5 text-micro font-black uppercase tracking-widest ring-1 ring-inset',
                          carrierChipClass(entry.carrier),
                        )}
                      >
                        {entry.carrier}
                      </span>
                    ) : null}
                    {entry.tracking ? <span>TRK {getLast4(entry.tracking)}</span> : null}
                    {entry.sku ? <span className="normal-case tracking-normal">{entry.sku}</span> : null}
                  </>
                }
                trailing={<PhotoStrip photos={entry.photos} />}
                onClick={() => resumePack(entry)}
              />
            );
          })}
        </PanelSection>
      )}
    </QuickAccessPanelShell>
  );
}
