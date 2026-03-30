'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

export type BarcodeScanStatus = 'idle' | 'scanning' | 'paused' | 'error';

export interface UseBarcodeScanner {
  /** Attach to a <div> — html5-qrcode renders its camera feed inside. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Last decoded barcode string (null until first decode). */
  lastScannedValue: string | null;
  /** Current scan lifecycle phase. */
  scanStatus: BarcodeScanStatus;
  /** Start the camera and begin continuous scanning. */
  startScanning: () => Promise<void>;
  /** Stop the camera entirely. */
  stopScanning: () => Promise<void>;
  /** Pause decoding (camera stays on but no callbacks fire). */
  pauseScanning: () => void;
  /** Resume decoding after pause. */
  resumeScanning: () => void;
  /** Signal that the caller accepted the last scan — cooldown prevents re-fire. */
  acceptScan: () => void;
  /** Clear lastScannedValue back to null. */
  resetLastScan: () => void;
  /** True while camera is actively scanning (not paused or stopped). */
  isScanning: boolean;
  /** Error message if camera fails to start. */
  error: string | null;
}

interface UseBarcodeOptions {
  /** Frames per second for decode attempts. Default: 10. */
  fps?: number;
  /** Dedup window in ms — same value within this window is suppressed. Default: 2000. */
  dedupMs?: number;
  /** Cooldown after acceptScan() in ms. Default: 1500. */
  acceptCooldownMs?: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

// Barcode formats found on shipping labels, serial stickers, and product barcodes.
// Imported dynamically to avoid SSR issues with the html5-qrcode library.
const SUPPORTED_FORMAT_IDS = [
  0,  // QR_CODE
  2,  // CODABAR
  3,  // CODE_39
  5,  // CODE_128
  6,  // DATA_MATRIX
  8,  // ITF
  9,  // EAN_13
  10, // EAN_8
  14, // UPC_A
  15, // UPC_E
];

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Universal barcode scanner hook wrapping `html5-qrcode`.
 *
 * The hook's `containerRef` div is the camera viewfinder — `html5-qrcode`
 * renders its own `<video>` element inside. Overlay your viewfinder UI
 * (corner markers, status ring) on top with absolute positioning.
 *
 * Does NOT import classification logic — only decodes raw text from barcodes.
 */
export function useBarcodeScanner(options: UseBarcodeOptions = {}): UseBarcodeScanner {
  const { fps = 10, dedupMs = 2000, acceptCooldownMs = 1500 } = options;

  const uniqueId = useId().replace(/:/g, '');
  const elementId = `html5qr-${uniqueId}`;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<any>(null); // Html5Qrcode instance
  const [scanStatus, setScanStatus] = useState<BarcodeScanStatus>('idle');
  const [lastScannedValue, setLastScannedValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Dedup + cooldown refs
  const lastDecodedRef = useRef<{ value: string; timestamp: number } | null>(null);
  const cooldownUntilRef = useRef<number>(0);

  // ── Start scanning ──

  const startScanning = useCallback(async () => {
    if (instanceRef.current) return; // already running
    const container = containerRef.current;
    if (!container) return;

    // Ensure the mount div exists inside the container
    let mountDiv = container.querySelector(`#${elementId}`) as HTMLDivElement | null;
    if (!mountDiv) {
      mountDiv = document.createElement('div');
      mountDiv.id = elementId;
      mountDiv.style.width = '100%';
      mountDiv.style.height = '100%';
      container.appendChild(mountDiv);
    }

    try {
      // Dynamic import to avoid SSR crashes
      const { Html5Qrcode } = await import('html5-qrcode');

      const qr = new Html5Qrcode(elementId, {
        formatsToSupport: SUPPORTED_FORMAT_IDS as any,
        useBarCodeDetectorIfSupported: true,
        verbose: false,
      });

      instanceRef.current = qr;
      setScanStatus('scanning');
      setError(null);

      await qr.start(
        { facingMode: 'environment' },
        {
          fps,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => ({
            width: Math.floor(viewfinderWidth * 0.85),
            height: Math.floor(viewfinderHeight * 0.7),
          }),
          disableFlip: false,
        },
        // Success callback
        (decodedText: string) => {
          const now = Date.now();

          // Cooldown after accepted scan
          if (now < cooldownUntilRef.current) return;

          // Dedup: suppress same value within dedupMs
          const last = lastDecodedRef.current;
          if (last && last.value === decodedText && now - last.timestamp < dedupMs) {
            return;
          }

          lastDecodedRef.current = { value: decodedText, timestamp: now };
          setLastScannedValue(decodedText);
        },
        // Error callback (called on every frame without a detection — ignore)
        () => {},
      );
    } catch (err: any) {
      setScanStatus('error');
      setError(err?.message || 'Camera unavailable');
      instanceRef.current = null;
    }
  }, [elementId, fps, dedupMs]);

  // ── Stop scanning ──

  const stopScanning = useCallback(async () => {
    const qr = instanceRef.current;
    if (!qr) return;
    try {
      if (qr.isScanning) await qr.stop();
      qr.clear();
    } catch {
      // Already stopped
    }
    instanceRef.current = null;
    setScanStatus('idle');
  }, []);

  // ── Pause / Resume ──

  const pauseScanning = useCallback(() => {
    const qr = instanceRef.current;
    if (!qr) return;
    try {
      qr.pause(true); // true = pause video too
      setScanStatus('paused');
    } catch {
      // Not in scannable state
    }
  }, []);

  const resumeScanning = useCallback(() => {
    const qr = instanceRef.current;
    if (!qr) return;
    try {
      qr.resume();
      setScanStatus('scanning');
    } catch {
      // Not in pausable state
    }
  }, []);

  // ── Accept / Reset ──

  const acceptScan = useCallback(() => {
    cooldownUntilRef.current = Date.now() + acceptCooldownMs;
  }, [acceptCooldownMs]);

  const resetLastScan = useCallback(() => {
    setLastScannedValue(null);
    lastDecodedRef.current = null;
  }, []);

  // ── Cleanup on unmount ──

  useEffect(() => {
    return () => {
      const qr = instanceRef.current;
      if (qr) {
        try {
          if (qr.isScanning) qr.stop().then(() => qr.clear()).catch(() => {});
          else qr.clear();
        } catch {
          // Best-effort cleanup
        }
        instanceRef.current = null;
      }
    };
  }, []);

  return {
    containerRef,
    lastScannedValue,
    scanStatus,
    startScanning,
    stopScanning,
    pauseScanning,
    resumeScanning,
    acceptScan,
    resetLastScan,
    isScanning: scanStatus === 'scanning',
    error,
  };
}
