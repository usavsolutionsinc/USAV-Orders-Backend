'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

export type BarcodeScanStatus = 'idle' | 'scanning' | 'paused' | 'error';

export interface UseBarcodeScanner {
  /** Attach to a <video autoPlay playsInline muted /> — ZXing renders its camera feed here. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
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
  /** Toggle torch/flashlight if available. */
  toggleTorch: () => void;
  /** Whether torch is currently on. */
  torchOn: boolean;
}

interface UseBarcodeOptions {
  /** Dedup window in ms — same value within this window is suppressed. Default: 2000. */
  dedupMs?: number;
  /** Cooldown after acceptScan() in ms. Default: 1500. */
  acceptCooldownMs?: number;
}

// IScannerControls type from @zxing/browser
interface ScannerControls {
  stop: () => void;
  switchTorch?: (onOff: boolean) => Promise<void>;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Universal barcode scanner hook powered by `@zxing/browser`.
 *
 * Attach `videoRef` to a `<video autoPlay playsInline muted />` element.
 * ZXing manages the camera stream and runs continuous barcode decoding.
 *
 * Supported formats: QR, Code 128, Code 39, Codabar, Data Matrix, ITF,
 * EAN-13, EAN-8, UPC-A, UPC-E — covers shipping labels, serial stickers,
 * and product barcodes.
 */
export function useBarcodeScanner(options: UseBarcodeOptions = {}): UseBarcodeScanner {
  const { dedupMs = 2000, acceptCooldownMs = 1500 } = options;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<ScannerControls | null>(null);
  const pausedRef = useRef(false);

  const [scanStatus, setScanStatus] = useState<BarcodeScanStatus>('idle');
  const [lastScannedValue, setLastScannedValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);

  // Dedup + cooldown refs
  const lastDecodedRef = useRef<{ value: string; timestamp: number } | null>(null);
  const cooldownUntilRef = useRef<number>(0);

  const log = useCallback((msg: string) => {
    if (typeof window !== 'undefined' && !(window as any).__USAV_CAMERA_DEBUG) return;
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    console.debug(`[useBarcodeScanner ${ts}] ${msg}`);
  }, []);

  // ── Start scanning ──

  const startScanning = useCallback(async () => {
    log('startScanning called');

    const isSecureOrigin =
      location.protocol === 'https:' ||
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1';

    if (!navigator.mediaDevices?.getUserMedia) {
      setScanStatus('error');
      setError(
        isSecureOrigin
          ? 'Camera API unavailable in this browser.'
          : 'Camera access requires HTTPS or localhost.',
      );
      return;
    }

    // Stop any prior session
    if (controlsRef.current) {
      controlsRef.current.stop();
      controlsRef.current = null;
    }

    const video = videoRef.current;
    if (!video) {
      log('ERROR: no video ref');
      return;
    }

    try {
      log('Importing @zxing/browser...');
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const { BarcodeFormat, DecodeHintType } = await import('@zxing/library');

      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.QR_CODE,
        BarcodeFormat.CODABAR,
        BarcodeFormat.CODE_39,
        BarcodeFormat.CODE_128,
        BarcodeFormat.DATA_MATRIX,
        BarcodeFormat.ITF,
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true);

      const reader = new BrowserMultiFormatReader(hints);
      log('ZXing reader created');

      setScanStatus('scanning');
      setError(null);
      pausedRef.current = false;

      // decodeFromVideoDevice handles camera acquisition + continuous decode loop.
      // Pass undefined as deviceId to let it pick the best available camera.
      const controls = await reader.decodeFromVideoDevice(
        undefined,
        video,
        (result, _err) => {
          if (pausedRef.current) return;
          if (!result) return; // no barcode in this frame

          const decodedText = result.getText();
          const now = Date.now();

          // Cooldown check
          if (now < cooldownUntilRef.current) return;

          // Dedup check
          const last = lastDecodedRef.current;
          if (last && last.value === decodedText && now - last.timestamp < dedupMs) return;

          log(`Decoded: ${decodedText}`);
          lastDecodedRef.current = { value: decodedText, timestamp: now };
          setLastScannedValue(decodedText);
        },
      );

      controlsRef.current = controls;
      log('Scanning started');
    } catch (err: any) {
      setScanStatus('error');
      controlsRef.current = null;

      const errName = err?.name || '';
      const errMsg = String(err?.message || '').toLowerCase();
      log(`ERROR: name=${errName} msg=${err?.message?.slice(0, 120)}`);

      if (!isSecureOrigin || errMsg.includes('secure context') || errMsg.includes('https')) {
        setError('Camera access requires HTTPS or localhost. Safari will not prompt on an insecure dev URL.');
      } else if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError' || errMsg.includes('permission')) {
        setError('Camera permission denied. On Safari: Settings → Safari → Camera → Allow. Then reload.');
      } else if (errName === 'NotReadableError' || errMsg.includes('could not start video')) {
        setError('Camera is busy or blocked by another app or browser tab.');
      } else if (errName === 'NotFoundError' || errMsg.includes('no camera') || errMsg.includes('not found')) {
        setError('No camera found on this device.');
      } else {
        setError(err?.message || 'Camera unavailable');
      }
    }
  }, [log, dedupMs]);

  // ── Stop scanning ──

  const stopScanning = useCallback(async () => {
    if (controlsRef.current) {
      controlsRef.current.stop();
      controlsRef.current = null;
    }
    // Also stop any leftover tracks on the video element
    const video = videoRef.current;
    if (video?.srcObject) {
      (video.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    }
    pausedRef.current = false;
    setTorchOn(false);
    setScanStatus('idle');
  }, []);

  // ── Pause / Resume ──

  const pauseScanning = useCallback(() => {
    pausedRef.current = true;
    setScanStatus('paused');
  }, []);

  const resumeScanning = useCallback(() => {
    pausedRef.current = false;
    setScanStatus('scanning');
  }, []);

  // ── Accept / Reset ──

  const acceptScan = useCallback(() => {
    cooldownUntilRef.current = Date.now() + acceptCooldownMs;
  }, [acceptCooldownMs]);

  const resetLastScan = useCallback(() => {
    setLastScannedValue(null);
    lastDecodedRef.current = null;
  }, []);

  // ── Torch ──

  const toggleTorch = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls?.switchTorch) {
      // Fallback: try applying constraints directly to the video track
      const video = videoRef.current;
      const track = (video?.srcObject as MediaStream)?.getVideoTracks()[0];
      if (!track) return;
      const caps = track.getCapabilities?.() as any;
      if (!caps?.torch) return;
      const newState = !torchOn;
      (track as any).applyConstraints({ advanced: [{ torch: newState }] })
        .then(() => setTorchOn(newState))
        .catch(() => {});
      return;
    }

    const newState = !torchOn;
    controls.switchTorch(newState)
      .then(() => setTorchOn(newState))
      .catch(() => {});
  }, [torchOn]);

  // ── Cleanup on unmount ──

  useEffect(() => {
    return () => {
      if (controlsRef.current) {
        controlsRef.current.stop();
        controlsRef.current = null;
      }
    };
  }, []);

  return {
    videoRef,
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
    toggleTorch,
    torchOn,
  };
}
