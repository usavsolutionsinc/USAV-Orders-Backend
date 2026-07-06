'use client';

/**
 * DetailStackRailRegistrar — registers geometry-free detail content with the
 * single `RightRailHost` slot. Returns null; the host renders the global
 * `DetailStackFrame` around `children`.
 */

import type { ReactNode } from 'react';
import { useRegisterRightPanel } from '@/components/right-rail/useRegisterRightPanel';
import { RIGHT_RAIL_PRIORITY } from '@/lib/right-rail/store';

export function DetailStackRailRegistrar({
  id,
  onClose,
  enabled = true,
  children,
}: {
  /** Stable occupant id — doubles as the AnimatePresence key in RightRailHost. */
  id: string;
  onClose: () => void;
  enabled?: boolean;
  children: ReactNode;
}) {
  useRegisterRightPanel({
    id,
    priority: RIGHT_RAIL_PRIORITY.detail,
    node: children,
    onClose,
    enabled,
  });
  return null;
}
