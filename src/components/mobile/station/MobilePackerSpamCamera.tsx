'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  framerPresenceMobile,
  framerTransitionMobile,
} from '@/design-system/foundations/motion-framer';
import { Camera, X, Check, Trash2 } from '@/components/Icons';
import { useCamera } from '@/hooks/useCamera';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CapturedShot {
  id: string;
  blob: Blob;
  previewUrl: string;
}

export interface MobilePackerSpamCameraProps {
  /** Called when the user finishes capturing and confirms. Parent owns the blobs after this. */
  onDone: (shots: CapturedShot[]) => void;
  /** Called when the user backs out without keeping any photos. */
  onCancel: () => void;
  /** Max photos allowed in one batch. */
  maxPhotos?: number;
  /** JPEG quality 0..1. */
  jpegQuality?: number;
  /** Optional header label above the viewfinder. */
  header?: React.ReactNode;
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * MobilePackerSpamCamera — fullscreen rapid-capture camera.
 *
 * Behaviour:
 *  • Reuses `useCamera()` (which owns getUserMedia + stop lifecycle).
 *  • Auto-resolution chain: 1920×1080 → 1280×720 → any. Keeps older iPhones happy.
 *  • Each shutter tap canvases the current video frame and `toBlob`s it as JPEG.
 *  • Photos accumulate locally in a thumbnail strip — NO network calls.
 *  • On Done, ownership of the blobs transfers to the parent (object URLs are
 *    NOT revoked, parent is responsible for cleanup once they're rendered in
 *    the review grid).
 *  • On unmount without Done, all object URLs are revoked.
 */
export function MobilePackerSpamCamera({
  onDone,
  onCancel,
  maxPhotos = 5,
  jpegQuality = 0.85,
  header,
}: MobilePackerSpamCameraProps) {
  const { videoRef, startCamera, stopCamera, cameraError } = useCamera();
  const [shots, setShots] = useState<CapturedShot[]>([]);
  const [flash, setFlash] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [startError, setStartError] = useState(false);

  // Track whether the parent took ownership — if so, skip revoke-on-unmount.
  const handedOffRef = useRef(false);
  // Always-current shots reference for unmount cleanup.
  const shotsRef = useRef<CapturedShot[]>([]);
  shotsRef.current = shots;

  // ── Camera start with resolution fallback ────────────────────────────────
  const attemptStart = useCallback(async () => {
    setStartError(false);
    const chain: Array<{ width?: { ideal: number }; height?: { ideal: number } }> = [
      { width: { ideal: 1920 }, height: { ideal: 1080 } },
      { width: { ideal: 1280 }, height: { ideal: 720 } },
      {},
    ];
    for (const c of chain) {
      try {
        await startCamera({ facingMode: 'environment', ...c });
        return;
      } catch {
        // try next
      }
    }
    setStartError(true);
  }, [startCamera]);

  useEffect(() => {
    void attemptStart();
    return () => stopCamera();
  }, [attemptStart, stopCamera]);

  // Revoke object URLs on unmount unless the parent took ownership.
  useEffect(() => {
    return () => {
      if (handedOffRef.current) return;
      shotsRef.current.forEach((s) => URL.revokeObjectURL(s.previewUrl));
    };
  }, []);

  // ── Shutter ─────────────────────────────────────────────────────────────
  const shutter = useCallback(async () => {
    if (shots.length >= maxPhotos) return;
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob((b) => res(b), 'image/jpeg', jpegQuality),
    );
    if (!blob) return;

    const previewUrl = URL.createObjectURL(blob);
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    setShots((prev) => [...prev, { id, blob, previewUrl }]);
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
  }, [shots.length, maxPhotos, jpegQuality, videoRef]);

  // ── Remove a shot ───────────────────────────────────────────────────────
  const removeShot = useCallback((id: string) => {
    setShots((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((s) => s.id !== id);
    });
    setPreviewIndex(null);
  }, []);

  // ── Done ─────────────────────────────────────────────────────────────────
  const handleDone = useCallback(() => {
    handedOffRef.current = true;
    onDone(shots);
  }, [onDone, shots]);

  // ── Cancel / back ────────────────────────────────────────────────────────
  const handleCancel = useCallback(() => {
    // shots will be revoked by unmount effect (handedOffRef stays false)
    onCancel();
  }, [onCancel]);

  const remaining = maxPhotos - shots.length;
  const atCap = remaining <= 0;

  return (
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
              Packer Photos · {shots.length}/{maxPhotos}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handleCancel}
          aria-label="Close camera"
          className="h-11 w-11 flex items-center justify-center rounded-full bg-red-600 text-white shadow-lg shadow-red-600/40 active:bg-red-700 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* ── Viewfinder ── */}
      <div className="flex-1 relative overflow-hidden">
        {!startError && !cameraError ? (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
            />

            {/* Shutter flash overlay */}
            <AnimatePresence>
              {flash && (
                <motion.div
                  initial={{ opacity: 0.85 }}
                  animate={{ opacity: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  className="absolute inset-0 bg-white pointer-events-none"
                />
              )}
            </AnimatePresence>

            {/* Cap reached banner */}
            {atCap && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-amber-500/95 text-[10px] font-black uppercase tracking-wider text-white">
                Max {maxPhotos} photos
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 h-full flex flex-col items-center justify-center px-6 text-center">
            <div className="h-16 w-16 rounded-full bg-gray-800 flex items-center justify-center mb-4">
              <Camera className="h-8 w-8 text-gray-500" />
            </div>
            <p className="text-sm font-bold text-white mb-1">Camera unavailable</p>
            <p className="text-xs text-gray-400 mb-4 max-w-xs">
              {cameraError === 'permission-denied'
                ? 'Enable camera access in your browser settings, then tap Try Again.'
                : 'No camera detected, or the browser blocked access.'}
            </p>
            <button
              type="button"
              onClick={attemptStart}
              className="h-11 px-5 rounded-xl bg-blue-600 text-white text-[11px] font-black uppercase tracking-wider active:bg-blue-700 transition-colors"
            >
              Try Again
            </button>
          </div>
        )}
      </div>

      {/* ── Thumbnail strip + actions ── */}
      <div className="flex-shrink-0 bg-black/85 backdrop-blur-sm px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {shots.length > 0 && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2 mb-2">
            <AnimatePresence initial={false}>
              {shots.map((s, i) => (
                <motion.button
                  key={s.id}
                  type="button"
                  onClick={() => setPreviewIndex(i)}
                  initial={framerPresenceMobile.photoThumb.initial}
                  animate={framerPresenceMobile.photoThumb.animate}
                  exit={framerPresenceMobile.photoThumb.exit}
                  transition={framerTransitionMobile.photoThumb}
                  className="relative flex-shrink-0 w-16 h-16 rounded-xl overflow-hidden border-2 border-white/30"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={s.previewUrl}
                    alt={`Shot ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <span className="absolute bottom-0.5 left-0.5 bg-black/60 text-white text-[9px] font-black px-1 py-0.5 rounded">
                    {i + 1}
                  </span>
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          {/* Cancel */}
          <button
            type="button"
            onClick={handleCancel}
            className="h-12 px-4 rounded-2xl bg-white/10 text-white text-[11px] font-bold active:bg-white/20 transition-colors"
          >
            Cancel
          </button>

          {/* Shutter */}
          <button
            type="button"
            onClick={shutter}
            disabled={atCap || !!cameraError || startError}
            aria-label="Capture photo"
            className="h-16 w-16 rounded-full border-4 border-white/80 bg-white/20 active:bg-white/40 transition-colors disabled:opacity-40 disabled:active:bg-white/20 flex items-center justify-center"
          >
            <span className="block h-12 w-12 rounded-full bg-white" />
          </button>

          {/* Done */}
          <button
            type="button"
            onClick={handleDone}
            disabled={shots.length === 0}
            className="h-12 px-4 rounded-2xl bg-emerald-500 text-white text-[11px] font-black uppercase tracking-wider active:bg-emerald-600 transition-colors disabled:opacity-40 disabled:active:bg-emerald-500 flex items-center gap-1.5"
          >
            <Check className="h-4 w-4" />
            Done
          </button>
        </div>
      </div>

      {/* ── Fullscreen preview overlay ── */}
      <AnimatePresence>
        {previewIndex !== null && shots[previewIndex] && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 z-10 bg-black/95 flex items-center justify-center p-4"
            onClick={() => setPreviewIndex(null)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={shots[previewIndex].previewUrl}
              alt={`Preview ${previewIndex + 1}`}
              className="max-w-full max-h-[80vh] rounded-xl object-contain"
            />
            <div className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4 flex gap-3">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeShot(shots[previewIndex].id);
                }}
                className="w-11 h-11 rounded-full bg-red-600 text-white flex items-center justify-center"
                aria-label="Delete photo"
              >
                <Trash2 className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setPreviewIndex(null)}
                className="w-11 h-11 rounded-full bg-white/20 text-white flex items-center justify-center"
                aria-label="Close preview"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
