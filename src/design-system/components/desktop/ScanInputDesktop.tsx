'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { framerTransition, framerPresence } from '../../foundations/motion-framer';

// ─── Types ───────────────────────────────────────────────────────────────────

type ScanFeedback = 'idle' | 'success' | 'error';

export interface ScanInputDesktopProps {
  /** Called when a scan value is submitted (Enter or external scanner newline). */
  onScan: (value: string) => void;
  /** Placeholder text. */
  placeholder?: string;
  /** Auto-focus on mount and after each scan. Default true. */
  autoFocus?: boolean;
  /** Visual feedback state — parent controls this after processing the scan. */
  feedback?: ScanFeedback;
  /** Reset feedback to idle. */
  onResetFeedback?: () => void;
  /** Whether the input is processing a scan. Shows spinner. */
  isProcessing?: boolean;
  /** Optional label above the input. */
  label?: string;
  /** Optional leading icon. */
  icon?: React.ReactNode;
  className?: string;
}

// ─── Feedback colors ─────────────────────────────────────────────────────────

const feedbackRing: Record<ScanFeedback, string> = {
  idle: 'ring-transparent',
  success: 'ring-emerald-400/60 ring-2',
  error: 'ring-red-400/60 ring-2',
};

const feedbackBorder: Record<ScanFeedback, string> = {
  idle: 'border-gray-200',
  success: 'border-emerald-400',
  error: 'border-red-400',
};

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * ScanInputDesktop — keyboard/scanner-optimized input for desktop mode.
 *
 * Design rules:
 *   - Always focused — external barcode scanners emit keystrokes, so the input
 *     must be ready to receive at all times.
 *   - Minimal visual footprint: border-bottom style by default, expands on focus.
 *   - Animated feedback: success → green ring pulse, error → red ring + subtle shake.
 *   - Clears automatically after submission so next scan is immediate.
 *   - `role="search"` + `aria-label` for accessibility.
 *
 * Focus management:
 *   - Auto-focuses on mount.
 *   - Re-focuses after each scan submission.
 *   - Re-focuses on window focus (user returns to tab).
 *   - `tabIndex={-1}` is NOT used — keyboard users can still tab to it.
 */
export function ScanInputDesktop({
  onScan,
  placeholder = 'Scan barcode or enter code...',
  autoFocus = true,
  feedback = 'idle',
  onResetFeedback,
  isProcessing = false,
  label,
  icon,
  className = '',
}: ScanInputDesktopProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');

  // Auto-focus on mount + window refocus
  useEffect(() => {
    if (!autoFocus) return;
    const focus = () => inputRef.current?.focus();
    focus();
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [autoFocus]);

  // Auto-reset feedback
  useEffect(() => {
    if (feedback === 'idle') return;
    const timer = setTimeout(() => onResetFeedback?.(), 800);
    return () => clearTimeout(timer);
  }, [feedback, onResetFeedback]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = value.trim();
      if (!trimmed || isProcessing) return;
      onScan(trimmed);
      setValue('');
      // Re-focus for next scan
      setTimeout(() => inputRef.current?.focus(), 0);
    },
    [value, isProcessing, onScan],
  );

  return (
    <div className={`space-y-1 ${className}`.trim()}>
      {label && (
        <label className="block text-[9px] font-black uppercase tracking-[0.2em] text-gray-500">
          {label}
        </label>
      )}

      <form onSubmit={handleSubmit} className="relative">
        <motion.div
          animate={
            feedback === 'error'
              ? { x: [0, -4, 4, -3, 3, 0] }
              : feedback === 'success'
                ? { scale: [1, 1.01, 1] }
                : {}
          }
          transition={
            feedback === 'error'
              ? { duration: 0.35, ease: 'easeOut' }
              : feedback === 'success'
                ? { duration: 0.2, ease: 'easeOut' }
                : undefined
          }
          className={`
            flex items-center gap-2
            border rounded-2xl bg-gray-50 shadow-inner
            transition-all duration-150
            ${feedbackBorder[feedback]}
            ${feedbackRing[feedback]}
            focus-within:border-gray-400 focus-within:bg-white focus-within:shadow-sm
          `.trim()}
        >
          {/* Leading icon */}
          {icon && (
            <span className="pl-3 flex-shrink-0 text-gray-400">
              {icon}
            </span>
          )}

          <input
            ref={inputRef}
            type="text"
            role="search"
            aria-label={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            className={`
              flex-1 bg-transparent border-0 outline-none
              h-10 text-[13px] font-bold text-gray-900
              placeholder:text-gray-400 placeholder:font-medium
              ${icon ? 'pl-1' : 'pl-3.5'} pr-3
            `.trim()}
          />

          {/* Processing spinner */}
          <AnimatePresence>
            {isProcessing && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="pr-3 flex-shrink-0"
              >
                <svg className="h-4 w-4 animate-spin text-gray-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </motion.span>
            )}
          </AnimatePresence>

          {/* Enter key hint */}
          {!isProcessing && (
            <span className="pr-2.5 flex-shrink-0">
              <span className="h-6 min-w-6 px-1.5 bg-white rounded border border-gray-100 shadow-sm flex items-center justify-center">
                <span className="text-[8px] font-black text-gray-400">ENTER</span>
              </span>
            </span>
          )}
        </motion.div>
      </form>
    </div>
  );
}
