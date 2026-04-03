'use client';

import type { ReactNode } from 'react';
import { ChevronRight, ChevronUp, Settings } from '@/components/Icons';
import type { PanelAction } from '@/hooks/usePanelActions';

interface PanelActionBarProps {
  onClose: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onAssign?: () => void;
  disableMoveUp?: boolean;
  disableMoveDown?: boolean;
  disableAssign?: boolean;
  actions?: PanelAction[];
}

export type PanelActionBarConfig = PanelActionBarProps;

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
  onAssign,
  disableMoveUp = false,
  disableMoveDown = false,
  disableAssign = false,
  actions = [],
}: PanelActionBarProps) {
  return (
    <div className="px-6 pt-1 pb-0">
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

        {(onAssign || actions.length > 0) && (
          <div className="flex items-center gap-2">
            {onAssign ? (
              <ActionButton onClick={onAssign} label="Open assignment" disabled={disableAssign}>
                <Settings className="h-3.5 w-3.5" />
              </ActionButton>
            ) : null}
            {actions.map((action) => (
              <ActionButton
                key={action.key}
                onClick={action.onAction}
                label={action.label}
              >
                <span className={action.toneClassName}>{action.icon}</span>
              </ActionButton>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
