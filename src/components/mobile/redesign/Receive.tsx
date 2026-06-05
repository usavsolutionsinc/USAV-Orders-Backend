'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Search,
  PackageCheck,
  Camera,
} from '@/components/Icons';
import {
  TOKENS,
  SectionHeader,
  GlassButton,
} from '@/components/mobile/redesign/DesignSystem';
import { MobileFeed } from '@/components/mobile/feed/MobileFeed';
import { useFeedWindow } from '@/components/mobile/feed/useMobileFeed';
import { ScanResultRow, type ScanFeedItem } from '@/components/mobile/feed/rows/ScanResultRow';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { useFeedback } from '@/hooks/useFeedback';

interface ScanResult {
  id: string;
  tracking: string;
  status: 'matched' | 'unmatched' | 'pending' | 'error';
  at: Date;
  poLabel: string | null;
  receivingId: number | null;
  lineCount: number;
}

export default function RedesignedMobileReceive() {
  const [cameraActive, setCameraActive] = useState(false);
  const [input, setInput] = useState('');
  const [scans, setScans] = useState<ScanResult[]>([]);
  const scanner = useBarcodeScanner({ dedupMs: 2000 });
  const feedback = useFeedback();
  const inFlight = useRef(false);

  const lookup = useCallback(
    async (value: string) => {
      const tracking = value.trim();
      if (!tracking || inFlight.current) return;
      inFlight.current = true;
      feedback('confirm');
      setInput('');

      const tempId = `${Date.now()}-${tracking}`;
      // Optimistic "pending" row while the lookup runs.
      setScans((prev) =>
        [
          { id: tempId, tracking, status: 'pending' as const, at: new Date(), poLabel: null, receivingId: null, lineCount: 0 },
          ...prev,
        ].slice(0, 12),
      );

      try {
        const res = await fetch('/api/receiving/lookup-po', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ trackingNumber: tracking }),
        });
        const data = await res.json().catch(() => null);

        if (!res.ok || !data) {
          setScans((prev) =>
            prev.map((s) => (s.id === tempId ? { ...s, status: 'error' as const } : s)),
          );
          feedback('error');
          return;
        }

        const matched = Boolean(data.po_matched ?? data.matched);
        const poLabel: string | null = Array.isArray(data.po_ids) && data.po_ids.length > 0
          ? `PO ${data.po_ids[0]}`
          : null;

        setScans((prev) =>
          prev.map((s) =>
            s.id === tempId
              ? {
                  ...s,
                  status: matched ? 'matched' : 'unmatched',
                  poLabel,
                  receivingId: typeof data.receiving_id === 'number' ? data.receiving_id : null,
                  lineCount: Array.isArray(data.lines) ? data.lines.length : 0,
                }
              : s,
          ),
        );
        feedback(matched ? 'scanAccepted' : 'confirm');
      } catch {
        setScans((prev) =>
          prev.map((s) => (s.id === tempId ? { ...s, status: 'error' as const } : s)),
        );
        feedback('error');
      } finally {
        inFlight.current = false;
      }
    },
    [feedback],
  );

  // Feed camera-decoded values into the same lookup path.
  useEffect(() => {
    if (cameraActive) scanner.startScanning();
    else scanner.stopScanning();
    return () => { scanner.stopScanning(); };
  }, [cameraActive, scanner]);

  useEffect(() => {
    if (scanner.lastScannedValue) void lookup(scanner.lastScannedValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanner.lastScannedValue]);

  // Map the local lookup rows onto the shared scan-feed shape.
  const feedItems = useMemo<ScanFeedItem[]>(
    () =>
      scans.map((s) => ({
        id: s.id,
        primary: s.tracking,
        at: s.at,
        state:
          s.status === 'matched' ? 'ok' : s.status === 'pending' ? 'pending' : s.status === 'error' ? 'error' : 'warn',
        statusLabel:
          s.status === 'matched'
            ? s.poLabel ?? 'Matched'
            : s.status === 'pending'
              ? 'Looking up…'
              : s.status === 'error'
                ? 'Lookup failed'
                : 'No PO match',
        meta: s.status === 'matched' && s.lineCount > 0 ? `${s.lineCount} line${s.lineCount === 1 ? '' : 's'}` : null,
        href: s.receivingId ? `/m/r/${s.receivingId}` : null,
      })),
    [scans],
  );
  const { rows: feedRows, scrollRef } = useFeedWindow(feedItems, { limit: 12, anchor: 'top', freshPulse: false });

  return (
    <div className={`h-full ${TOKENS.colors.background} flex flex-col`}>
      {/* Input Section */}
      <div className="px-6 pt-4 pb-4">
        {/* Input Bar */}
        <div className="flex flex-col gap-4">
          <div className="relative group">
            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-blue-400" />
            </div>
            <input
              autoFocus
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && lookup(input)}
              placeholder="Scan or enter tracking..."
              className="w-full bg-white border border-blue-100 rounded-[24px] pl-11 pr-14 py-5 text-base font-bold text-blue-950 focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all shadow-sm placeholder:text-blue-300"
            />
            <button
              onClick={() => lookup(input)}
              className="absolute right-2 top-2 bottom-2 h-12 w-12 bg-blue-600 text-white rounded-[18px] flex items-center justify-center active:scale-90 transition-all shadow-lg"
            >
              <Plus className="h-6 w-6" />
            </button>
          </div>

          <GlassButton
            variant={cameraActive ? 'primary' : 'secondary'}
            className={`w-full !rounded-[24px] ${cameraActive ? 'bg-blue-600 border-blue-500 shadow-blue-600/20' : ''}`}
            onClick={() => setCameraActive(!cameraActive)}
            icon={Camera}
          >
            {cameraActive ? 'Close Camera' : 'Open Camera Scanner'}
          </GlassButton>
        </div>
      </div>

      {/* Camera Viewfinder */}
      <AnimatePresence>
        {cameraActive && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: '35vh', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="relative w-full bg-blue-950 overflow-hidden"
          >
            <video
              ref={scanner.videoRef as any}
              className="absolute inset-0 h-full w-full object-cover opacity-70 contrast-125"
              autoPlay
              playsInline
              muted
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-64 h-36 rounded-2xl border-2 border-white/40 bg-white/5 backdrop-blur-[1px] relative">
                <motion.div
                  animate={{ top: ['5%', '95%', '5%'] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute left-6 right-6 h-[2px] bg-emerald-400 shadow-[0_0_15px_rgba(52,211,153,1)]"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* History Tray — shared feed, newest at the top. */}
      <div className="flex min-h-0 flex-1 flex-col bg-slate-50 pt-6">
        <div className="px-6">
          <SectionHeader title="Recent Receipts" />
        </div>
        <MobileFeed<ScanFeedItem>
          rows={feedRows}
          expandLast={false}
          scrollRef={scrollRef}
          className="px-3 pb-32"
          empty={
            <div className="py-12 text-center opacity-40">
              <PackageCheck className="mx-auto mb-3 h-10 w-10 text-blue-200" />
              <p className="text-xs font-black uppercase tracking-widest text-blue-300">Scan tracking to begin...</p>
            </div>
          }
          renderRow={(item) => <ScanResultRow item={item} />}
        />
      </div>
    </div>
  );
}
