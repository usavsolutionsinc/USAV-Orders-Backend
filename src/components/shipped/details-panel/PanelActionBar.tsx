'use client';

import type { ReactNode } from 'react';
import { ChevronRight, ChevronUp } from '@/components/Icons';

interface PanelActionBarProps {
  onClose: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  disableMoveUp?: boolean;
  disableMoveDown?: boolean;
  rightActions?: Array<{
    label: string;
    onClick: () => void;
    icon: ReactNode;
    toneClassName?: string;
  }>;
}

function ActionButton({
  onClick,
  label,
  disabled = false,
  children,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="inline-flex h-6 min-w-6 items-center justify-center px-0.5 text-gray-400 transition-colors hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}

export function PanelActionBar({
  onClose,
  onMoveUp,
  onMoveDown,
  disableMoveUp = false,
  disableMoveDown = false,
  rightActions = [],
}: PanelActionBarProps) {
  return (
    <div className="px-8 pt-1 pb-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <ActionButton onClick={onClose} label="Close panel">
            <span className="flex items-center">
              <ChevronRight className="h-3.5 w-3.5" />
              <ChevronRight className="-ml-1 h-3.5 w-3.5" />
            </span>
          </ActionButton>

          <ActionButton onClick={onMoveUp} label="Move up a row" disabled={disableMoveUp}>
            <ChevronUp className="h-3.5 w-3.5" />
          </ActionButton>

          <ActionButton onClick={onMoveDown} label="Move down a row" disabled={disableMoveDown}>
            <ChevronUp className="h-3.5 w-3.5 rotate-180" />
          </ActionButton>
        </div>

        {rightActions.length > 0 ? (
          <div className="flex items-center gap-2">
            {rightActions.map((action) => (
              <ActionButton key={action.label} onClick={action.onClick} label={action.label}>
                <span className={action.toneClassName}>{action.icon}</span>
              </ActionButton>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
