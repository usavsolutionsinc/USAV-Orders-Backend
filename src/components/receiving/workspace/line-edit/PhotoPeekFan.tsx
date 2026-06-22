'use client';

/**
 * PhotoPeekFan — presentational, data-free photo "peek" gesture + Quick Look.
 *
 * A hover-driven, multi-state Motion gesture meant to be layered over a
 * `relative` surface (e.g. the unbox LineEditPanel):
 *
 *   rest      → only the top-left CORNER of the newest photo pokes from the edge
 *   fan       → on hover, the recent photos fan out (staggered spring)
 *   expand    → hold the hover (~holdMs) or click/tap → the fan flies into a
 *               bigger display over a dark-gray backdrop
 *   viewer    → click a fan card (or press Space) → the shared fullscreen
 *               {@link PhotoViewerModal} (zoom/pan, ←/→ nav, filmstrip). This is
 *               the SAME viewer the shipped/packing/receiving galleries use —
 *               there is no separate lightbox to maintain.
 *
 * Pure: give it `cards` (newest first) and it renders. Data/realtime lives in the
 * `ReceivingPhotoPeek` wrapper, so this is demoed + Playwright-tested in isolation
 * at /design-demo/photo-peek.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { motionBezier } from '@/design-system/foundations/motion-framer';
import { useEscapeClose } from '@/design-system/hooks';
import { X } from '@/components/Icons';
import { usePhotoGallery } from '@/components/shipped/photo-gallery/usePhotoGallery';
import { PhotoViewerModal } from '@/components/shipped/photo-gallery/PhotoViewerModal';
import type { PhotoGalleryInput } from '@/components/shipped/PhotoGallery';

export type PeekCard = { id: string; imgUrl: string; alt: string };

const PEEK_COUNT = 4; // cards in the corner/fan
const EXPAND_COUNT = 5; // cards in the expanded display (kept ≤5 so big cards fit the pane)

const FAN_SPRING = { type: 'spring', stiffness: 320, damping: 26 } as const;
const EXPAND_SPRING = { type: 'spring', stiffness: 210, damping: 24 } as const;

// Background set via inline style (not Tailwind) so brand-new arbitrary opacity
// utilities don't silently no-op under the turbopack/JIT regen gotcha.
const FAN_BG = 'rgba(78,78,78,0.95)'; // darker gray for viewing

// Peek geometry (i = 0 is the front/newest card). Rest tucks all but a corner
// past the right edge; fan pulls them in and spreads them into a small arc.
const peekCardVariants: Variants = {
  rest: (i: number) => ({
    x: 64 + i * 7,
    y: i * 3,
    rotate: -5 - i * 2,
    scale: 1 - i * 0.05,
    opacity: i === 0 ? 1 : 0.85 - i * 0.18,
    transition: FAN_SPRING,
  }),
  fan: (i: number) => ({
    x: 12 - i * 12,
    y: -i * 13,
    rotate: -6 - i * 9,
    scale: 1 - i * 0.03,
    opacity: 1,
    transition: FAN_SPRING,
  }),
};

const CTRL_BTN =
  'grid place-items-center rounded-full bg-black/40 text-white backdrop-blur-md transition-colors hover:bg-black/65 disabled:opacity-30';

// ── Peek + fan ────────────────────────────────────────────────────────────────

export function PhotoPeekFan({
  cards,
  holdMs = 480,
  onPhotoDeleted,
}: {
  cards: PeekCard[];
  holdMs?: number;
  /** Wired so the viewer's delete affordance can refresh the source list. */
  onPhotoDeleted?: (photoId: number) => void;
}) {
  const count = cards.length;
  const peekCards = cards.slice(0, PEEK_COUNT);
  // Expanded fan rendered oldest→newest (left→right) so the newest sits top-right.
  const expandCards = cards.slice(0, EXPAND_COUNT).reverse();
  // The viewer shows ALL photos chronologically: first (oldest) on the left,
  // newest on the right — the reverse of the newest-first peek/fan ordering.
  const chronoCards = useMemo(() => [...cards].reverse(), [cards]);
  // Build gallery inputs with numeric ids when available so the viewer's delete
  // affordance shows here too (parity with the top-bar ReceivingPhotoButton).
  // Demo cards use non-numeric ids → those stay read-only.
  const chronoPhotos = useMemo<PhotoGalleryInput[]>(
    () =>
      chronoCards.map((c) => {
        const idNum = Number(c.id);
        return Number.isFinite(idNum) ? { id: idNum, url: c.imgUrl } : { url: c.imgUrl };
      }),
    [chronoCards],
  );

  // Reuse the shared gallery's fullscreen viewer (zoom/pan/nav/filmstrip + delete)
  // instead of a bespoke lightbox.
  const gallery = usePhotoGallery({ photos: chronoPhotos, showCopyLinks: false, onPhotoDeleted });
  const { viewerOpen, openViewer } = gallery;

  const [peekState, setPeekState] = useState<'rest' | 'fan'>('rest');
  const [expanded, setExpanded] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Measure the pane so the fan spreads to fill the room — tight in a narrow
  // pane, panned out when there's space — instead of a fixed overlap.
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageW, setStageW] = useState(0);
  useLayoutEffect(() => {
    if (!expanded) return;
    const measure = () => setStageW(stageRef.current?.clientWidth ?? 0);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (stageRef.current) ro?.observe(stageRef.current);
    return () => ro?.disconnect();
  }, [expanded]);

  // Escape on the bare fan (no viewer) fully closes back to the resting peek.
  // The viewer owns Esc while it's open (usePhotoGallery), returning to the fan.
  useEscapeClose(expanded && !viewerOpen, () => {
    setExpanded(false);
    setPeekState('rest');
  });

  // Space opens the newest photo in the viewer while the fan is up.
  useEffect(() => {
    if (!expanded || viewerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        openViewer(chronoCards.length - 1); // newest is right-most
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded, viewerOpen, openViewer, chronoCards.length]);

  // Dismissing the viewer (Esc / X / backdrop) collapses the whole peek too —
  // one dismiss closes BOTH the photo viewer and the expanded fan behind it.
  const prevViewerOpenRef = useRef(false);
  useEffect(() => {
    if (prevViewerOpenRef.current && !viewerOpen) {
      setExpanded(false);
      setPeekState('rest');
    }
    prevViewerOpenRef.current = viewerOpen;
  }, [viewerOpen]);

  const clearHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };
  const onPeekEnter = () => {
    setPeekState('fan');
    clearHold();
    holdTimer.current = setTimeout(() => setExpanded(true), holdMs);
  };
  const onPeekLeave = () => {
    setPeekState('rest');
    clearHold();
  };
  const openNow = () => {
    clearHold();
    setExpanded(true);
  };
  const close = () => {
    setExpanded(false);
    setPeekState('rest');
  };

  useEffect(() => () => clearHold(), []);

  if (count === 0) return null;

  return (
    <>
      {/* Peek — corner → fan, anchored toward the lower-right of the pane.
          Hidden while expanded (no edge peek when the display is open). */}
      {!expanded ? (
        <div className="pointer-events-none absolute inset-y-0 right-0 z-20 flex items-end">
          <motion.div
            data-testid="photo-peek"
            className="pointer-events-auto relative mb-[calc(22%+4rem)] h-36 w-28"
            initial="rest"
            animate={peekState}
            variants={{ rest: {}, fan: { transition: { staggerChildren: 0.04 } } }}
            onHoverStart={onPeekEnter}
            onHoverEnd={onPeekLeave}
            onClick={openNow}
            role="button"
            tabIndex={0}
            aria-label={`View ${count} carton photo${count === 1 ? '' : 's'} — hover to fan, hold to expand`}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openNow();
              }
            }}
          >
            {peekCards.map((card, i) => (
              <motion.div
                key={card.id}
                custom={i}
                variants={peekCardVariants}
                style={{ zIndex: PEEK_COUNT - i }}
                className="absolute inset-0 origin-top-left overflow-hidden rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.22)] ring-1 ring-black/10 will-change-transform"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={card.imgUrl} alt={card.alt} loading="lazy" className="h-full w-full object-cover" />
                {/* Count badge rides the FRONT card's visible corner. */}
                {i === 0 && count > 1 ? (
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-black leading-none text-white tabular-nums backdrop-blur-sm">
                    ×{count}
                  </span>
                ) : null}
              </motion.div>
            ))}
          </motion.div>
        </div>
      ) : null}

      {/* Expanded display — fan over a dark-gray backdrop. Click backdrop /
          press Escape / hit × to close. Click a card → fullscreen viewer. */}
      <AnimatePresence>
        {expanded ? (
          <motion.div
            key="photo-fan-expanded"
            data-testid="photo-peek-expanded"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: motionBezier.easeOut }}
            onClick={close}
            style={{ backgroundColor: FAN_BG }}
            className="absolute inset-0 z-30 flex items-center justify-center overflow-hidden backdrop-blur-sm"
          >
            {/* Fan's own close — hidden while the fullscreen viewer is open so
                its button doesn't stack a second X above the viewer. */}
            {!viewerOpen ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); close(); }}
                aria-label="Close"
                className={`${CTRL_BTN} absolute right-3 top-3 z-50 h-9 w-9`}
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}

            {/* Fan stage — `isolate` contains card stacking in its own context
                so a mid-hover card can never bleed above the viewer;
                pointer-events off while the viewer is up. */}
            <div
              ref={stageRef}
              className={`relative -mt-20 h-72 w-full isolate ${viewerOpen ? 'pointer-events-none' : ''}`}
              onClick={(e) => e.stopPropagation()}
            >
              {expandCards.map((card, i) => {
                const n = expandCards.length;
                const center = (n - 1) / 2;
                const d = i - center; // signed distance from centre
                // Spread to fill ~72% of the pane (leaving margins), clamped so a
                // narrow pane stays readable and a wide one doesn't fly apart.
                const CARD_W = 192; // w-48
                const room = (stageW || 600) * 0.72;
                const outerHalf = Math.max(70, (room - CARD_W) / 2);
                const spacing = n > 1 ? Math.min(150, Math.max(60, outerHalf / center)) : 0;
                const tx = d * spacing;
                const ty = Math.abs(d) * 8; // gentle downward arc
                const rotZ = d * 9;
                return (
                  <motion.div
                    key={card.id}
                    data-testid="fan-card"
                    initial={{ x: 230, y: 60, rotate: 20, scale: 0.45, opacity: 0 }}
                    animate={{ x: tx, y: ty, rotate: rotZ, scale: 1, opacity: 1 }}
                    exit={{ x: 230, y: 60, rotate: 20, scale: 0.45, opacity: 0 }}
                    transition={{ ...EXPAND_SPRING, delay: Math.abs(d) * 0.05 }}
                    style={{ zIndex: 20 + (n - Math.abs(d)) }}
                    whileHover={{ y: ty - 18, scale: 1.05, zIndex: 49 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      openViewer(chronoCards.findIndex((c) => c.id === card.id));
                    }}
                    className="absolute left-1/2 top-1/2 -ml-24 -mt-32 h-64 w-48 origin-bottom cursor-zoom-in overflow-hidden rounded-2xl shadow-[0_18px_45px_rgba(0,0,0,0.28)] ring-1 ring-black/10 will-change-transform"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={card.imgUrl} alt={card.alt} loading="lazy" className="h-full w-full object-cover" />
                  </motion.div>
                );
              })}
            </div>

          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Shared fullscreen viewer — portaled to <body>, opened from a fan card
          or Space. X / Esc / backdrop close it (usePhotoGallery), returning to
          the fan underneath. */}
      {gallery.mounted && typeof document !== 'undefined'
        ? createPortal(
            <AnimatePresence mode="wait">
              {viewerOpen ? <PhotoViewerModal g={gallery} /> : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </>
  );
}

export default PhotoPeekFan;
