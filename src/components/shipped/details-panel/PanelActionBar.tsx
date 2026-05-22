'use client';

import { Settings } from '@/components/Icons';
import type { PanelAction } from '@/hooks/usePanelActions';
import {
  PaneHeaderActionBar,
  type PaneHeaderActionBarAction,
} from '@/components/ui/pane-header';

interface PanelActionBarProps {
  /** Retained for back-compat; close lives in the panel header X now, so this isn't rendered. */
  onClose?: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onAssign?: () => void;
  disableMoveUp?: boolean;
  disableMoveDown?: boolean;
  disableAssign?: boolean;
  actions?: PanelAction[];
}

export type PanelActionBarConfig = PanelActionBarProps;

/**
 * Thin adapter over {@link PaneHeaderActionBar}. Maps the existing
 * `onMoveUp` / `onMoveDown` / `onAssign` + `actions[]` props onto the
 * generic action-bar shape so the four shipped/work-order stacks
 * inherit the modernized visual (Refresh-style icon+label buttons +
 * prev/next chevrons) without changing their call sites.
 *
 * `onClose` is intentionally ignored — the panel header X owns closing.
 */
export function PanelActionBar({
  onMoveUp,
  onMoveDown,
  onAssign,
  disableMoveUp = false,
  disableMoveDown = false,
  disableAssign = false,
  actions = [],
}: PanelActionBarProps) {
  const mapped: PaneHeaderActionBarAction[] = [
    ...(onAssign
      ? [{
          key: 'assign',
          label: 'Assign',
          icon: <Settings className="h-3.5 w-3.5" />,
          onClick: onAssign,
          disabled: disableAssign,
          title: 'Open assignment',
        }]
      : []),
    ...actions.map((a) => ({
      key: a.key,
      label: a.label,
      icon: <span className={a.toneClassName}>{a.icon}</span>,
      onClick: a.onAction,
    })),
  ];

  return (
    <div className="px-6 pt-1">
      <PaneHeaderActionBar
        iconOnly
        actions={mapped}
        onPrev={onMoveUp}
        onNext={onMoveDown}
        prevDisabled={disableMoveUp}
        nextDisabled={disableMoveDown}
        prevTitle="Move up a row"
        nextTitle="Move down a row"
      />
    </div>
  );
}
