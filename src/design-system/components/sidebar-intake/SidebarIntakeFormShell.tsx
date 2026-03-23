'use client';

import type { ReactNode } from 'react';
import { X } from '@/components/Icons';
import {
  SIDEBAR_INTAKE_CLOSE_BUTTON_CLASS,
  SIDEBAR_INTAKE_SUBTITLE_ACCENT,
} from './intakeFormClasses';

export interface SidebarIntakeFormShellProps {
  title: string;
  /** Small uppercase line under title (e.g. “Order Information”, “Plan mode”). */
  subtitle: string;
  subtitleAccent?: keyof typeof SIDEBAR_INTAKE_SUBTITLE_ACCENT;
  onClose: () => void;
  /** e.g. mode `TabSwitch` under the title row (shipped intake). */
  bandBelowHeader?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}

/**
 * Chrome for sidebar “intake” flows — matches {@link ShippedIntakeForm} layout.
 */
export function SidebarIntakeFormShell({
  title,
  subtitle,
  subtitleAccent = 'green',
  onClose,
  bandBelowHeader,
  children,
  footer,
}: SidebarIntakeFormShellProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="relative z-20 flex shrink-0 items-center justify-between border-b border-gray-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
            className={SIDEBAR_INTAKE_CLOSE_BUTTON_CLASS}
            aria-label="Close form"
          >
            <X className="h-4 w-4 text-gray-600" />
          </button>
          <div>
            <h2 className="text-sm font-black uppercase tracking-tight text-gray-900">{title}</h2>
            <p className={SIDEBAR_INTAKE_SUBTITLE_ACCENT[subtitleAccent]}>{subtitle}</p>
          </div>
        </div>
      </div>

      {bandBelowHeader ? (
        <div className="border-b border-gray-100 bg-white px-4 pt-4">{bandBelowHeader}</div>
      ) : null}

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-white p-4 scrollbar-hide">{children}</div>

      <div className="border-t border-gray-200 bg-white p-4">{footer}</div>
    </div>
  );
}
