'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Smartphone, Link2, X } from '@/components/Icons';
import { usePhonePair } from '@/contexts/PhonePairContext';
import { usePhoneScanBridge } from '@/hooks/usePhoneScanBridge';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';

function timeAgo(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

/**
 * Bottom-right floating button that surfaces phone-pairing state across the
 * whole app. Also mounts the scan bridge so phone scans update lastScan even
 * when the user is off /receiving.
 */
export function PhonePairFab() {
  const router = useRouter();
  const {
    pairState,
    session,
    lastScan,
    unreadScanCount,
    openModal,
    markScansRead,
    disconnect,
  } = usePhonePair();

  usePhoneScanBridge();

  const [popoverOpen, setPopoverOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [ageTick, setAgeTick] = useState(0);

  // Tick once a second while the popover is open so "2s ago" refreshes.
  useEffect(() => {
    if (!popoverOpen) return;
    const id = window.setInterval(() => setAgeTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [popoverOpen]);

  // Click-outside to dismiss.
  useEffect(() => {
    if (!popoverOpen) return;
    const h = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setPopoverOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [popoverOpen]);

  const isPaired = pairState === 'paired' && session;

  const handleButtonClick = () => {
    if (!isPaired) {
      openModal();
      return;
    }
    setPopoverOpen((prev) => {
      const next = !prev;
      if (next) markScansRead();
      return next;
    });
  };

  const handleOpenPo = () => {
    if (!lastScan?.receiving_id || !session) return;
    setPopoverOpen(false);
    const receivingId = lastScan.receiving_id;
    const staffId = session.staffId;
    router.push(`/receiving?staffId=${staffId}&mode=receive`);
    // Tell the sidebar to load the PO. Existing listener in
    // ReceivingSidebarPanel handles 'receiving-active'.
    // Give the route change a tick to mount the sidebar.
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('receiving-active', { detail: { receiving_id: receivingId } }),
      );
    }, 150);
  };

  const themeId = session?.staffId ?? 0;
  const themeColors = stationThemeColors[getStaffThemeById(themeId)];

  const hasNotification = isPaired && unreadScanCount > 0;

  // Use ageTick to force dependency refresh of timeAgo output.
  void ageTick;

  return (
    <div
      ref={wrapperRef}
      className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2"
    >
      {popoverOpen && isPaired && session && (
        <div className="w-[288px] rounded-xl border border-gray-200 bg-white p-4 shadow-xl">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Phone paired
              </p>
              <p className={`mt-0.5 text-[13px] font-black ${themeColors.text}`}>
                {session.staffName || `Staff #${session.staffId}`}
              </p>
              <p className="text-[10px] text-gray-400">
                Paired {timeAgo(session.pairedAt)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPopoverOpen(false)}
              aria-label="Close"
              className="text-gray-400 hover:text-gray-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50/80 p-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Last scan
            </p>
            {lastScan ? (
              <div className="mt-1 space-y-1">
                <p className="font-mono text-[12px] font-black text-gray-900 break-all">
                  {lastScan.tracking}
                </p>
                <div className="flex items-center gap-2 text-[10px]">
                  <span
                    className={`inline-flex items-center rounded-md px-1.5 py-0.5 font-black uppercase tracking-widest ${
                      lastScan.status === 'matched'
                        ? 'bg-emerald-100 text-emerald-800'
                        : lastScan.status === 'unmatched'
                          ? 'bg-amber-100 text-amber-800'
                          : lastScan.status === 'error'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-gray-200 text-gray-700'
                    }`}
                  >
                    {lastScan.status}
                  </span>
                  <span className="text-gray-400">{timeAgo(lastScan.at)}</span>
                </div>
                {lastScan.po_ids.length > 0 && (
                  <p className="text-[10px] text-gray-500">
                    PO: <span className="font-mono text-gray-700">{lastScan.po_ids.join(', ')}</span>
                  </p>
                )}
                {lastScan.error && (
                  <p className="text-[10px] text-red-600">{lastScan.error}</p>
                )}
              </div>
            ) : (
              <p className="mt-1 text-[11px] italic text-gray-400">
                No scans yet — scan a tracking label on the paired phone.
              </p>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={disconnect}
              className="text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-red-600"
            >
              Disconnect
            </button>
            <button
              type="button"
              onClick={handleOpenPo}
              disabled={!lastScan?.receiving_id}
              className={`rounded-lg px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-white shadow-sm transition-colors ${
                lastScan?.receiving_id
                  ? 'bg-gray-900 hover:bg-gray-800'
                  : 'bg-gray-300 cursor-not-allowed'
              }`}
            >
              Open
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={handleButtonClick}
        aria-label={isPaired ? 'Phone paired — show status' : 'Pair phone'}
        title={isPaired ? 'Phone paired' : 'Pair phone'}
        className={`group relative flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all active:scale-95 ${
          isPaired
            ? 'bg-white text-emerald-600 ring-2 ring-emerald-400 hover:ring-emerald-500'
            : 'bg-gray-900 text-white hover:bg-gray-800'
        }`}
      >
        {isPaired ? <Link2 className="h-6 w-6" /> : <Smartphone className="h-6 w-6" />}
        {hasNotification && (
          <span
            aria-label={`${unreadScanCount} new phone scan${unreadScanCount === 1 ? '' : 's'}`}
            className="absolute -top-0.5 -right-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full bg-red-500 ring-2 ring-white"
          >
            <span className="h-3 w-3 animate-ping rounded-full bg-red-400 opacity-75" />
          </span>
        )}
      </button>
    </div>
  );
}
