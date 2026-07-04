'use client';

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';

interface MobilePoQrScanSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Fired with the decoded barcode/QR string. */
  onDecode: (value: string) => void;
}

/**
 * Single-purpose QR scan sheet — opens the camera, decodes one barcode,
 * hands the raw value back to the caller and closes. No backend publish.
 * Mirrors the look of MobileReceivingScanSheet but stripped down to a
 * scan-once-and-go interaction for filling search inputs.
 */
export function MobilePoQrScanSheet({ isOpen, onClose, onDecode }: MobilePoQrScanSheetProps) {
  const scanner = useBarcodeScanner({ dedupMs: 1500 });

  useEffect(() => {
    if (isOpen) {
      scanner.resetLastScan();
      void scanner.startScanning();
    } else {
      void scanner.stopScanning();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const value = scanner.lastScannedValue;
    if (!value) return;
    scanner.acceptScan();
    onDecode(value);
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanner.lastScannedValue, isOpen]);

  const cameraReady = scanner.scanStatus === 'scanning';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="po-qr-scan"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-panel flex flex-col bg-stage"
        >
          <div className="flex-shrink-0 flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 bg-surface-card border-b border-border-soft">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-text-soft">
                Scan PO
              </p>
              <p className="mt-1 text-xs font-bold text-text-muted">
                Point at the PO barcode or QR
              </p>
            </div>
            <IconButton
              icon={<X className="h-5 w-5" />}
              onClick={onClose}
              ariaLabel="Close"
              className="h-11 w-11 flex items-center justify-center rounded-full bg-surface-sunken text-text-muted active:bg-surface-strong"
            />
          </div>

          <div className="flex-1 relative overflow-hidden bg-stage-raised">
            <video
              ref={scanner.videoRef as React.RefObject<HTMLVideoElement>}
              autoPlay
              playsInline
              muted
              className={`pointer-events-none absolute inset-0 w-full h-full object-cover ${
                cameraReady ? 'opacity-100' : 'opacity-0'
              }`}
            />

            {scanner.scanStatus === 'error' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center bg-surface-card">
                <p className="text-sm font-bold text-text-default mb-1">Camera unavailable</p>
                <p className="text-xs text-text-soft mb-4 max-w-[260px]">
                  {scanner.error || 'Enable camera access in your browser settings.'}
                </p>
                <Button
                  variant="primary"
                  onClick={() => void scanner.startScanning()}
                  className="h-11 px-5"
                >
                  Try Again
                </Button>
              </div>
            )}

            {cameraReady && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="relative w-[72%] max-w-[300px] aspect-square">
                  <span className="absolute top-0 left-0 h-6 w-6 border-t-[3px] border-l-[3px] border-white rounded-tl-xl" />
                  <span className="absolute top-0 right-0 h-6 w-6 border-t-[3px] border-r-[3px] border-white rounded-tr-xl" />
                  <span className="absolute bottom-0 left-0 h-6 w-6 border-b-[3px] border-l-[3px] border-white rounded-bl-xl" />
                  <span className="absolute bottom-0 right-0 h-6 w-6 border-b-[3px] border-r-[3px] border-white rounded-br-xl" />
                  <motion.div
                    animate={{ y: ['0%', '100%', '0%'] }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                    className="absolute left-3 right-3 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent"
                  />
                </div>
              </div>
            )}

            {cameraReady && (
              <div className="absolute top-4 right-4">
                <button
                  type="button"
                  onClick={() => scanner.toggleTorch()}
                  className={`ds-raw-button h-10 w-10 rounded-full flex items-center justify-center ${
                    scanner.torchOn
                      ? 'bg-yellow-400/30 text-yellow-200 border border-yellow-400/50'
                      : 'bg-glass/15 text-white/80 border border-glass/25'
                  }`}
                  aria-label={scanner.torchOn ? 'Turn off flashlight' : 'Turn on flashlight'}
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                    />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
