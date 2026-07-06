'use client';

/**
 * RightRailHost — the ONE owner of the right-edge slot.
 *
 * Renders exactly the top occupant inside an inset rounded overlay card
 * (`DetailStackFrame` layout tokens) with a viewport backdrop, one
 * `AnimatePresence mode="wait"` crossfade keyed on occupant id, and
 * scale+opacity enter/exit (`framerPresence.detailStackOverlay`).
 *
 * Desktop-first; the inset card is also shown on narrow viewports (width
 * clamps to viewport minus inset).
 */

import { useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  framerDuration,
  framerPresence,
  framerTransition,
  motionBezier,
} from '@/design-system/foundations/motion-framer';
import { useMotionPresence, useMotionTransition } from '@/design-system/foundations/motion-framer-hooks';
import { useBodyScrollLock, useEscapeClose } from '@/design-system/hooks';
import {
  assistantDockAsideClassName,
  assistantDockAsideStyle,
  detailStackAsideClassName,
  detailStackAsideStyle,
} from '@/components/right-rail/DetailStackFrame';
import {
  getRightRailTop,
  getServerRightRailTop,
  subscribeRightRail,
} from '@/lib/right-rail/store';

const BACKDROP_FADE = {
  duration: framerDuration.detailStackOverlayMount * 0.75,
  ease: motionBezier.easeOut,
} as const;

export function RightRailHost() {
  const top = useSyncExternalStore(subscribeRightRail, getRightRailTop, getServerRightRailTop);
  const presence = useMotionPresence(framerPresence.detailStackOverlay);
  const transition = useMotionTransition(framerTransition.detailStackOverlayMount);

  const renderable = top && top.node != null ? top : null;
  const isAssistantDock = renderable?.id === 'assistant';

  useBodyScrollLock(!!renderable && !isAssistantDock);
  useEscapeClose(!!renderable?.onClose, renderable?.onClose ?? (() => {}));

  return (
    <>
      <AnimatePresence initial={false}>
        {renderable?.onClose && !isAssistantDock ? (
          <motion.div
            key={`${renderable.id}-backdrop`}
            role="presentation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={BACKDROP_FADE}
            onClick={renderable.onClose}
            className="fixed inset-0 z-panelBackdrop bg-scrim/35 backdrop-blur-[1px]"
          />
        ) : null}
      </AnimatePresence>
      <AnimatePresence mode="wait" initial={false}>
        {renderable ? (
          <motion.aside
            key={renderable.id}
            role="dialog"
            aria-modal="true"
            initial={presence.initial}
            animate={presence.animate}
            exit={presence.exit}
            transition={transition}
            style={isAssistantDock ? assistantDockAsideStyle() : detailStackAsideStyle()}
            className={isAssistantDock ? assistantDockAsideClassName : detailStackAsideClassName}
          >
            {renderable.node}
          </motion.aside>
        ) : null}
      </AnimatePresence>
    </>
  );
}
