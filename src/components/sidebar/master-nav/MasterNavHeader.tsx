'use client';

import { motion } from 'framer-motion';
import { ChevronDown } from '@/components/Icons';
import type { SidebarIconComponent } from '@/lib/sidebar-navigation';
import { cn } from '@/utils/_cn';

const spring = { type: 'spring', stiffness: 520, damping: 36 } as const;

/**
 * Closed master-nav trigger (plan §3.4). The icon carries the PAGE context; the
 * text is spent on the active MODE name (so the live rail doesn't say the page
 * name twice). Pure — the caller owns open/toggle state.
 */
export function MasterNavHeader({
  icon: Icon,
  label,
  open,
  onToggle,
  className,
}: {
  icon: SidebarIconComponent;
  /** Active mode name, or the page name for single-surface pages. */
  label: string;
  open: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      title="Switch page or mode"
      className={cn(
        'flex h-[40px] w-full min-w-0 items-center gap-2 px-2.5 text-left transition-colors hover:bg-surface-canvas',
        className,
      )}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-600/10 text-blue-600">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1 truncate text-[15px] font-bold tracking-tight text-text-default">
        {label}
      </span>
      <motion.span animate={{ rotate: open ? 180 : 0 }} transition={spring} className="shrink-0 text-text-muted">
        <ChevronDown className="h-4 w-4" />
      </motion.span>
    </button>
  );
}
