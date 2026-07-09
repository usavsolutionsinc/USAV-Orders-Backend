'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Check, X } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';

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
      {/* ds-raw-button: full-bleed dismiss scrim, not a Button shape */}
      <button
        type="button"
        className="ds-raw-button absolute inset-0 bg-scrim/40"
        aria-label="Close"
        onClick={() => { if (!busy) onClose(); }}
      />
      <div className={`relative z-panelPopover w-full ${widthClass} overflow-hidden rounded-2xl border border-border-soft bg-surface-card shadow-2xl shadow-zinc-900/20`}>
        <div className="flex items-center justify-between border-b border-border-soft px-4 py-3">
          <div>
            <p className="text-micro font-black uppercase tracking-[0.16em] text-text-soft">{eyebrow}</p>
            <h2 className="mt-1 text-sm font-black text-text-default">{title}</h2>
          </div>
          <IconButton
            icon={<X className="h-4 w-4" />}
            onClick={onClose}
            disabled={busy}
            ariaLabel="Close"
            className="rounded-full border border-border-soft bg-surface-card p-2 hover:border-border-default hover:bg-surface-hover hover:text-text-default"
          />
        </div>
        <div className="space-y-4 px-4 py-4">{children}</div>
        <div className="flex items-center justify-end gap-2 border-t border-border-hairline bg-surface-canvas/60 px-4 py-3">
          {footer}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-micro font-black uppercase tracking-[0.14em] text-text-soft">
      {children}
    </span>
  );
}

export const inputClass =
  'w-full rounded-lg border border-border-soft bg-surface-card px-3 py-2 text-sm text-text-default placeholder:text-text-faint focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100';

export const selectClass = inputClass + ' appearance-none bg-surface-card';

export function PrimaryButton({
  busy, disabled, children, onClick, danger,
}: {
  busy?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <Button
      variant={danger ? 'danger' : 'brand'}
      size="sm"
      loading={busy}
      disabled={disabled}
      icon={<Check className="h-3.5 w-3.5" />}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function SecondaryButton({ disabled, onClick, children }: { disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button variant="secondary" size="sm" onClick={onClick} disabled={disabled}>
      {children}
    </Button>
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
