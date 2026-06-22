'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Check, Loader2, X } from '@/components/Icons';

// ─── Shared shell ──────────────────────────────────────────────────────────

const MANUALS_UPDATED_EVENT = 'manuals-updated';

export function dispatchManualsUpdated() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(MANUALS_UPDATED_EVENT));
  }
}

interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  eyebrow: string;
  title: string;
  busy: boolean;
  children: React.ReactNode;
  footer: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg';
}

export function ModalShell({
  open, onClose, eyebrow, title, busy, children, footer, maxWidth = 'md',
}: ModalShellProps) {
  // Close on ESC (but not while a request is in flight — easy to lose work).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  // Render flag — createPortal needs document.body, which doesn't exist
  // during SSR. Gate the portal until after first client mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!open || !mounted) return null;

  const widthClass = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }[maxWidth];

  // Portal to body so the overlay escapes the sidebar's stacking context
  // and centers over the whole viewport — fixed positioning alone gets
  // trapped if any ancestor sets transform/filter/will-change.
  return createPortal(
    <div className="fixed inset-0 z-panelPopover flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close"
        onClick={() => { if (!busy) onClose(); }}
      />
      <div className={`relative z-panelPopover w-full ${widthClass} overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-900/20`}>
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <div>
            <p className="text-micro font-black uppercase tracking-[0.16em] text-zinc-500">{eyebrow}</p>
            <h2 className="mt-1 text-sm font-black text-zinc-900">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full border border-zinc-200 bg-white p-2 text-zinc-500 transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-800 disabled:opacity-40"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 px-4 py-4">{children}</div>
        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 bg-zinc-50/60 px-4 py-3">
          {footer}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-micro font-black uppercase tracking-[0.14em] text-zinc-500">
      {children}
    </span>
  );
}

export const inputClass =
  'w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100';

export const selectClass = inputClass + ' appearance-none bg-white';

export function PrimaryButton({
  busy, disabled, children, onClick, danger,
}: {
  busy?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  const base = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-micro font-black uppercase tracking-[0.14em] text-white transition-colors disabled:opacity-50';
  const tone = danger
    ? 'bg-red-600 hover:bg-red-700'
    : 'bg-gray-900 hover:bg-gray-800';
  return (
    <button type="button" onClick={onClick} disabled={busy || disabled} className={`${base} ${tone}`}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

export function SecondaryButton({ disabled, onClick, children }: { disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-micro font-black uppercase tracking-[0.14em] text-zinc-600 transition-colors hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-caption font-semibold text-red-700">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export const TYPE_OPTIONS = [
  { value: '',             label: 'Unspecified' },
  { value: 'manual',       label: 'Manual' },
  { value: 'packing-list', label: 'Packing List' },
  { value: 'pl-plus-m',    label: 'PL + M' },
];

export const STATUS_OPTIONS = [
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'assigned',   label: 'Assigned' },
  { value: 'archived',   label: 'Archived' },
];
