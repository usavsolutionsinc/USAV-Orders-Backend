'use client';

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Camera, RefreshCw, Check, X } from 'lucide-react';
import { cn } from '@/utils/_cn';

interface PhotoCaptureProps {
  onCapture: (blob: Blob, previewUrl: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * PhotoCapture — dual-mode camera component.
 *
 * Mobile / iOS PWA: uses native <input capture="environment"> which
 *   opens the OS camera app directly — no getUserMedia needed.
 *
 * Desktop: falls back to getUserMedia() webcam stream with a
 *   canvas snapshot on click.
 */
export function PhotoCapture({ onCapture, disabled = false, className }: PhotoCaptureProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [mode, setMode] = useState<'idle' | 'webcam' | 'preview'>('idle');
  const [preview, setPreview] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIsMobile(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
  }, []);

  // Stop webcam stream on unmount
  useEffect(() => {
    return () => { stream?.getTracks().forEach(t => t.stop()); };
  }, [stream]);

  // ── Mobile: native file input ──────────────────────────────────────────────
  // Stay in 'idle' on mobile so the user can immediately tap "Take Photo" again
  // and snap back-to-back shots. The parent owns the captured-photo strip.
  const handleMobileCapture = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    onCapture(file, url);
    // Reset so the same file can be re-captured
    e.target.value = '';
  }, [onCapture]);

  // ── Desktop: getUserMedia webcam ───────────────────────────────────────────
  const [cameraError, setCameraError] = useState<string | null>(null);

  const startWebcam = useCallback(async () => {
    setCameraError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera API unavailable — requires HTTPS or localhost.');
      return;
    }

    // Desktop Safari has no rear camera; use 'user' (front) as primary, then any camera as fallback
    const attempts: MediaStreamConstraints[] = [
      { video: { width: { ideal: 1280 }, height: { ideal: 720 } } },
      { video: { facingMode: 'user' } },
      { video: true },
    ];

    for (const constraints of attempts) {
      try {
        const s = await navigator.mediaDevices.getUserMedia(constraints);
        setStream(s);
        setMode('webcam');
        requestAnimationFrame(() => {
          if (videoRef.current) {
            videoRef.current.srcObject = s;
            videoRef.current.play().catch(() => {});
          }
        });
        return; // success
      } catch {
        // try next constraint set
      }
    }

    // All attempts failed
    setCameraError(
      'Camera permission denied or no camera found. Check Safari → Settings → Websites → Camera → Allow.',
    );
  }, []);

  const captureSnapshot = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);

    canvas.toBlob(blob => {
      if (!blob) return;
      const url = canvas.toDataURL('image/jpeg', 0.92);
      setPreview(url);
      setMode('preview');
      stream?.getTracks().forEach(t => t.stop());
      setStream(null);
      onCapture(blob, url);
    }, 'image/jpeg', 0.92);
  }, [stream, onCapture]);

  const retake = useCallback(() => {
    setPreview(null);
    setMode('idle');
    stream?.getTracks().forEach(t => t.stop());
    setStream(null);
  }, [stream]);

  const handleCameraClick = useCallback(() => {
    if (disabled) return;
    if (isMobile) {
      fileInputRef.current?.click();
    } else {
      startWebcam();
    }
  }, [disabled, isMobile, startWebcam]);

  return (
    <div className={cn('relative', className)}>
      {/* Hidden native file input — mobile only */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={handleMobileCapture}
        disabled={disabled}
      />
      <canvas ref={canvasRef} className="hidden" />

      {/* Idle / trigger button */}
      {mode === 'idle' && (
        <div>
          <button
            type="button"
            onClick={handleCameraClick}
            disabled={disabled}
            className={cn(
              'flex flex-col items-center justify-center gap-2',
              'w-full h-32 rounded-station border-2 border-dashed border-gray-200',
              'text-gray-400 hover:border-navy-400 hover:text-navy-600',
              'transition-colors touch-manipulation',
              disabled && 'opacity-40 cursor-not-allowed',
            )}
          >
            <Camera size={24} strokeWidth={1.5} />
            <span className="text-[10px] font-bold tracking-[0.12em] uppercase font-sans">
              Take Photo
            </span>
          </button>
          {cameraError && (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-600">
              {cameraError}
            </p>
          )}
        </div>
      )}

      {/* Webcam live view (desktop) */}
      {mode === 'webcam' && (
        <div className="relative rounded-station overflow-hidden bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full rounded-station"
            style={{ maxHeight: 240 }}
          />
          <div className="absolute bottom-3 inset-x-0 flex justify-center gap-3">
            <button
              type="button"
              onClick={retake}
              className="flex items-center justify-center w-10 h-10 rounded-full bg-white/20 backdrop-blur text-white hover:bg-white/30 transition-colors touch-manipulation"
            >
              <X size={18} />
            </button>
            <button
              type="button"
              onClick={captureSnapshot}
              className="flex items-center justify-center w-14 h-14 rounded-full bg-white text-navy-800 shadow-lg hover:scale-95 transition-transform touch-manipulation"
              aria-label="Capture photo"
            >
              <Camera size={22} />
            </button>
          </div>
        </div>
      )}

      {/* Preview */}
      {mode === 'preview' && preview && (
        <div className="relative rounded-station overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt="Captured"
            className="w-full object-cover rounded-station"
            style={{ maxHeight: 200 }}
          />
          <div className="absolute top-2 right-2 flex gap-2">
            <button
              type="button"
              onClick={retake}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-white/90 text-gray-700 shadow hover:bg-white transition-colors touch-manipulation"
              aria-label="Retake photo"
            >
              <RefreshCw size={14} />
            </button>
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-500 text-white shadow">
              <Check size={14} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
