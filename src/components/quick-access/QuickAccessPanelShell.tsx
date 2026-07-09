'use client';

import type { ReactNode } from 'react';
import { X } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import { cn } from '@/utils/_cn';

interface QuickAccessPanelShellProps {
  title: string;
  /** Optional one-line context below the title. */
  subtitle?: string;
  /** Item count beside the title (plain number, no badge). */
  count?: number;
  onClose: () => void;
  children: ReactNode;
  /** Fixed aria label when it differs from title. */
  ariaLabel?: string;
  /** Actions rendered left of the close button (e.g. Clear all). */
  headerActions?: ReactNode;
  /** Sticky strip below the header (e.g. tab filters). */
  toolbar?: ReactNode;
  footer?: ReactNode;
  bodyClassName?: string;
  /** Panel width — defaults to 340px. */
  widthClass?: string;
}

/** Shared frame for account-menu secondary popovers (feedback, phone history, …). */
export function QuickAccessPanelShell({
  title,
  subtitle,
  count,
  onClose,
  children,
  ariaLabel,
  headerActions,
  toolbar,
  footer,
  bodyClassName,
  widthClass = 'w-[340px]',
}: QuickAccessPanelShellProps) {
  return (
    <div
      role="dialog"
      aria-label={ariaLabel ?? title}
      className={cn(
        'flex max-h-[calc(100vh-6rem)] flex-col overflow-hidden rounded-2xl border border-border-soft bg-surface-card shadow-xl',
        widthClass,
      )}
    >
      <header
        className={cn(
          'flex shrink-0 justify-between gap-3 border-b border-border-hairline px-4 py-2.5',
          subtitle ? 'items-start' : 'items-center',
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold leading-none text-text-default">{title}</p>
            {count != null && count > 0 ? (
              <span className="shrink-0 tabular-nums text-caption font-semibold text-text-soft">
                {count}
              </span>
            ) : null}
          </div>
          {subtitle ? (
            <p className="truncate text-caption text-text-soft">{subtitle}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {headerActions}
          <IconButton
            type="button"
            onClick={onClose}
            ariaLabel="Close"
            icon={<X className="h-3.5 w-3.5" />}
            className="flex h-7 w-7 items-center justify-center text-text-faint hover:text-text-muted"
          />
        </div>
      </header>
      {toolbar ? (
        <div className="shrink-0 border-b border-border-hairline px-3 py-2">{toolbar}</div>
      ) : null}
      <div
        className={cn(
          'min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2',
          bodyClassName,
        )}
      >
        {children}
      </div>
      {footer ? (
        <div className="shrink-0 border-t border-border-hairline px-4 py-3">{footer}</div>
      ) : null}
    </div>
  );
}
