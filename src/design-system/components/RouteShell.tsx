'use client';

import { useCallback, useMemo, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUIModeOptional } from '@/design-system/providers/UIModeProvider';
import {
  HorizontalButtonSlider,
  type HorizontalSliderItem,
} from '@/components/ui/HorizontalButtonSlider';
import { cn } from '@/utils/_cn';

export type RouteShellView = 'actions' | 'history';

const PANE_PARAM = 'pane';

export interface RouteShellProps {
  /** Sidebar / actions content. Already rendered inside DashboardSidebar on desktop, so this only mounts on mobile. */
  actions: ReactNode;
  /** Main / history content. Always renders. */
  history: ReactNode;
  /** Optional label overrides for the Actions ↔ History tabs. */
  actionsLabel?: string;
  historyLabel?: string;
  /** Pinned to bottom inside the active mobile pane (e.g., scan dock). Same slot on desktop renders below history. */
  bottomDock?: ReactNode;
  className?: string;
  /** Optional initial pane when no `?view=` is in the URL. Defaults to `history`. */
  defaultView?: RouteShellView;
}

function parseView(raw: string | null, fallback: RouteShellView): RouteShellView {
  return raw === 'actions' || raw === 'history' ? raw : fallback;
}

/**
 * RouteShell — single tree per page. Desktop renders `history` only (sidebar is owned by `DashboardSidebar`).
 * Mobile renders a TabSwitch that flips between Actions and History, driven by `?view=` in the URL.
 */
export function RouteShell({
  actions,
  history,
  actionsLabel = 'Actions',
  historyLabel = 'History',
  bottomDock,
  className,
  defaultView = 'history',
}: RouteShellProps) {
  const { isMobile } = useUIModeOptional();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeView = parseView(searchParams.get(PANE_PARAM), defaultView);

  const setView = useCallback(
    (next: string) => {
      if (next !== 'actions' && next !== 'history') return;
      const params = new URLSearchParams(searchParams.toString());
      if (next === defaultView) params.delete(PANE_PARAM);
      else params.set(PANE_PARAM, next);
      const qs = params.toString();
      router.replace(qs ? `?${qs}` : '?', { scroll: false });
    },
    [router, searchParams, defaultView],
  );

  const tabs = useMemo<HorizontalSliderItem[]>(
    () => [
      { id: 'actions', label: actionsLabel },
      { id: 'history', label: historyLabel },
    ],
    [actionsLabel, historyLabel],
  );

  if (!isMobile) {
    return (
      <div className={cn('flex min-h-0 w-full flex-1 flex-col overflow-hidden', className)}>
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 120 }}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {history}
        </motion.div>
        {bottomDock ? <div className="shrink-0 border-t border-gray-100 bg-white">{bottomDock}</div> : null}
      </div>
    );
  }

  return (
    <div className={cn('flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-white', className)}>
      <div className="shrink-0 border-b border-gray-100 px-2 py-1.5">
        <HorizontalButtonSlider
          items={tabs}
          value={activeView}
          onChange={setView}
          variant="nav"
          size="md"
          aria-label="Page view"
        />
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {activeView === 'actions' ? (
          <motion.div 
            key="actions-pane"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 120 }}
            className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto"
          >
            {actions}
          </motion.div>
        ) : (
          <motion.div 
            key="history-pane"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 120 }}
            className="flex min-h-0 w-full flex-1 flex-col overflow-hidden"
          >
            {history}
          </motion.div>
        )}
      </div>

      {bottomDock ? <div className="shrink-0 border-t border-gray-100 bg-white">{bottomDock}</div> : null}
    </div>
  );
}
