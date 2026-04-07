'use client';

import React, { useEffect, useCallback } from 'react';
import { X, ScanLine } from 'lucide-react';
import { StationDrawer } from './StationDrawer';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';

interface BarcodeScannerProps {
  isOpen: boolean;
  onScan: (value: string) => void;
  onClose: () => void;
}

export function BarcodeScanner({ isOpen, onScan, onClose }: BarcodeScannerProps) {
  const scanner = useBarcodeScanner({ dedupMs: 2000 });

  // Start/stop with drawer lifecycle
  useEffect(() => {
    if (isOpen) {
      void scanner.startScanning();
    } else {
      void scanner.stopScanning();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Forward decoded value to parent
  useEffect(() => {
    if (scanner.lastScannedValue) {
      const value = scanner.lastScannedValue.trim();
      scanner.acceptScan();
      scanner.resetLastScan();
      void scanner.stopScanning();
      onScan(value);
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanner.lastScannedValue]);

  const handleRetry = useCallback(() => {
    void scanner.startScanning();
  }, [scanner]);

  return (
    <StationDrawer isOpen={isOpen} onClose={onClose} side="bottom">
      <div className="px-4 pt-2 pb-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ScanLine size={16} className="text-navy-700" />
            <span className="text-[9px] font-bold tracking-[0.15em] uppercase text-navy-700 font-sans">
              Point at barcode
            </span>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-station text-gray-400 hover:bg-gray-100 transition-colors touch-manipulation"
            aria-label="Close scanner"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scanner video feed */}
        <div className="relative rounded-station overflow-hidden bg-black aspect-[3/2]">
          <video
            ref={scanner.videoRef as React.RefObject<HTMLVideoElement>}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />

          {/* Viewfinder overlay */}
          {scanner.isScanning && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-[80%] h-[60%] border-2 border-white/40 rounded-lg">
                <span className="absolute top-0 left-0 h-4 w-4 border-t-2 border-l-2 border-white rounded-tl" />
                <span className="absolute top-0 right-0 h-4 w-4 border-t-2 border-r-2 border-white rounded-tr" />
                <span className="absolute bottom-0 left-0 h-4 w-4 border-b-2 border-l-2 border-white rounded-bl" />
                <span className="absolute bottom-0 right-0 h-4 w-4 border-b-2 border-r-2 border-white rounded-br" />
              </div>
            </div>
          )}

          {/* Error state */}
          {scanner.scanStatus === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 px-4 text-center">
              <p className="text-xs text-gray-400 mb-3">{scanner.error || 'Camera unavailable'}</p>
              <button
                type="button"
                onClick={handleRetry}
                className="text-xs font-bold text-blue-400 active:text-blue-300"
              >
                Try Again
              </button>
            </div>
          )}
        </div>

        {/* Torch toggle + manual entry hint */}
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-gray-400 font-sans">
            Or type the code in the scan bar and press Return
          </p>
          {scanner.isScanning && (
            <button
              type="button"
              onClick={() => scanner.toggleTorch()}
              className={`ml-2 h-8 w-8 flex-shrink-0 rounded-full flex items-center justify-center transition-colors ${
                scanner.torchOn ? 'bg-yellow-100 text-yellow-600' : 'bg-gray-100 text-gray-400'
              }`}
              aria-label="Toggle flashlight"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </StationDrawer>
  );
}
