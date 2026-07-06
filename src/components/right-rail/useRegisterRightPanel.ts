'use client';

/**
 * useRegisterRightPanel — declaratively claim the right-rail slot for the
 * lifetime of the calling component (while `enabled`). This is how a panel
 * becomes an occupant of the single `RightRailHost` slot instead of rendering
 * its own competing `fixed right-0 z-panel` element.
 *
 *   useRegisterRightPanel({
 *     id: 'assistant',
 *     priority: RIGHT_RAIL_PRIORITY.assistant,
 *     node: <AssistantDockBody onClose={close} />,
 *     enabled: open,
 *   });
 *
 * Mount/unmount of the claim is keyed on `id`/`priority`/`enabled` only, so a
 * content re-render does NOT tear the occupant down (which would drop its state
 * and re-fire the crossfade). Node freshness is pushed separately via
 * `updateRightRailPanelNode`.
 */

import { useEffect, type ReactNode } from 'react';
import { registerRightRailPanel, updateRightRailPanelNode } from '@/lib/right-rail/store';

export function useRegisterRightPanel(opts: {
  id: string;
  priority: number;
  node: ReactNode;
  onClose?: () => void;
  /** When false the component makes no claim (e.g. an unopened dock). */
  enabled?: boolean;
}): void {
  const { id, priority, node, onClose, enabled = true } = opts;

  // Stable claim: registers once per (id, priority, enabled) change, unregisters
  // on unmount / disable. Deliberately excludes `node` so content updates don't
  // remount the occupant.
  // NOTE: `node` is intentionally excluded from the deps — it's kept fresh by the
  // effect below so a content re-render never remounts the occupant.
  useEffect(() => {
    if (!enabled) return undefined;
    return registerRightRailPanel({ id, priority, node, onClose });
  }, [id, priority, enabled]);

  // Keep the live occupant's node fresh (no-ops if the claim isn't active).
  useEffect(() => {
    if (!enabled) return;
    updateRightRailPanelNode(id, node, onClose);
  }, [id, node, onClose, enabled]);
}
