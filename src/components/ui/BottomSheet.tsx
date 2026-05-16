'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMediaQuery } from '@/hooks/_ui';

/**
 * Responsive overlay primitive.
 *
 *   mobile (< md):  bottom-anchored sheet with drag-to-dismiss + drag handle.
 *   desktop (≥ md): centered dialog with fade + scale-in entrance.
 *
 * Always portals to <body> so the scrim covers the full viewport even when an
 * ancestor establishes a fixed-positioning containing block (transform,
 * filter, backdrop-filter, will-change, perspective, contain).
 *
 * Callers can force a variant via `forceVariant` if they want consistent
 * physics regardless of viewport (rare — keep at 'auto' by default).
 */

type Variant = 'auto' | 'sheet' | 'dialog';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Hide drag-to-dismiss + handle. Implicit for destructive confirmations. */
  dragDisabled?: boolean;
  /** Override the max-width on desktop. Default 28rem. */
  maxWidth?: string;
  /** Force a specific variant regardless of viewport. */
  forceVariant?: Variant;
  children: React.ReactNode;
}

const DESKTOP_BREAKPOINT = '(min-width: 768px)';

export function BottomSheet({
  open,
  onClose,
  title,
  dragDisabled = false,
  maxWidth = '28rem',
  forceVariant = 'auto',
  children,
}: BottomSheetProps) {
  const reduceMotion = useReducedMotion();
  const isDesktop = useMediaQuery(DESKTOP_BREAKPOINT);
  const variant: Variant =
    forceVariant !== 'auto' ? forceVariant : isDesktop ? 'dialog' : 'sheet';

  // Track portal target — only mount on the client side.
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalNode(document.body);
  }, []);

  // Lock body scroll + Escape-to-close while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!portalNode) return null;

  const overlay = (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[200]">
          {/* Scrim */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.18 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />

          {variant === 'sheet' ? (
            <SheetPanel
              title={title}
              dragDisabled={dragDisabled}
              maxWidth={maxWidth}
              reduceMotion={!!reduceMotion}
              onClose={onClose}
            >
              {children}
            </SheetPanel>
          ) : (
            <DialogPanel
              title={title}
              maxWidth={maxWidth}
              reduceMotion={!!reduceMotion}
            >
              {children}
            </DialogPanel>
          )}
        </div>
      )}
    </AnimatePresence>
  );

  return createPortal(overlay, portalNode);
}

// ─── Mobile variant: bottom-anchored sheet ─────────────────────────────────

interface SheetPanelProps {
  title?: string;
  dragDisabled: boolean;
  maxWidth: string;
  reduceMotion: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

function SheetPanel({ title, dragDisabled, maxWidth, reduceMotion, onClose, children }: SheetPanelProps) {
  return (
    <div className="absolute inset-x-0 bottom-0 flex justify-center">
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { type: 'spring', damping: 32, stiffness: 320, mass: 0.9 }
        }
        drag={dragDisabled ? false : 'y'}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.6 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 100 || info.velocity.y > 600) onClose();
        }}
        className="w-full overflow-hidden rounded-t-[28px] bg-white shadow-[0_-12px_48px_-16px_rgba(0,0,0,0.25)]"
        style={{ maxWidth, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {!dragDisabled && (
          <div className="flex justify-center pt-3 pb-1">
            <div className="h-1.5 w-12 rounded-full bg-gray-300" />
          </div>
        )}
        {title && (
          <div className="px-6 pt-2 pb-1 text-center">
            <h3 className="text-[15px] font-semibold tracking-tight text-gray-900">
              {title}
            </h3>
          </div>
        )}
        <div className="px-6 pb-6 pt-2">{children}</div>
      </motion.div>
    </div>
  );
}

// ─── Desktop variant: centered modal dialog ────────────────────────────────

interface DialogPanelProps {
  title?: string;
  maxWidth: string;
  reduceMotion: boolean;
  children: React.ReactNode;
}

function DialogPanel({ title, maxWidth, reduceMotion, children }: DialogPanelProps) {
  // Stop scrim-click bubbling so clicking inside the dialog doesn't close it.
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4">
      <motion.div
        role="dialog"
        aria-modal="true"
        onClick={stop}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 4 }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { type: 'spring', damping: 28, stiffness: 360, mass: 0.7 }
        }
        className="w-full overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-[0_24px_64px_-12px_rgba(0,0,0,0.25),0_0_0_1px_rgba(0,0,0,0.02)]"
        style={{ maxWidth }}
      >
        {title && (
          <div className="border-b border-gray-100 px-6 pt-5 pb-4 text-center">
            <h3 className="text-[16px] font-semibold tracking-tight text-gray-900">
              {title}
            </h3>
          </div>
        )}
        <div className="px-6 py-5">{children}</div>
      </motion.div>
    </div>
  );
}

// ─── Confirm sheet — replaces window.confirm ───────────────────────────────

interface ConfirmSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}

export function ConfirmSheet({
  open,
  onClose,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
}: ConfirmSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} dragDisabled={destructive} title={title}>
      {message && (
        <p className="mb-5 text-center text-[13px] leading-relaxed text-gray-600">
          {message}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row-reverse sm:gap-3">
        <button
          type="button"
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className={`flex h-12 w-full items-center justify-center rounded-2xl text-sm font-semibold tracking-wide text-white shadow-md transition-transform active:scale-[0.98] sm:flex-1 ${
            destructive
              ? 'bg-gradient-to-br from-red-500 to-red-700 shadow-red-500/30'
              : 'bg-gradient-to-br from-blue-500 to-blue-700 shadow-blue-600/30'
          }`}
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-12 w-full items-center justify-center rounded-2xl text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-100 sm:flex-1"
        >
          {cancelLabel}
        </button>
      </div>
    </BottomSheet>
  );
}

// ─── Prompt sheet — replaces window.prompt ─────────────────────────────────

interface PromptSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Transform on commit, e.g. .toUpperCase() */
  transform?: (v: string) => string;
  onCommit: (value: string) => void;
}

export function PromptSheet({
  open,
  onClose,
  title,
  message,
  defaultValue = '',
  placeholder,
  confirmLabel = 'Save',
  transform,
  onCommit,
}: PromptSheetProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 220);
      return () => clearTimeout(t);
    }
  }, [open]);

  const commit = () => {
    const raw = inputRef.current?.value ?? '';
    const next = (transform ? transform(raw) : raw).trim();
    if (next) {
      onCommit(next);
      onClose();
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      {message && (
        <p className="mb-3 text-center text-[12px] text-gray-500">{message}</p>
      )}
      <input
        ref={inputRef}
        type="text"
        defaultValue={defaultValue}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') onClose();
        }}
        autoComplete="off"
        className="mb-4 h-12 w-full rounded-2xl border border-gray-300 bg-gray-50 px-4 text-sm font-semibold text-gray-900 outline-none transition-colors focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-200"
      />
      <div className="flex flex-col gap-2 sm:flex-row-reverse sm:gap-3">
        <button
          type="button"
          onClick={commit}
          className="flex h-12 w-full items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-sm font-semibold tracking-wide text-white shadow-md shadow-blue-600/30 transition-transform active:scale-[0.98] sm:flex-1"
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-12 w-full items-center justify-center rounded-2xl text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-100 sm:flex-1"
        >
          Cancel
        </button>
      </div>
    </BottomSheet>
  );
}
