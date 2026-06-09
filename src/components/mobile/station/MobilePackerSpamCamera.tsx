'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import {
  framerPresenceMobile,
  framerTransitionMobile,
} from '@/design-system/foundations/motion-framer';
import { Camera, X, Check, Trash2 } from '@/components/Icons';
import { useCamera } from '@/hooks/useCamera';
import { compressPhotoForUpload } from '@/lib/image/compress-for-upload';

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

// Horizontal drag distance (px) past which a swipe pages to the next/prev shot.
// The image itself does NOT animate between frames (no slide/cross-fade) — the
// swipe just snaps back and the index changes, so paging feels instant.
const SWIPE_THRESHOLD = 70;

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * MobilePackerSpamCamera — fullscreen rapid-capture camera.
 *
 * Behaviour:
 *  • Reuses `useCamera()` (which owns getUserMedia + stop lifecycle).
 *  • Full-bleed viewfinder; controls float over a scrim so framing is WYSIWYG.
 *  • Capture is cropped to the on-screen viewfinder aspect ratio, so the stored
 *    blob and the gallery preview match exactly what was framed (no
 *    object-cover-vs-object-contain size mismatch between capture and review).
 *  • Each shot is canvased, `toBlob`d as JPEG, then routed through
 *    `compressPhotoForUpload` so the stored blob matches the server's input.
 *  • Photos accumulate locally — NO network calls. The last shot surfaces as a
 *    circular gallery button (bottom-left); tapping opens a swipeable review
 *    overlay with per-photo delete.
 *  • On Done, ownership of the blobs transfers to the parent (object URLs are
 *    NOT revoked here). On unmount without Done, all object URLs are revoked.
 */
export function MobilePackerSpamCamera({
  onDone,
  onCancel,
  maxPhotos = 5,
  jpegQuality = 0.85,
  header,
}: MobilePackerSpamCameraProps) {
  const { videoRef, startCamera, stopCamera, cameraError } = useCamera();
  const viewfinderRef = useRef<HTMLDivElement>(null);
  const [shots, setShots] = useState<CapturedShot[]>([]);
  const [flash, setFlash] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [startError, setStartError] = useState(false);

  // Track whether the parent took ownership — if so, skip revoke-on-unmount.
  const handedOffRef = useRef(false);
  // Always-current shots reference for unmount cleanup + paging bounds.
  const shotsRef = useRef<CapturedShot[]>([]);
  shotsRef.current = shots;

  // ── Camera start with resolution fallback ────────────────────────────────
  const attemptStart = useCallback(async () => {
    setStartError(false);
    const chain: Array<{ width?: { ideal: number }; height?: { ideal: number } }> = [
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

    // Crop the source frame to the on-screen viewfinder aspect ratio so the
    // saved photo equals exactly what the operator framed (the live view is
    // object-cover, so without this crop the gallery would reveal the
    // letterboxed edges the viewfinder hid).
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const box = viewfinderRef.current?.getBoundingClientRect();
    const displayAspect = box && box.height > 0 ? box.width / box.height : vw / vh;
    const videoAspect = vw / vh;

    let sx = 0;
    let sy = 0;
    let sWidth = vw;
    let sHeight = vh;
    if (videoAspect > displayAspect) {
      // Source is wider than the viewfinder → crop the left/right.
      sWidth = Math.round(vh * displayAspect);
      sx = Math.round((vw - sWidth) / 2);
    } else {
      // Source is taller than the viewfinder → crop the top/bottom.
      sHeight = Math.round(vw / displayAspect);
      sy = Math.round((vh - sHeight) / 2);
    }

    const canvas = document.createElement('canvas');
    canvas.width = sWidth;
    canvas.height = sHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);

    const rawBlob = await new Promise<Blob | null>((res) =>
      canvas.toBlob((b) => res(b), 'image/jpeg', jpegQuality),
    );
    if (!rawBlob) return;

    const compressed = await compressPhotoForUpload(rawBlob, { source: 'packer-spam' });
    const blob = compressed.blob;
    const previewUrl = URL.createObjectURL(blob);
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    setShots((prev) => [...prev, { id, blob, previewUrl }]);
    setFlash(true);
    setTimeout(() => setFlash(false), 160);
  }, [shots.length, maxPhotos, jpegQuality, videoRef]);

  // ── Gallery paging ────────────────────────────────────────────────────────
  const openGallery = useCallback(() => {
    if (shotsRef.current.length === 0) return;
    setPreviewIndex(shotsRef.current.length - 1);
  }, []);

  const paginate = useCallback((step: number) => {
    setPreviewIndex((idx) => {
      if (idx === null) return idx;
      const next = idx + step;
      if (next < 0 || next >= shotsRef.current.length) return idx;
      return next;
    });
  }, []);

  const handleDragEnd = useCallback(
    (_e: unknown, info: PanInfo) => {
      if (info.offset.x < -SWIPE_THRESHOLD) paginate(1);
      else if (info.offset.x > SWIPE_THRESHOLD) paginate(-1);
    },
    [paginate],
  );

  // ── Remove a shot (from the gallery) ──────────────────────────────────────
  const removeShot = useCallback((id: string) => {
    setShots((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      const next = prev.filter((s) => s.id !== id);
      setPreviewIndex((idx) => {
        if (idx === null || next.length === 0) return null;
        return Math.min(idx, next.length - 1);
      });
      return next;
    });
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

  // Dev-only escape hatch: localhost Safari blocks getUserMedia, so there's
  // no way to exercise the post-capture upload flow. Synthesizes a 1280x720
  // placeholder JPEG and hands it to the parent as if it were a real shot.
  const handleUseTestPhoto = useCallback(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 48px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TEST PHOTO', canvas.width / 2, canvas.height / 2 - 24);
    ctx.font = '24px system-ui, -apple-system, sans-serif';
    ctx.fillText(new Date().toLocaleString(), canvas.width / 2, canvas.height / 2 + 32);

    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob((b) => res(b), 'image/jpeg', jpegQuality),
    );
    if (!blob) return;

    const previewUrl = URL.createObjectURL(blob);
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    handedOffRef.current = true;
    onDone([{ id, blob, previewUrl }]);
  }, [jpegQuality, onDone]);

  // Only surface the test-photo escape hatch in dev builds so it never reaches
  // production. `NODE_ENV` is statically replaced at build time, so the button
  // (and its handler) tree-shake out of the prod bundle.
  const showTestPhotoButton = process.env.NODE_ENV !== 'production';

  const remaining = maxPhotos - shots.length;
  const atCap = remaining <= 0;
  const lastShot = shots[shots.length - 1];
  const cameraLive = !startError && !cameraError;

  // Portal to <body> so the fullscreen camera escapes the mobile shell's
  // animated (transformed) page wrapper. A transformed ancestor becomes the
  // containing block for this `fixed inset-0` overlay, which would otherwise
  // clip it to the content area and let the bottom nav show through.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const activeShot = previewIndex !== null ? shots[previewIndex] : undefined;

  const cameraUi = (
    <motion.div
      initial={framerPresenceMobile.camera.initial}
      animate={framerPresenceMobile.camera.animate}
      exit={framerPresenceMobile.camera.exit}
      transition={framerTransitionMobile.cameraEnter}
      className="fixed inset-0 z-[200] overflow-hidden bg-black select-none"
    >
      {/* ── Full-bleed viewfinder ── */}
      <div ref={viewfinderRef} className="absolute inset-0">
        {cameraLive ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <div className="h-16 w-16 rounded-full bg-white/10 flex items-center justify-center mb-4">
              <Camera className="h-8 w-8 text-white/50" />
            </div>
            <p className="text-sm font-bold text-white mb-1">Camera unavailable</p>
            <p className="text-xs text-white/50 mb-4 max-w-xs">
              {cameraError === 'permission-denied'
                ? 'Enable camera access in your browser settings, then tap Try Again.'
                : 'No camera detected, or the browser blocked access.'}
            </p>
            <button
              type="button"
              onClick={attemptStart}
              className="h-11 px-5 rounded-xl bg-blue-600 text-white text-caption font-black uppercase tracking-wider active:bg-blue-700 transition-colors"
            >
              Try Again
            </button>

            {showTestPhotoButton && (
              <button
                type="button"
                onClick={handleUseTestPhoto}
                className="mt-3 h-11 px-5 rounded-xl bg-amber-500 text-black text-caption font-black uppercase tracking-wider active:bg-amber-600 transition-colors"
              >
                Use Test Photo · Dev
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Black shutter snap ── */}
      <AnimatePresence>
        {flash && (
          <motion.div
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="absolute inset-0 z-20 bg-black pointer-events-none"
          />
        )}
      </AnimatePresence>

      {/* ── Top scrim: header (left) + close (right) ── */}
      <div className="absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/70 to-transparent">
        <div className="flex items-start justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-6">
          <div className="flex-1 min-w-0">
            {header ?? (
              <>
                <p className="text-micro font-black uppercase tracking-[0.22em] text-white/60">
                  Add photos
                </p>
                <p className="text-sm font-black text-white">
                  {shots.length}/{maxPhotos}
                </p>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={handleCancel}
            aria-label="Close camera"
            className="h-11 w-11 flex-shrink-0 flex items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm active:bg-black/60 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* ── Cap reached banner ── */}
      {atCap && cameraLive && (
        <div className="absolute top-[max(4.5rem,calc(env(safe-area-inset-top)+3.5rem))] left-1/2 z-10 -translate-x-1/2 px-3 py-1.5 rounded-full bg-amber-500/95 text-xs font-black uppercase tracking-wider text-white shadow-lg">
          Max {maxPhotos} photos
        </div>
      )}

      {/* ── Floating controls: gallery · shutter · done hovering over the
          viewfinder (no bar). The wrapper itself ignores pointer events so the
          gaps between controls stay tappable as live viewfinder. ── */}
      <div className="absolute inset-x-0 bottom-0 z-10 pointer-events-none">
        <div className="grid grid-cols-3 items-center px-6 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] [&_button]:pointer-events-auto">
          {/* Gallery — small circular last-shot bubble. Filled with the photo
              (no white ring) and smaller than the shutter, so it reads as a
              thumbnail rather than a second shutter. Hidden until the first shot. */}
          <div className="flex justify-start">
            <button
              type="button"
              onClick={openGallery}
              disabled={shots.length === 0}
              aria-label="View captured photos"
              className="relative h-12 w-12 rounded-full overflow-hidden ring-2 ring-white/40 bg-black/40 shadow-lg active:scale-95 transition-transform disabled:opacity-0 disabled:pointer-events-none"
            >
              {lastShot && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={lastShot.previewUrl}
                  alt="Last photo"
                  className="w-full h-full object-cover"
                />
              )}
            </button>
          </div>

          {/* Shutter */}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={shutter}
              disabled={atCap || !cameraLive}
              aria-label="Capture photo"
              className="h-[72px] w-[72px] rounded-full border-4 border-white bg-transparent active:scale-95 transition-transform disabled:opacity-40 disabled:active:scale-100 flex items-center justify-center"
            >
              <span className="block h-14 w-14 rounded-full bg-white active:bg-white/80 transition-colors" />
            </button>
          </div>

          {/* Done — checkmark only */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleDone}
              disabled={shots.length === 0}
              aria-label="Done"
              className="h-14 w-14 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-lg active:bg-emerald-600 active:scale-95 transition-all disabled:opacity-40 disabled:active:scale-100 disabled:active:bg-emerald-500"
            >
              <Check className="h-7 w-7" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Swipeable gallery overlay — full-bleed so the preview frames the shot
          at the EXACT dimensions the viewfinder did (object-cover, same crop).
          The 1/1 counter + delete float over the photo; there's no X — a
          floating Dismiss pill (no bottom bar) is the single close affordance. ── */}
      <AnimatePresence>
        {activeShot && previewIndex !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            // Exit instantly (no fade): the overlay sits at z-30 over the
            // shutter, so a lingering fade-out would swallow the first shutter
            // tap after Dismiss. Unmounting at once keeps the camera live.
            exit={{ opacity: 0, transition: { duration: 0 } }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 z-30 bg-black"
          >
            {/* Full-bleed photo. Swipe pages between shots with NO frame
                transition (the drag snaps back, the image swaps instantly). */}
            <motion.div
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragSnapToOrigin
              dragElastic={0.35}
              onDragEnd={handleDragEnd}
              className="absolute inset-0"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={activeShot.previewUrl}
                alt={`Photo ${previewIndex + 1}`}
                draggable={false}
                className="w-full h-full object-cover pointer-events-none"
              />
            </motion.div>

            {/* No prev/next arrows — swipe pages between shots, and the N / M
                counter (top-left) shows position. */}

            {/* Top scrim: 1/1 counter (left) + delete (right), over the photo. */}
            <div className="absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/70 to-transparent">
              <div className="flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-6">
                <span className="text-sm font-black tracking-wider text-white/90 tabular-nums">
                  {previewIndex + 1} / {shots.length}
                </span>
                <button
                  type="button"
                  onClick={() => removeShot(activeShot.id)}
                  aria-label="Delete photo"
                  className="w-11 h-11 rounded-full bg-red-600 text-white flex items-center justify-center active:bg-red-700 transition-colors"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Floating Dismiss — no bottom bar; the pill floats over the photo. */}
            <div className="absolute inset-x-0 bottom-0 z-10 flex justify-center px-6 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pointer-events-none">
              <button
                type="button"
                onClick={() => setPreviewIndex(null)}
                className="pointer-events-auto h-12 px-8 rounded-full bg-black/55 text-white text-caption font-black uppercase tracking-[0.18em] backdrop-blur-md shadow-lg active:bg-black/70 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );

  return mounted ? createPortal(cameraUi, document.body) : null;
}
