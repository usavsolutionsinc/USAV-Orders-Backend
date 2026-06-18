'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import { Trash2 } from '@/components/Icons';
import { zIndex as zLayer } from '@/design-system/tokens/z-index';

const SWIPE_THRESHOLD = 70;

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

/**
 * Full-screen swipeable photo viewer — extracted from {@link MobilePackerSpamCamera}.
 * One photo at a time, swipe left/right to page, delete (optional) top-right,
 * Dismiss pill bottom-center. Portals to document.body.
 */
export function MobileSwipePhotoViewer({
  slides,
  open,
  initialIndex = 0,
  onClose,
  onDelete,
}: MobileSwipePhotoViewerProps) {
  const [mounted, setMounted] = useState(false);
  const [index, setIndex] = useState(initialIndex);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) {
      setDeleteArmed(false);
      setDeleting(false);
    }
  }, [open]);

  useEffect(() => {
    setDeleteArmed(false);
  }, [index]);

  useEffect(() => {
    if (!open) return;
    const clamped = slides.length > 0 ? Math.min(Math.max(0, initialIndex), slides.length - 1) : 0;
    setIndex(clamped);
  }, [open, initialIndex, slides.length]);

  useEffect(() => {
    if (open && slides.length === 0) onClose();
  }, [open, slides.length, onClose]);

  useEffect(() => {
    setIndex((current) => {
      if (slides.length === 0) return 0;
      return Math.min(current, slides.length - 1);
    });
  }, [slides.length]);

  const paginate = useCallback(
    (step: number) => {
      setIndex((current) => {
        const next = current + step;
        if (next < 0 || next >= slides.length) return current;
        return next;
      });
    },
    [slides.length],
  );

  const handleDragEnd = useCallback(
    (_e: unknown, info: PanInfo) => {
      if (info.offset.x < -SWIPE_THRESHOLD) paginate(1);
      else if (info.offset.x > SWIPE_THRESHOLD) paginate(-1);
    },
    [paginate],
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
          exit={{ opacity: 0, transition: { duration: 0 } }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 bg-black select-none"
          style={{ zIndex: zLayer.modal + 1 }}
        >
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
              src={active.previewUrl}
              alt={`Photo ${index + 1}`}
              draggable={false}
              className="pointer-events-none h-full w-full object-cover"
            />
          </motion.div>

          <div className="absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/70 to-transparent">
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
                  className={
                    deleteArmed
                      ? 'flex h-11 items-center gap-2 rounded-full bg-red-600 px-4 text-white transition-colors active:bg-red-700 disabled:opacity-60'
                      : 'flex h-11 w-11 items-center justify-center rounded-full bg-red-600 text-white transition-colors active:bg-red-700 disabled:opacity-60'
                  }
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
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center px-6 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={onClose}
              className="pointer-events-auto h-12 rounded-full bg-black/55 px-8 text-caption font-black uppercase tracking-[0.18em] text-white shadow-lg backdrop-blur-md transition-colors active:bg-black/70"
            >
              Dismiss
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
