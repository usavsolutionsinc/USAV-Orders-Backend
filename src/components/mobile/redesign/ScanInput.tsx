'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera } from '@/components/Icons';
import { StationScanBar } from '@/components/station/StationScanBar';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { useAuth } from '@/contexts/AuthContext';
import { useStationTheme } from '@/hooks/useStationTheme';

/**
 * Mobile scan surface. The input bar IS the canonical desktop {@link StationScanBar}
 * (compact `py-1.5 text-xs` chrome) — we do NOT hand-roll a separate mobile input
 * anymore. The only mobile-specific addition is a small camera toggle tucked into
 * the bar's `rightContent`, which drives the ZXing viewfinder below via
 * {@link useBarcodeScanner}.
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
  /** Smaller viewfinder for embedding inside a bottom sheet. */
  compact?: boolean;
  /** Unused now the camera is a compact in-bar toggle; kept for call-site compat. */
  cameraButtonLabel?: string;
  /** Force-stop the camera even if the user toggled it on (e.g. a sheet is open). */
  cameraSuspended?: boolean;
}

export function ScanInput({
  onDecode,
  placeholder = 'Scan or type',
  autoFocus = false,
  compact = false,
  cameraSuspended = false,
}: ScanInputProps) {
  const [cameraActive, setCameraActive] = useState(false);
  const [input, setInput] = useState('');
  const scanner = useBarcodeScanner({ dedupMs: 2000 });

  // Same staff-color border as the desktop stations — the StationScanBar's
  // outer stroke is themed to the logged-in operator via useStationTheme.
  const { user } = useAuth();
  const { inputBorder } = useStationTheme({ staffId: user?.staffId ?? null });

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

  const viewfinderHeight = compact ? '20vh' : '26vh';
  const boxSize = compact ? 'h-28 w-28' : 'h-40 w-40';

  return (
    <div className="flex flex-col gap-2">
      <StationScanBar
        value={input}
        onChange={setInput}
        onSubmit={() => submit(input)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        inputBorderClassName={inputBorder}
        inputClassName="!pr-11"
        rightContent={
          <button
            type="button"
            onClick={() => setCameraActive((v) => !v)}
            aria-pressed={cameraActive}
            aria-label={cameraActive ? 'Close camera scanner' : 'Open camera scanner'}
            title={cameraActive ? 'Close camera' : 'Scan with camera'}
            className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 ${
              cameraActive
                ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
            }`}
          >
            <Camera className="h-3.5 w-3.5" />
          </button>
        }
      />

      <AnimatePresence>
        {live && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: viewfinderHeight, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="relative w-full overflow-hidden rounded-2xl bg-blue-950"
          >
            <video
              ref={scanner.videoRef as React.RefObject<HTMLVideoElement>}
              className="absolute inset-0 h-full w-full object-cover opacity-70 contrast-125"
              autoPlay
              playsInline
              muted
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className={`relative ${boxSize} rounded-[32px] border-2 border-white/40 bg-white/5 backdrop-blur-[1px]`}>
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
    </div>
  );
}
