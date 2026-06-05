'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight,
  Package,
  Hash,
  History,
  Camera,
  Search,
  Loader2,
} from '@/components/Icons';
import {
  MobileCard,
  TOKENS,
  SectionHeader,
  GlassButton,
} from '@/components/mobile/redesign/DesignSystem';
import { MobileTopBar } from '@/components/mobile/redesign/MobileTopBar';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { useFeedback } from '@/hooks/useFeedback';
import { useRouter } from 'next/navigation';

interface ResolveScan {
  id: string;
  raw: string;
  status: 'pending' | 'resolved' | 'multi' | 'none';
  at: Date;
  label: string | null;
  route: string | null;
}

export default function RedesignedMobileUniversalScan() {
  const router = useRouter();
  const [cameraActive, setCameraActive] = useState(false);
  const [input, setInput] = useState('');
  const [scans, setScans] = useState<ResolveScan[]>([]);
  const scanner = useBarcodeScanner({ dedupMs: 2000 });
  const feedback = useFeedback();
  const inFlight = useRef(false);

  const resolve = useCallback(
    async (value: string) => {
      const raw = value.trim();
      if (!raw || inFlight.current) return;
      inFlight.current = true;
      feedback('confirm');
      setInput('');

      const tempId = `${Date.now()}-${raw}`;
      setScans((prev) =>
        [{ id: tempId, raw, status: 'pending' as const, at: new Date(), label: null, route: null }, ...prev].slice(0, 12),
      );

      try {
        const res = await fetch(`/api/scan/resolve?input=${encodeURIComponent(raw)}`, {
          credentials: 'include',
          cache: 'no-store',
        });
        const data = await res.json().catch(() => null);

        if (!res.ok || !data) {
          setScans((prev) => prev.map((s) => (s.id === tempId ? { ...s, status: 'none' as const } : s)));
          feedback('scanRejected');
          return;
        }

        const outcome: string = data.matchOutcome ?? 'none';
        const route: string | null = data.mobileRoute ?? null;
        const firstMatch = Array.isArray(data.matches) && data.matches.length > 0 ? data.matches[0] : null;
        const label: string | null = firstMatch?.order_id
          ? firstMatch.order_id
          : data.kind
            ? String(data.kind).replace(/_/g, ' ')
            : null;

        const status: ResolveScan['status'] =
          route && outcome === 'single' ? 'resolved' : outcome === 'multi' ? 'multi' : 'none';

        setScans((prev) =>
          prev.map((s) => (s.id === tempId ? { ...s, status, label, route } : s)),
        );

        if (status === 'resolved' && route) {
          feedback('scanAccepted');
          router.push(route);
        } else if (status === 'multi') {
          feedback('confirm');
        } else {
          feedback('scanRejected');
        }
      } catch {
        setScans((prev) => prev.map((s) => (s.id === tempId ? { ...s, status: 'none' as const } : s)));
        feedback('scanRejected');
      } finally {
        inFlight.current = false;
      }
    },
    [feedback, router],
  );

  useEffect(() => {
    if (cameraActive) scanner.startScanning();
    else scanner.stopScanning();
    return () => { scanner.stopScanning(); };
  }, [cameraActive, scanner]);

  useEffect(() => {
    if (scanner.lastScannedValue) void resolve(scanner.lastScannedValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanner.lastScannedValue]);

  return (
    <div className={`min-h-[100dvh] ${TOKENS.colors.background} flex flex-col`}>
      <MobileTopBar title="Universal Scan" eyebrow="Search" icon={Search} />

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
              onKeyDown={(e) => e.key === 'Enter' && resolve(input)}
              placeholder="Enter ID, SKU, or Tracking..."
              className="w-full bg-white border border-blue-100 rounded-[24px] pl-11 pr-28 py-5 text-base font-bold text-blue-950 focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all shadow-sm placeholder:text-blue-300"
            />
            <button
              onClick={() => resolve(input)}
              className="absolute right-2 top-2 bottom-2 px-5 bg-blue-600 text-white rounded-[18px] flex items-center gap-2 active:scale-95 transition-all shadow-lg shadow-blue-600/10"
            >
              <span className="text-[10px] font-black uppercase tracking-wider">Find</span>
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

      {/* Camera Viewfinder (Only when active) */}
      <AnimatePresence>
        {cameraActive && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: '40vh', opacity: 1 }}
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

            {/* Simple Viewfinder Overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-56 h-56 rounded-[40px] border-2 border-white/40 bg-white/5 backdrop-blur-[1px] relative">
                <motion.div
                  animate={{ top: ['5%', '95%', '5%'] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute left-6 right-6 h-[2px] bg-blue-400 shadow-[0_0_15px_rgba(96,165,250,1)]"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* History Tray */}
      <div className="flex-1 bg-slate-50 px-6 pt-8 pb-32 overflow-y-auto">
        <SectionHeader title="Recent Scans" />

        <div className="flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {scans.length === 0 ? (
              <div className="py-12 text-center opacity-40">
                <History className="h-10 w-10 mx-auto mb-3 text-blue-200" />
                <p className="text-xs font-black uppercase tracking-widest text-blue-300">Waiting for first scan...</p>
              </div>
            ) : (
              scans.map((scan) => {
                const ok = scan.status === 'resolved' || scan.status === 'multi';
                return (
                  <motion.div key={scan.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} layout>
                    <MobileCard
                      onClick={scan.route ? () => router.push(scan.route as string) : undefined}
                      className="group py-3.5"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4 min-w-0">
                          <div
                            className={`h-11 w-11 rounded-2xl flex items-center justify-center shrink-0 shadow-sm ${
                              scan.status === 'pending'
                                ? 'bg-blue-50 text-blue-400'
                                : ok
                                  ? 'bg-blue-50 text-blue-600'
                                  : 'bg-slate-100 text-slate-400'
                            }`}
                          >
                            {scan.status === 'pending' ? (
                              <Loader2 className="h-5 w-5 animate-spin" />
                            ) : ok ? (
                              <Package className="h-5 w-5" />
                            ) : (
                              <Hash className="h-5 w-5" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-black text-blue-950 font-mono truncate tracking-tight">{scan.raw}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span
                                className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                  scan.status === 'pending'
                                    ? 'bg-blue-50 text-blue-500'
                                    : ok
                                      ? 'bg-blue-100 text-blue-700'
                                      : 'bg-slate-200 text-slate-500'
                                }`}
                              >
                                {scan.status === 'pending'
                                  ? 'Resolving…'
                                  : scan.status === 'resolved'
                                    ? scan.label ? `Matched ${scan.label}` : 'Matched'
                                    : scan.status === 'multi'
                                      ? 'Multiple matches'
                                      : 'No Match'}
                              </span>
                              <span className="text-[9px] font-bold text-blue-200 uppercase">
                                {scan.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          </div>
                        </div>
                        {scan.route && <ChevronRight className="h-4 w-4 text-blue-100" />}
                      </div>
                    </MobileCard>
                  </motion.div>
                );
              })
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
