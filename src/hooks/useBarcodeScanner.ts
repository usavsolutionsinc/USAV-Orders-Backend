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

  const log = useCallback((msg: string) => {
    if (typeof window !== 'undefined' && !(window as any).__USAV_CAMERA_DEBUG) return;
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    console.debug(`[useBarcodeScanner ${ts}] ${msg}`);
  }, []);

  // Dedup + cooldown refs
  const lastDecodedRef = useRef<{ value: string; timestamp: number } | null>(null);
  const cooldownUntilRef = useRef<number>(0);

  // ── Start scanning ──

  const startScanning = useCallback(async () => {
    log('startScanning called');

    // Check API availability
    const hasMediaDevices = !!navigator.mediaDevices;
    const hasGetUserMedia = !!(navigator.mediaDevices?.getUserMedia);
    const isSecureOrigin = location.protocol === 'https:'
      || location.hostname === 'localhost'
      || location.hostname === '127.0.0.1';
    log(`mediaDevices: ${hasMediaDevices}, getUserMedia: ${hasGetUserMedia}`);
    log(`userAgent: ${navigator.userAgent.slice(0, 80)}`);
    log(`protocol: ${location.protocol}, host: ${location.host}`);
    log(`standalone: ${('standalone' in navigator && (navigator as any).standalone) || window.matchMedia('(display-mode: standalone)').matches}`);

    if (!hasGetUserMedia) {
      setScanStatus('error');
      setError(
        isSecureOrigin
          ? 'Camera API unavailable in this browser.'
          : 'Camera access requires HTTPS or localhost. Safari will not prompt on an insecure dev URL.',
      );
      return;
    }

    // Clean up any previous failed instance before retrying
    if (instanceRef.current) {
      log('Cleaning up previous instance');
      try {
        if (instanceRef.current.isScanning) await instanceRef.current.stop();
        instanceRef.current.clear();
      } catch { /* best-effort */ }
      instanceRef.current = null;
    }

    const container = containerRef.current;
    if (!container) { log('ERROR: no container ref'); return; }

    // Remove stale mount div and create fresh (html5-qrcode leaves artifacts on error)
    const stale = container.querySelector(`#${elementId}`);
    if (stale) { stale.remove(); log('Removed stale mount div'); }

    const mountDiv = document.createElement('div');
    mountDiv.id = elementId;
    mountDiv.style.width = '100%';
    mountDiv.style.height = '100%';
    container.appendChild(mountDiv);
    log('Mount div created');

    try {
      // Dynamic import to avoid SSR crashes
      log('Importing html5-qrcode...');
      const { Html5Qrcode } = await import('html5-qrcode');
      log('html5-qrcode imported OK');

      const createScanner = () => new Html5Qrcode(elementId, {
        formatsToSupport: SUPPORTED_FORMAT_IDS as any,
        useBarCodeDetectorIfSupported: true,
        verbose: false,
      });

      const scanConfig = {
        fps,
        qrbox: (viewfinderWidth: number, viewfinderHeight: number) => ({
          width: Math.floor(viewfinderWidth * 0.85),
          height: Math.floor(viewfinderHeight * 0.7),
        }),
        disableFlip: false,
      };

      const onDecoded = (decodedText: string) => {
        const now = Date.now();

        if (now < cooldownUntilRef.current) return;

        const last = lastDecodedRef.current;
        if (last && last.value === decodedText && now - last.timestamp < dedupMs) {
          return;
        }

        lastDecodedRef.current = { value: decodedText, timestamp: now };
        setLastScannedValue(decodedText);
      };

      const startAttempts: Array<{ label: string; cameraIdOrConfig: string | { facingMode: 'environment' | 'user' } }> = [
        { label: 'rear camera', cameraIdOrConfig: { facingMode: 'environment' } },
        { label: 'front camera', cameraIdOrConfig: { facingMode: 'user' } },
      ];

      try {
        const cameras = await Html5Qrcode.getCameras();
        if (cameras[0]?.id) {
          startAttempts.push({ label: 'first available camera', cameraIdOrConfig: cameras[0].id });
        }
      } catch (cameraListErr: any) {
        log(`getCameras failed: ${cameraListErr?.message || cameraListErr}`);
      }

      setScanStatus('scanning');
      setError(null);

      let lastStartError: any = null;
      for (const attempt of startAttempts) {
        const qr = createScanner();
        instanceRef.current = qr;
        log(`Calling qr.start(${attempt.label})...`);

        try {
          await qr.start(
            attempt.cameraIdOrConfig,
            scanConfig,
            onDecoded,
            () => {},
          );
          log(`qr.start() succeeded via ${attempt.label}`);
          return;
        } catch (attemptErr: any) {
          lastStartError = attemptErr;
          const attemptName = attemptErr?.name || '';
          const attemptMsg = String(attemptErr?.message || '').toLowerCase();
          log(`qr.start(${attempt.label}) failed: ${attemptName} ${String(attemptErr?.message || '').slice(0, 120)}`);

          try {
            qr.clear();
          } catch {
            // Best-effort cleanup before next attempt
          }
          instanceRef.current = null;

          const unrecoverable =
            attemptName === 'NotAllowedError' ||
            attemptName === 'PermissionDeniedError' ||
            attemptMsg.includes('permission') ||
            attemptMsg.includes('not allowed') ||
            attemptMsg.includes('secure context') ||
            attemptMsg.includes('https or localhost');

          if (unrecoverable) break;
        }
      }

      throw lastStartError || new Error('Camera unavailable');
    } catch (err: any) {
      setScanStatus('error');
      instanceRef.current = null;

      const errName = err?.name || '';
      const errMsg = String(err?.message || '').toLowerCase();
      log(`ERROR: name=${errName} msg=${err?.message?.slice(0, 120)}`);

      if (!isSecureOrigin || errMsg.includes('secure context') || errMsg.includes('https or localhost')) {
        setError('Camera access requires HTTPS or localhost. If mobile Safari is on http://<your-ip>:3000, it will not show a permission prompt.');
      } else if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError'
          || errMsg.includes('permission') || errMsg.includes('not allowed')) {
        setError(
          'Camera permission denied. On Safari: Settings → Safari → Camera → Allow. Then reload the page.',
        );
      } else if (errName === 'NotReadableError' || errMsg.includes('could not start video source')) {
        setError('Camera is busy or blocked by another app or browser tab.');
      } else if (errName === 'NotFoundError' || errMsg.includes('no camera') || errMsg.includes('not found')) {
        setError('No camera found on this device.');
      } else {
        setError(err?.message || 'Camera unavailable');
      }
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
