'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  motion,
  AnimatePresence,
  animate,
  useMotionValue,
  useTransform,
  useReducedMotion,
} from 'framer-motion';
import { Trash2 } from '@/components/Icons';
import { zIndex as zLayer } from '@/design-system/tokens/z-index';
import { framerTransitionMobile } from '@/design-system/foundations/motion-framer';

// Paging commits past this horizontal travel OR on a fast flick.
const SWIPE_THRESHOLD = 64;
const FLICK_VELOCITY = 500; // px/s
// Pulling the photo down past this (or flicking down) dismisses the viewer.
const DISMISS_THRESHOLD = 130;
const DISMISS_FLICK = 700; // px/s
// How far a gesture must travel before we lock it to an axis (vs. a tap).
const AXIS_LOCK = 8;
// Resistance applied past the first/last photo and on an upward (non-dismiss) pull.
const EDGE_RESISTANCE = 0.35;
const UP_RESISTANCE = 0.2;

const EASE_IN = [0.4, 0, 1, 1] as const;

export interface SwipePhotoSlide {
  id: string;
  previewUrl: string;
  deletable?: boolean;
}

export interface MobileSwipePhotoViewerProps {
  slides: SwipePhotoSlide[];
  /** Controlled open state. */
  open: boolean;
  /** Which slide to show first when `open` becomes true. */
  initialIndex?: number;
  onClose: () => void;
  onDelete?: (slide: SwipePhotoSlide, index: number) => void | Promise<void>;
}

type Axis = 'none' | 'x' | 'y';

/**
 * Full-screen swipeable photo viewer.
 *
 * Real finger-following paging: every photo lives side-by-side on a track that
 * tracks the drag and settles with a no-overshoot spring; a fast flick pages
 * even under the distance threshold, and the ends rubber-band. Pull the photo
 * down to dismiss — the scrim fades and the image scales with the pull. Tap
 * toggles the chrome (counter + Dismiss) for edge-to-edge viewing. Photos are
 * shown whole (object-contain) on a near-black field; neighbours preload so a
 * swipe never flashes. Portals to document.body.
 */
export function MobileSwipePhotoViewer({
  slides,
  open,
  initialIndex = 0,
  onClose,
  onDelete,
}: MobileSwipePhotoViewerProps) {
  const reduce = !!useReducedMotion();

  const [mounted, setMounted] = useState(false);
  const [index, setIndex] = useState(initialIndex);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [width, setWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 0,
  );

  // ── MotionValues drive the gesture; React state only mirrors the index ──────
  const trackX = useMotionValue(0);
  const dragY = useMotionValue(0);
  const scrimOpacity = useTransform(dragY, [0, 260], [1, 0]);
  const stageScale = useTransform(dragY, [0, 260], reduce ? [1, 1] : [1, 0.88]);

  // Always-current refs so pointer handlers never read stale state.
  const indexRef = useRef(index);
  indexRef.current = index;
  const widthRef = useRef(width);
  widthRef.current = width;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Gesture bookkeeping.
  const pointer = useRef({
    active: false,
    axis: 'none' as Axis,
    startX: 0,
    startY: 0,
    startTime: 0,
    lastX: 0,
    lastY: 0,
    lastTime: 0,
    velX: 0,
    velY: 0,
  });

  useEffect(() => setMounted(true), []);

  // Jump the track to a slide instantly (open / resize / clamp), or settle to it
  // with the paging spring (user release that changed pages).
  const settleTo = useCallback(
    (idx: number, animated: boolean) => {
      indexRef.current = idx;
      setIndex(idx);
      const base = -idx * widthRef.current;
      if (animated && !reduce) {
        animate(trackX, base, framerTransitionMobile.viewerPaging);
      } else {
        trackX.set(base);
      }
    },
    [reduce, trackX],
  );

  // Keep track width in sync with the viewport.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => {
      setWidth(window.innerWidth);
      trackX.set(-indexRef.current * window.innerWidth);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [trackX]);

  // Reset transient state + position whenever the viewer (re)opens.
  useEffect(() => {
    if (!open) {
      setDeleteArmed(false);
      setDeleting(false);
      return;
    }
    setChromeVisible(true);
    dragY.set(0);
    const clamped =
      slides.length > 0 ? Math.min(Math.max(0, initialIndex), slides.length - 1) : 0;
    settleTo(clamped, false);
  }, [open, initialIndex, slides.length, dragY, settleTo]);

  // Disarm delete when paging.
  useEffect(() => setDeleteArmed(false), [index]);

  // Close when the last photo is removed; clamp a now-out-of-range index.
  useEffect(() => {
    if (open && slides.length === 0) onClose();
  }, [open, slides.length, onClose]);
  useEffect(() => {
    if (slides.length > 0 && indexRef.current > slides.length - 1) {
      settleTo(slides.length - 1, false);
    }
  }, [slides.length, settleTo]);

  // ── Pointer-driven paging + dismiss ─────────────────────────────────────────
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button != null && e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const p = pointer.current;
    p.active = true;
    p.axis = 'none';
    p.startX = p.lastX = e.clientX;
    p.startY = p.lastY = e.clientY;
    p.startTime = p.lastTime = e.timeStamp;
    p.velX = p.velY = 0;
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const p = pointer.current;
      if (!p.active) return;
      const dx = e.clientX - p.startX;
      const dy = e.clientY - p.startY;

      if (p.axis === 'none') {
        if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
        p.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }

      const dt = e.timeStamp - p.lastTime;
      if (dt > 0) {
        p.velX = ((e.clientX - p.lastX) / dt) * 1000;
        p.velY = ((e.clientY - p.lastY) / dt) * 1000;
      }
      p.lastX = e.clientX;
      p.lastY = e.clientY;
      p.lastTime = e.timeStamp;

      if (p.axis === 'x') {
        const w = widthRef.current;
        const base = -indexRef.current * w;
        const minX = -(slides.length - 1) * w;
        const maxX = 0;
        let next = base + dx;
        if (next > maxX) next = maxX + (next - maxX) * EDGE_RESISTANCE;
        else if (next < minX) next = minX + (next - minX) * EDGE_RESISTANCE;
        trackX.set(next);
      } else if (p.axis === 'y') {
        dragY.set(dy > 0 ? dy : dy * UP_RESISTANCE);
      }
    },
    [slides.length, trackX, dragY],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const p = pointer.current;
      if (!p.active) return;
      p.active = false;
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);

      const dx = e.clientX - p.startX;
      const dy = e.clientY - p.startY;

      // Tap (no axis lock, negligible travel) → toggle the chrome.
      if (p.axis === 'none') {
        if (Math.hypot(dx, dy) < AXIS_LOCK) setChromeVisible((v) => !v);
        return;
      }

      if (p.axis === 'x') {
        const cur = indexRef.current;
        const last = slides.length - 1;
        const flick = Math.abs(p.velX) > FLICK_VELOCITY;
        let target = cur;
        if ((dx <= -SWIPE_THRESHOLD || (flick && p.velX < 0)) && cur < last) target = cur + 1;
        else if ((dx >= SWIPE_THRESHOLD || (flick && p.velX > 0)) && cur > 0) target = cur - 1;

        if (target !== cur) settleTo(target, true);
        else if (reduce) trackX.set(-cur * widthRef.current);
        else animate(trackX, -cur * widthRef.current, framerTransitionMobile.viewerPaging);
        return;
      }

      // Vertical: dismiss past the threshold / on a downward flick, else spring back.
      if (dy > DISMISS_THRESHOLD || p.velY > DISMISS_FLICK) {
        if (reduce) {
          closeRef.current();
        } else {
          animate(dragY, window.innerHeight * 0.7, { duration: 0.18, ease: EASE_IN }).then(
            () => closeRef.current(),
          );
        }
      } else if (reduce) {
        dragY.set(0);
      } else {
        animate(dragY, 0, framerTransitionMobile.viewerPaging);
      }
    },
    [slides.length, reduce, settleTo, trackX, dragY],
  );

  const active = slides[index];
  const canDelete = Boolean(active?.deletable && onDelete);

  const handleDeleteClick = useCallback(() => {
    if (!active || !onDelete || deleting) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      window.setTimeout(() => {
        setDeleteArmed((armed) => (armed ? false : armed));
      }, 4000);
      return;
    }
    setDeleting(true);
    void Promise.resolve(onDelete(active, index))
      .then(() => {
        if (slides.length <= 1) onClose();
      })
      .finally(() => {
        setDeleting(false);
        setDeleteArmed(false);
      });
  }, [active, deleteArmed, deleting, index, onClose, onDelete, slides.length]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && active ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: EASE_IN }}
          className="fixed inset-0 select-none"
          style={{ zIndex: zLayer.modal + 1 }}
        >
          {/* Scrim — fades as the photo is pulled down to dismiss. */}
          <motion.div
            className="absolute inset-0 bg-[#0a0a0b]"
            style={{ opacity: scrimOpacity }}
          />

          {/* Stage — vertical dismiss translate + scale (whole view shrinks on pull). */}
          <motion.div
            className="absolute inset-0"
            style={{ y: dragY, scale: stageScale, willChange: 'transform' }}
          >
            {/* Pager — side-by-side track that follows the horizontal drag. */}
            <motion.div
              className="flex h-full"
              style={{ x: trackX, width: `${Math.max(slides.length, 1) * 100}%`, touchAction: 'none', willChange: 'transform' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {slides.map((slide, i) => (
                <div
                  key={slide.id}
                  className="flex h-full w-full shrink-0 items-center justify-center"
                >
                  {/* Only mount the current photo and its immediate neighbours so
                      a swipe reveals an already-decoded image, never a flash. */}
                  {Math.abs(i - index) <= 1 ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={slide.previewUrl}
                      alt={`Photo ${i + 1}`}
                      draggable={false}
                      className="pointer-events-none max-h-full max-w-full object-contain"
                    />
                  ) : null}
                </div>
              ))}
            </motion.div>
          </motion.div>

          {/* Top chrome — counter + delete. Toggles with a tap. */}
          <motion.div
            className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/70 to-transparent"
            animate={{ opacity: chromeVisible ? 1 : 0 }}
            transition={{ duration: 0.15, ease: EASE_IN }}
          >
            <div className="flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-6">
              <span className="text-sm font-black tabular-nums tracking-wider text-white/90">
                {index + 1} / {slides.length}
              </span>
              {canDelete ? (
                <button
                  type="button"
                  onClick={handleDeleteClick}
                  disabled={deleting}
                  aria-label={deleteArmed ? 'Confirm delete photo' : 'Delete photo'}
                  title={deleteArmed ? 'Click again to confirm' : 'Delete photo'}
                  className={`${chromeVisible ? 'pointer-events-auto' : 'pointer-events-none'} ${
                    deleteArmed
                      ? 'flex h-11 items-center gap-2 rounded-full bg-red-600 px-4 text-white transition-colors active:bg-red-700 disabled:opacity-60'
                      : 'flex h-11 w-11 items-center justify-center rounded-full bg-red-600 text-white transition-colors active:bg-red-700 disabled:opacity-60'
                  }`}
                >
                  <Trash2 className="h-5 w-5 shrink-0" />
                  {deleteArmed ? (
                    <span className="text-caption font-black uppercase tracking-wider">
                      {deleting ? 'Deleting…' : 'Confirm'}
                    </span>
                  ) : null}
                </button>
              ) : (
                <span className="w-11" aria-hidden />
              )}
            </div>
          </motion.div>

          {/* Bottom chrome — Dismiss pill (secondary to swipe-down). */}
          <motion.div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center px-6 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            animate={{ opacity: chromeVisible ? 1 : 0 }}
            transition={{ duration: 0.15, ease: EASE_IN }}
          >
            <button
              type="button"
              onClick={onClose}
              className={`${chromeVisible ? 'pointer-events-auto' : 'pointer-events-none'} h-12 rounded-full bg-black/55 px-8 text-caption font-black uppercase tracking-[0.18em] text-white shadow-lg backdrop-blur-md transition-colors active:bg-black/70`}
            >
              Dismiss
            </button>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
