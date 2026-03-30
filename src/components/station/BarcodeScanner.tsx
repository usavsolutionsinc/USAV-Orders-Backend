'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import { X, ScanLine } from 'lucide-react';
import { StationDrawer } from './StationDrawer';

interface BarcodeScannerProps {
  isOpen: boolean;
  onScan: (value: string) => void;
  onClose: () => void;
}

const SCANNER_ELEMENT_ID = 'usav-barcode-reader';

export function BarcodeScanner({ isOpen, onScan, onClose }: BarcodeScannerProps) {
  const scannerRef = useRef<InstanceType<typeof import('html5-qrcode').Html5QrcodeScanner> | null>(null);

  const stopScanner = useCallback(() => {
    if (scannerRef.current) {
      scannerRef.current.clear().catch(() => {});
      scannerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      stopScanner();
      return;
    }

    let mounted = true;

    import('html5-qrcode').then(({ Html5QrcodeScanner }) => {
      if (!mounted || !document.getElementById(SCANNER_ELEMENT_ID)) return;

      const scanner = new Html5QrcodeScanner(
        SCANNER_ELEMENT_ID,
        {
          fps: 15,
          qrbox: { width: 260, height: 120 },
          aspectRatio: 1.5,
          showTorchButtonIfSupported: true,
          showZoomSliderIfSupported: false,
          defaultZoomValueIfSupported: 2,
          rememberLastUsedCamera: true,
          videoConstraints: { facingMode: 'environment' },
        },
        /* verbose */ false,
      );

      scanner.render(
        (decodedText) => {
          stopScanner();
          onScan(decodedText.trim());
          onClose();
        },
        (error) => {
          // Suppress not-found frames — normal during scan
          if (!error.includes('No MultiFormat Readers')) {
            console.warn('BarcodeScanner:', error);
          }
        },
      );

      scannerRef.current = scanner;
    });

    return () => {
      mounted = false;
      stopScanner();
    };
  }, [isOpen, onScan, onClose, stopScanner]);

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

        {/* Scanner mount point */}
        <div
          id={SCANNER_ELEMENT_ID}
          className="rounded-station overflow-hidden [&_video]:rounded-station [&_#html5-qrcode-button-camera-permission]:hidden"
        />

        {/* Manual entry hint */}
        <p className="mt-3 text-center text-xs text-gray-400 font-sans">
          Or type the code in the scan bar and press Return
        </p>
      </div>
    </StationDrawer>
  );
}
