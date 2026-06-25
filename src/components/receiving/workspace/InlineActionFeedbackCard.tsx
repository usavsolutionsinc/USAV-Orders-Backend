'use client';

/**
 * Shared inline success/error checklist card — the same visual language as
 * Receive complete (green left bar, staggered checks, optional dismiss). Used
 * below action surfaces in the receiving workspace (receive feedback, item
 * description save, etc.).
 */

import type { ReactNode } from 'react';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { AlertTriangle, Check, X } from '@/components/Icons';
import { useMotionPresence } from '@/design-system/foundations/motion-framer-hooks';

export type InlineActionFeedbackTone = 'emerald' | 'amber';

export type InlineActionFeedbackPayload = {
  tone: InlineActionFeedbackTone;
  headline: string;
  items: string[];
  note?: string;
  at: number;
};

export const INLINE_ACTION_FEEDBACK_TONE = {
  emerald: {
    border: 'border-emerald-200',
    bg: 'bg-emerald-50',
    bar: 'bg-emerald-500',
    title: 'text-emerald-900',
    icon: 'text-emerald-500',
    body: 'text-emerald-900',
  },
  amber: {
    border: 'border-amber-200',
    bg: 'bg-amber-50',
    bar: 'bg-amber-500',
    title: 'text-amber-900',
    icon: 'text-amber-500',
    body: 'text-amber-900',
  },
} as const;

const CHECK_ICON_VARIANTS: Variants = {
  initial: { scale: 0.5, opacity: 0 },
  animate: {
    scale: 1,
    opacity: 1,
    transition: { type: 'spring', stiffness: 500, damping: 26 },
  },
};

export function InlineActionFeedbackCard({
  tone,
  headline,
  items,
  note,
  at,
  onDismiss,
  footer,
  className = '',
}: {
  tone: InlineActionFeedbackTone;
  headline: string;
  items: string[];
  note?: string;
  /** When set, shows a compact time in the header row. */
  at?: number;
  onDismiss?: () => void;
  /** Extra rows below the checklist (e.g. receive sync footer, details). */
  footer?: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const item = useMotionPresence({ initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 } });
  const palette = INLINE_ACTION_FEEDBACK_TONE[tone];
  const timestamp =
    at != null
      ? new Date(at).toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        })
      : null;

  return (
    <div className={`relative overflow-hidden rounded-lg border ${palette.border} ${palette.bg} ${className}`.trim()}>
      <span className={`absolute inset-y-0 left-0 w-[3px] ${palette.bar}`} aria-hidden />
      <div className="flex items-start gap-2 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className={`text-eyebrow font-black uppercase tracking-widest ${palette.title}`}>
              {headline}
            </p>
            {timestamp ? (
              <span className="shrink-0 text-eyebrow font-semibold tabular-nums text-slate-400">
                {timestamp}
              </span>
            ) : null}
          </div>

          {items.length > 0 ? (
            <motion.ul
              className="mt-1.5 space-y-1"
              initial="initial"
              animate="animate"
              variants={{
                animate: {
                  transition: {
                    staggerChildren: reduce ? 0 : 0.08,
                    delayChildren: reduce ? 0 : 0.04,
                  },
                },
              }}
            >
              {items.map((label, i) => (
                <motion.li
                  key={`${i}-${label}`}
                  variants={item as Variants}
                  className={`flex items-start gap-1.5 text-caption font-semibold leading-snug ${palette.body}`}
                >
                  <motion.span
                    variants={reduce ? undefined : CHECK_ICON_VARIANTS}
                    className="mt-px shrink-0"
                  >
                    <Check className={`h-4 w-4 ${palette.icon}`} />
                  </motion.span>
                  <span className="min-w-0 break-words whitespace-pre-wrap">{label}</span>
                </motion.li>
              ))}
            </motion.ul>
          ) : null}

          {note ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-micro font-medium leading-snug text-slate-600">
              {tone === 'amber' ? (
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" />
              ) : null}
              <span className="min-w-0 break-words whitespace-pre-wrap">{note}</span>
            </p>
          ) : null}

          {footer}
        </div>

        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            title="Dismiss"
            className="shrink-0 rounded p-0.5 text-slate-400 transition-colors hover:bg-white/60 hover:text-slate-700"
          >
            <X className="h-3 w-3" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
