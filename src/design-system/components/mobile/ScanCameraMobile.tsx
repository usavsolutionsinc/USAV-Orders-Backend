'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  framerPresenceMobile,
  framerTransitionMobile,
} from '../../foundations/motion-framer';
import { useCamera } from '@/hooks/useCamera';

// ─── Types ───────────────────────────────────────────────────────────────────

type ScanStatus = 'idle' | 'scanning' | 'success' | 'error' | 'denied';

export interface ScanCameraMobileProps {
  /** Called when a scan value is submitted (from camera or manual entry). */
  onScan: (value: string) => void;
  /** Whether the camera overlay is open. */
  isOpen: boolean;
  /** Close the camera overlay. */
  onClose: () => void;
  /** Placeholder for manual entry fallback input. */
  placeholder?: string;
  /** Optional header content above the viewfinder (e.g., mode label). */
  header?: ReactNode;
  /** External scan status — parent controls success/error feedback. */
  scanStatus?: ScanStatus;
  /** Reset scan status back to idle. */
  onResetStatus?: () => void;
  /** Whether to show manual code entry as fallback. Default true. */
  showManualEntry?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * ScanCameraMobile — fullscreen camera scanning overlay for mobile mode.
 *
 * Design rules:
 *   - Fullscreen overlay with camera viewfinder
 *   - Animated entrance: scale + opacity via `framerPresenceMobile.camera`
 *   - Success: green pulse ring on viewfinder + brief checkmark
 *   - Error: red ring + shake animation
 *   - Manual entry fallback: text input at bottom for damaged barcodes
 *   - Camera denied: graceful fallback to manual-only mode
 *   - Close button: top-right, 44px touch target
 *
 * Camera lifecycle:
 *   - Starts on mount (isOpen → true)
 *   - Stops on unmount (isOpen → false)
 *   - Uses `useCamera` hook from `@/hooks`
 *   - Rear camera by default (`facingMode: 'environment'`)
 *
 * Note: Actual barcode decoding is NOT handled here — that's the parent's
 * responsibility (via BarcodeDetector API, ZXing, or server-side).
 * This component provides the camera feed and manual input.
 */
export function ScanCameraMobile({
  onScan,
  isOpen,
  onClose,
  placeholder = 'Enter code manually...',
  header,
  scanStatus = 'idle',
  onResetStatus,
  showManualEntry = true,
}: ScanCameraMobileProps) {
  const { videoRef, startCamera, stopCamera, takePhoto, isActive } = useCamera();
  const [manualValue, setManualValue] = useState('');
  const [cameraError, setCameraError] = useState(false);
  const manualInputRef = useRef<HTMLInputElement>(null);

  // Start/stop camera with overlay lifecycle
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      return;
    }

    startCamera({
      facingMode: 'environment',
      width: { ideal: 1280 },
      height: { ideal: 720 },
    }).catch(() => {
      setCameraError(true);
      // Focus manual input if camera fails
      setTimeout(() => manualInputRef.current?.focus(), 300);
    });

    return () => stopCamera();
  }, [isOpen, startCamera, stopCamera]);

  // Auto-reset status after feedback
  useEffect(() => {
    if (scanStatus === 'success' || scanStatus === 'error') {
      const timer = setTimeout(() => onResetStatus?.(), 1200);
      return () => clearTimeout(timer);
    }
  }, [scanStatus, onResetStatus]);

  const handleManualSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const trimmed = manualValue.trim();
      if (!trimmed) return;
      onScan(trimmed);
      setManualValue('');
    },
    [manualValue, onScan],
  );

  const handleCapture = useCallback(() => {
    const photo = takePhoto();
    if (photo) {
      // Parent can process the photo for barcode detection
      // For now, this is a hook point — real decoding happens upstream
      onScan(`PHOTO:${photo.slice(0, 50)}`);
    }
  }, [takePhoto, onScan]);

  // ── Viewfinder ring color based on scan status ──
  const ringColor = {
    idle: 'border-white/40',
    scanning: 'border-blue-400',
    success: 'border-emerald-400',
    error: 'border-red-400',
    denied: 'border-gray-400',
  }[scanStatus];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={framerPresenceMobile.camera.initial}
          animate={framerPresenceMobile.camera.animate}
          exit={framerPresenceMobile.camera.exit}
          transition={framerTransitionMobile.cameraEnter}
          className="fixed inset-0 z-[200] flex flex-col bg-black"
        >
          {/* ── Top bar ── */}
          <div className="flex-shrink-0 flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
            <div className="flex-1 min-w-0">
              {header ?? (
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/60">
                  Scan Barcode
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close scanner"
              className="h-11 w-11 flex items-center justify-center rounded-full bg-white/10 text-white active:bg-white/20"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* ── Camera viewfinder ── */}
          <div className="flex-1 relative overflow-hidden">
            {!cameraError ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute inset-0 w-full h-full object-cover"
                />

                {/* Viewfinder overlay */}
                <div className="absolute inset-0 flex items-center justify-center">
                  {/* Dimmed corners */}
                  <div className="absolute inset-0 bg-black/40" />

                  {/* Clear viewfinder window */}
                  <motion.div
                    animate={
                      scanStatus === 'success'
                        ? { scale: [1, 1.08, 1] }
                        : scanStatus === 'error'
                          ? { x: [0, -8, 8, -5, 5, 0] }
                          : undefined
                    }
                    transition={
                      scanStatus === 'success'
                        ? framerTransitionMobile.scanSuccess
                        : scanStatus === 'error'
                          ? framerTransitionMobile.scanFailure
                          : undefined
                    }
                    className={`
                      relative w-[72%] max-w-[300px] aspect-square rounded-3xl
                      border-[3px] ${ringColor} transition-colors duration-200
                      bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]
                    `.trim()}
                  >
                    {/* Corner markers */}
                    <span className="absolute top-0 left-0 h-6 w-6 border-t-[3px] border-l-[3px] border-white rounded-tl-xl" />
                    <span className="absolute top-0 right-0 h-6 w-6 border-t-[3px] border-r-[3px] border-white rounded-tr-xl" />
                    <span className="absolute bottom-0 left-0 h-6 w-6 border-b-[3px] border-l-[3px] border-white rounded-bl-xl" />
                    <span className="absolute bottom-0 right-0 h-6 w-6 border-b-[3px] border-r-[3px] border-white rounded-br-xl" />

                    {/* Status feedback */}
                    <AnimatePresence>
                      {scanStatus === 'success' && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.5 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0 }}
                          className="absolute inset-0 flex items-center justify-center"
                        >
                          <div className="h-16 w-16 rounded-full bg-emerald-500/90 flex items-center justify-center">
                            <svg className="h-8 w-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        </motion.div>
                      )}
                      {scanStatus === 'error' && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.5 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0 }}
                          className="absolute inset-0 flex items-center justify-center"
                        >
                          <div className="h-16 w-16 rounded-full bg-red-500/90 flex items-center justify-center">
                            <svg className="h-8 w-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                </div>

                {/* Capture button (center bottom of viewfinder area) */}
                <div className="absolute bottom-6 left-0 right-0 flex justify-center">
                  <button
                    type="button"
                    onClick={handleCapture}
                    aria-label="Capture photo"
                    className="h-16 w-16 rounded-full border-4 border-white/80 bg-white/20 active:bg-white/40 transition-colors"
                  >
                    <span className="block h-full w-full rounded-full border-2 border-white/60" />
                  </button>
                </div>
              </>
            ) : (
              /* Camera denied / unavailable fallback */
              <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
                <div className="h-16 w-16 rounded-full bg-gray-800 flex items-center justify-center mb-4">
                  <svg className="h-8 w-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-sm font-bold text-white mb-1">Camera unavailable</p>
                <p className="text-xs text-gray-400 mb-4">
                  Enable camera access in your browser settings, or enter the code manually below.
                </p>
              </div>
            )}
          </div>

          {/* ── Manual entry fallback ── */}
          {showManualEntry && (
            <div className="flex-shrink-0 bg-black/80 backdrop-blur-sm px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <form onSubmit={handleManualSubmit} className="flex gap-2">
                <input
                  ref={manualInputRef}
                  type="text"
                  value={manualValue}
                  onChange={(e) => setManualValue(e.target.value)}
                  placeholder={placeholder}
                  autoComplete="off"
                  autoCapitalize="characters"
                  className="
                    flex-1 h-11 rounded-xl bg-white/10 border border-white/20
                    px-4 text-sm font-bold text-white placeholder:text-white/40
                    focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/50
                  "
                />
                <button
                  type="submit"
                  disabled={!manualValue.trim()}
                  className="
                    h-11 px-4 rounded-xl bg-blue-600 text-white
                    text-[11px] font-black uppercase tracking-wider
                    disabled:opacity-40 active:bg-blue-700
                  "
                >
                  Go
                </button>
              </form>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
