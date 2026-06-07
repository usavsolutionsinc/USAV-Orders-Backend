'use client';

import { motion } from 'framer-motion';
import { ChevronDown } from '@/components/Icons';
import type { SidebarIconComponent } from '@/lib/sidebar-navigation';
import { cn } from '@/utils/_cn';

const spring = { type: 'spring', stiffness: 520, damping: 36 } as const;

/**
 * Closed master-nav trigger (plan §3.4). The icon carries the active mode; the
 * label is the active mode name (or page name when modeless). Opens on hover via
 * the parent {@link MasterNavView} hover zone — no click handler here.
 */
export function MasterNavHeader({
  icon: Icon,
  label,
  open,
  className,
}: {
  icon: SidebarIconComponent;
  /** Active mode name, or the page name for single-surface pages. */
  label: string;
  open: boolean;
  className?: string;
}) {
  return (
    <div
      aria-expanded={open}
      title="Hover to switch page or mode"
      className={cn(
        // Exactly 40px — same grid as every other sidebar band (no bulky chip,
        // so the header reads as a lean 40px bar, not a taller block).
        'flex h-[40px] w-full min-w-0 items-center gap-2.5 px-3 text-left transition-colors hover:bg-surface-canvas',
        className,
      )}
    >
      <Icon className="h-5 w-5 shrink-0 text-blue-600" />
      <span className="min-w-0 flex-1 truncate text-[15px] font-bold tracking-tight text-text-default">
        {label}
      </span>
      <motion.span animate={{ rotate: open ? 180 : 0 }} transition={spring} className="shrink-0 text-text-muted">
        <ChevronDown className="h-4 w-4" />
      </motion.span>
    </div>
  );
}
