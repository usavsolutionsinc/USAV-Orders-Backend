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
import { Trash2, ChevronDown } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { zIndex as zLayer } from '@/design-system/tokens/z-index';
import {
  framerPresenceMobile,
  framerTransitionMobile,
  motionBezier,
} from '@/design-system/foundations/motion-framer';

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

const GAP = 0; // Full-bleed paging — no visible gap between slides
const EASE_IN = [0.4, 0, 1, 1] as const;

/** Shared frosted pill for viewer chrome controls. */
const GLASS_CHROME =
  'rounded-full bg-scrim/45 border border-glass/10 shadow-lg backdrop-blur-md transition-all active:scale-95';

export interface SwipePhotoSlide {
  id: string;
  previewUrl: string;
  deletable?: boolean;
}

export type ViewerPresentation = 'overlay' | 'sheet';

export interface MobileSwipePhotoViewerProps {
  slides: SwipePhotoSlide[];
  /** Controlled open state. */
  open: boolean;
  /** Which slide to show first when `open` becomes true. */
  initialIndex?: number;
  /**
   * `overlay` — scale/fade enter (camera bubble, in-sheet preview).
   * `sheet` — slide up from the bottom; swipe-down dismiss mirrors enter.
   */
  presentation?: ViewerPresentation;
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
 * toggles the chrome (counter + dismiss affordance) for edge-to-edge viewing.
 * `presentation="sheet"` slides up from the bottom on enter (gallery route);
 * `presentation="overlay"` (default) fades + scales in (camera / in-sheet preview).
 * Photos are shown whole (object-contain) on a near-black field; neighbours
 * preload so a swipe never flashes. Portals to document.body.
 */
export function MobileSwipePhotoViewer({
  slides,
  open,
  initialIndex = 0,
  presentation = 'overlay',
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
  const scrimOpacity = useTransform(dragY, [0, 380], [1, 0], { clamp: true });
  const stageScale = useTransform(dragY, [0, 380], [1, 0.92], { clamp: true });

  // Always-current refs so pointer handlers never read stale state.
  const indexRef = useRef(index);
  indexRef.current = index;
  const widthRef = useRef(width);
  widthRef.current = width;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const dismissingRef = useRef(false);
  const wasOpenRef = useRef(false);
  const presentationRef = useRef(presentation);
  presentationRef.current = presentation;

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

  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined') {
      setWidth(window.innerWidth);
    }
  }, []);

  // Jump the track to a slide instantly (open / resize / clamp), or settle to it
  // with the paging spring (user release that changed pages).
  const settleTo = useCallback(
    (idx: number, animated: boolean, velocity = 0) => {
      indexRef.current = idx;
      setIndex(idx);
      const base = -idx * (widthRef.current + GAP);
      if (animated && !reduce) {
        animate(trackX, base, {
          ...framerTransitionMobile.viewerPaging,
          velocity,
        });
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
      trackX.set(-indexRef.current * (window.innerWidth + GAP));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [trackX]);

  // Reset transient state + position whenever the viewer (re)opens.
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      setDeleteArmed(false);
      setDeleting(false);
      dismissingRef.current = false;
      return;
    }

    const isOpening = !wasOpenRef.current;
    wasOpenRef.current = true;

    setChromeVisible(true);
    const clamped =
      slides.length > 0 ? Math.min(Math.max(0, initialIndex), slides.length - 1) : 0;
    settleTo(clamped, false);

    if (!isOpening) return;

    if (presentationRef.current === 'sheet' && !reduce && typeof window !== 'undefined') {
      dragY.set(window.innerHeight);
      void animate(dragY, 0, framerTransitionMobile.sheetSlide);
    } else {
      dragY.set(0);
    }
  }, [open, initialIndex, slides.length, dragY, settleTo, reduce]);

  // Disarm delete when paging.
  useEffect(() => setDeleteArmed(false), [index]);

  // Warm the HTTP + decode cache for the active photo and its neighbours so a
  // settle never lands on an undecoded image — that late paint is the flash you
  // see "select" the photo on finger-release. Decoding the same URL primes the
  // browser cache the in-DOM <img> then reads from, so the swipe lands painted.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const NEIGHBOURS = 2;
    for (let i = index - NEIGHBOURS; i <= index + NEIGHBOURS; i += 1) {
      const slide = slides[i];
      if (!slide) continue;
      const img = new window.Image();
      img.decoding = 'async';
      img.src = slide.previewUrl;
      void img.decode?.().catch(() => {});
    }
  }, [index, slides]);

  // Close when the last photo is removed; clamp a now-out-of-range index.
  useEffect(() => {
    if (open && slides.length === 0) onClose();
  }, [open, slides.length, onClose]);
  useEffect(() => {
    if (slides.length > 0 && indexRef.current > slides.length - 1) {
      settleTo(slides.length - 1, false);
    }
  }, [slides.length, settleTo]);

  const dismissViewer = useCallback((velocity = 0) => {
    if (dismissingRef.current) return;
    dismissingRef.current = true;
    if (reduce) {
      closeRef.current();
      return;
    }
    const targetY = window.innerHeight;
    
    // Spring feels much more natural if inheriting finger swipe velocity,
    // otherwise use a clean, standard ease-out transition.
    const transition = Math.abs(velocity) > 100
      ? {
          type: 'spring' as const,
          stiffness: 320,
          damping: 38,
          mass: 0.8,
          velocity,
        }
      : {
          duration: 0.22,
          ease: EASE_IN,
        };

    void animate(dragY, targetY, transition).then(() => {
      closeRef.current();
    });
  }, [reduce, dragY]);

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
        const w = widthRef.current + GAP;
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

        const w = widthRef.current + GAP;
        if (target !== cur) {
          settleTo(target, true, p.velX);
        } else if (reduce) {
          trackX.set(-cur * w);
        } else {
          animate(trackX, -cur * w, {
            ...framerTransitionMobile.viewerPaging,
            velocity: p.velX,
          });
        }
        return;
      }

      // Vertical: dismiss past the threshold / on a downward flick, else spring back.
      if (dy > DISMISS_THRESHOLD || p.velY > DISMISS_FLICK) {
        dismissViewer(p.velY);
      } else if (reduce) {
        dragY.set(0);
      } else {
        animate(dragY, 0, {
          ...framerTransitionMobile.viewerPaging,
          velocity: p.velY,
        });
      }
    },
    [slides.length, reduce, settleTo, trackX, dragY, dismissViewer],
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
        if (slides.length <= 1) dismissViewer();
      })
      .finally(() => {
        setDeleting(false);
        setDeleteArmed(false);
      });
  }, [active, deleteArmed, deleting, index, dismissViewer, onDelete, slides.length]);

  const isSheet = presentation === 'sheet';
  const rootPresence = isSheet ? null : framerPresenceMobile.camera;

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && active ? (
        <motion.div
          initial={rootPresence?.initial ?? false}
          animate={rootPresence?.animate ?? undefined}
          exit={rootPresence?.exit}
          transition={isSheet ? undefined : framerTransitionMobile.cameraEnter}
          className="fixed inset-0 select-none overflow-hidden"
          style={{ zIndex: zLayer.modal + 1 }}
          data-testid="mobile-swipe-photo-viewer"
          data-presentation={presentation}
        >
          {/* Scrim — fades as the photo is pulled down to dismiss. */}
          <motion.div
            className="absolute inset-0 bg-[#0a0a0b]"
            style={{ opacity: scrimOpacity }}
          />

          {/* Stage — vertical dismiss translate. */}
          <motion.div
            className="absolute inset-0"
            style={{ y: dragY, scale: stageScale, willChange: 'transform' }}
          >
            {/* Pager — side-by-side track that follows the horizontal drag. */}
            <motion.div
              className="flex h-full"
              style={{ x: trackX, touchAction: 'none', willChange: 'transform' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {slides.map((slide, i) => (
                <div
                  key={slide.id}
                  className="flex h-[100dvh] w-[100vw] shrink-0 items-center justify-center"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={slide.previewUrl}
                    alt={`Photo ${i + 1}`}
                    draggable={false}
                    loading="eager"
                    decoding="async"
                    fetchPriority={Math.abs(i - index) <= 1 ? 'high' : 'low'}
                    className="pointer-events-none max-h-full max-w-full object-contain"
                  />
                </div>
              ))}
            </motion.div>
          </motion.div>

          {/* Top chrome — floating counter + delete (no gradient bar). */}
          <motion.div
            className="pointer-events-none absolute inset-x-0 top-0 z-10"
            animate={{ opacity: chromeVisible ? 1 : 0, y: chromeVisible ? 0 : -8 }}
            transition={{ duration: 0.2, ease: motionBezier.easeOut }}
          >
            <div className="flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
              <span
                className={`${GLASS_CHROME} flex h-11 items-center justify-center px-3 text-sm font-black tabular-nums tracking-wider text-white`}
              >
                {index + 1} / {slides.length}
              </span>
              {canDelete ? (
                <HoverTooltip label={deleteArmed ? 'Click again to confirm' : 'Delete photo'} asChild>
                  <button
                    type="button"
                    onClick={handleDeleteClick}
                    disabled={deleting}
                    aria-label={deleteArmed ? 'Confirm delete photo' : 'Delete photo'}
                    className={`ds-raw-button ${chromeVisible ? 'pointer-events-auto' : 'pointer-events-none'} ${
                      deleteArmed
                        ? 'flex h-11 items-center gap-2 rounded-full bg-red-600/95 px-4 text-white shadow-lg backdrop-blur-md transition-transform active:scale-95 disabled:opacity-60'
                        : `flex h-11 w-11 items-center justify-center text-white disabled:opacity-60 ${GLASS_CHROME}`
                    }`}
                  >
                    <Trash2
                      className={`h-5 w-5 shrink-0 ${deleteArmed ? 'text-white' : 'text-red-500'}`}
                    />
                    {deleteArmed ? (
                      <span className="text-caption font-black uppercase tracking-wider">
                        {deleting ? 'Deleting…' : 'Confirm'}
                      </span>
                    ) : null}
                  </button>
                </HoverTooltip>
              ) : (
                <span className="w-11" aria-hidden />
              )}
            </div>
          </motion.div>

          {/* Bottom chrome — down-arrow dismiss (secondary to swipe-down). */}
          <motion.div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            animate={{ opacity: chromeVisible ? 1 : 0, y: chromeVisible ? 0 : 12 }}
            transition={{ duration: 0.2, ease: motionBezier.easeOut }}
          >
            <IconButton
              type="button"
              onClick={() => dismissViewer(0)}
              ariaLabel="Dismiss"
              className={`${chromeVisible ? 'pointer-events-auto' : 'pointer-events-none'} flex h-11 w-11 items-center justify-center text-white ${GLASS_CHROME}`}
              icon={
                <motion.span
                  aria-hidden
                  animate={reduce || !chromeVisible ? { y: 0 } : { y: [0, 4, 0] }}
                  transition={
                    reduce
                      ? { duration: 0 }
                      : { duration: 1.6, repeat: Infinity, ease: motionBezier.easeOut }
                  }
                  className="flex items-center justify-center"
                >
                  <ChevronDown className="h-6 w-6" />
                </motion.span>
              }
            />
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
