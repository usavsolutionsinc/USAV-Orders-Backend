'use client';

import { useReducedMotion, type Transition } from 'framer-motion';

/**
 * Pair a motion transition with `prefers-reduced-motion`.
 *
 * Returns the given transition unchanged when the user has not opted into
 * reduced motion, and a near-zero-duration transition otherwise. Use this in
 * place of inline `useReducedMotion()` + ternary boilerplate.
 *
 *   const transition = useMotionTransition(framerTransition.cardExpansion);
 *   <motion.div transition={transition} ... />
 */
export function useMotionTransition(transition: Transition): Transition {
  const shouldReduce = useReducedMotion();
  return shouldReduce ? { duration: 0 } : transition;
}

/**
 * Pair a presence shape (initial/animate/exit) with `prefers-reduced-motion`.
 *
 * Returns the full shape when the user has not opted into reduced motion;
 * otherwise returns an opacity-only shape so elements still appear/disappear
 * without translation, scale, or blur effects.
 */
export function useMotionPresence<T extends { initial: object; animate: object; exit?: object }>(
  presence: T,
): T | { initial: { opacity: number }; animate: { opacity: number }; exit: { opacity: number } } {
  const shouldReduce = useReducedMotion();
  if (!shouldReduce) return presence;
  return {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  };
}
