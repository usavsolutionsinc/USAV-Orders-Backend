'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Camera } from '@/components/Icons';
import { GlassButton } from '@/components/mobile/redesign/DesignSystem';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';

/**
 * Reusable scan surface = manual input bar + ZXing camera viewfinder + a camera
 * toggle, all wrapping {@link useBarcodeScanner}. Lifted out of UniversalScan so
 * the exact same component drives both the `/m/scan` page scanner AND the
 * "scan a location" step inside the Prepacked Products sheet.
 *
 * Self-manages its own camera + manual-input state and emits decoded values via
 * `onDecode`. Each mounted instance owns its own camera stream, so only mount /
 * un-suspend one at a time (the parent passes `cameraSuspended` to park the page
 * scanner while a sheet's scanner is live — two getUserMedia streams contend).
 */
interface ScanInputProps {
  onDecode: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** Smaller viewfinder + tighter chrome for embedding inside a bottom sheet. */
  compact?: boolean;
  cameraButtonLabel?: string;
  /** Force-stop the camera even if the user toggled it on (e.g. a sheet is open). */
  cameraSuspended?: boolean;
}

export function ScanInput({
  onDecode,
  placeholder = 'Scan or type…',
  autoFocus = false,
  compact = false,
  cameraButtonLabel,
  cameraSuspended = false,
}: ScanInputProps) {
  const [cameraActive, setCameraActive] = useState(false);
  const [input, setInput] = useState('');
  const scanner = useBarcodeScanner({ dedupMs: 2000 });

  // Keep the latest onDecode without re-running the decode effect (which is
  // keyed strictly off lastScannedValue — see UniversalScan's race note).
  const onDecodeRef = useRef(onDecode);
  onDecodeRef.current = onDecode;

  const submit = useCallback((value: string) => {
    const raw = value.trim();
    if (!raw) return;
    setInput('');
    onDecodeRef.current(raw);
  }, []);

  // Start/stop strictly off (cameraActive && not suspended). Depending on the
  // whole `scanner` object would re-run on every state change and could leave
  // the camera live after Close — a stop racing an in-flight async start.
  const { startScanning, stopScanning } = scanner;
  const live = cameraActive && !cameraSuspended;
  useEffect(() => {
    if (live) void startScanning();
    else void stopScanning();
    return () => { void stopScanning(); };
  }, [live, startScanning, stopScanning]);

  // Camera decode → emit + cooldown so the same code doesn't re-fire.
  useEffect(() => {
    if (scanner.lastScannedValue) {
      onDecodeRef.current(scanner.lastScannedValue.trim());
      scanner.acceptScan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanner.lastScannedValue]);

  const viewfinderHeight = compact ? '26vh' : '36vh';
  const boxSize = compact ? 'h-40 w-40' : 'h-56 w-56';

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-4 flex items-center">
          <Search className="h-4 w-4 text-blue-400" />
        </div>
        <input
          autoFocus={autoFocus}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit(input)}
          placeholder={placeholder}
          autoComplete="off"
          className={`w-full rounded-[24px] border border-blue-100 bg-white pl-11 pr-24 ${compact ? 'py-4 text-sm' : 'py-5 text-base'} font-bold text-blue-950 shadow-sm transition-all placeholder:text-blue-300 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/10`}
        />
        <button
          type="button"
          onClick={() => submit(input)}
          className="absolute right-2 top-2 bottom-2 flex items-center gap-2 rounded-[18px] bg-blue-600 px-5 text-white shadow-lg shadow-blue-600/10 transition-all active:scale-95"
        >
          <span className="text-[10px] font-black uppercase tracking-wider">Find</span>
        </button>
      </div>

      <AnimatePresence>
        {live && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: viewfinderHeight, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="relative w-full overflow-hidden rounded-[24px] bg-blue-950"
          >
            <video
              ref={scanner.videoRef as React.RefObject<HTMLVideoElement>}
              className="absolute inset-0 h-full w-full object-cover opacity-70 contrast-125"
              autoPlay
              playsInline
              muted
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className={`relative ${boxSize} rounded-[40px] border-2 border-white/40 bg-white/5 backdrop-blur-[1px]`}>
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

      <GlassButton
        variant={cameraActive ? 'primary' : 'secondary'}
        className={`w-full !rounded-[24px] ${compact ? '!h-12' : ''} ${cameraActive ? 'border-blue-500 bg-blue-600 shadow-blue-600/20' : 'shadow-blue-950/10'}`}
        onClick={() => setCameraActive((v) => !v)}
        icon={Camera}
      >
        {cameraActive ? 'Close Camera' : cameraButtonLabel ?? 'Open Camera Scanner'}
      </GlassButton>
    </div>
  );
}

export default ScanInput;
