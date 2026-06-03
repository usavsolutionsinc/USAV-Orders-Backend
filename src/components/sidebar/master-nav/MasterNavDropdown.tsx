'use client';

import { forwardRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from '@/components/Icons';
import type { SidebarNavItem, SidebarPageNav } from '@/lib/sidebar-navigation';
import { cn } from '@/utils/_cn';

const spring = { type: 'spring', stiffness: 520, damping: 36 } as const;
const softSpring = { type: 'spring', stiffness: 320, damping: 30 } as const;

// All-pages grouping mirrors the legacy sidebar nav (Main / Stations / More),
// keyed off each page's `kind`. Pages with no kind fall into "More".
const PAGE_GROUPS: ReadonlyArray<{ kind: NonNullable<SidebarNavItem['kind']>; label: string }> = [
  { kind: 'main', label: 'Main' },
  { kind: 'station', label: 'Stations' },
  { kind: 'bottom', label: 'More' },
];

/**
 * The master-nav menu (plan §3.4): RECENT pages on top (not the active one),
 * then Main / Stations / More in sidebar nav order. The active page only appears
 * in its group (blue row). Recents may also appear again in their group below.
 */
interface MasterNavDropdownProps {
  activePage: SidebarPageNav;
  activeModeId: string | null;
  recentPages: SidebarPageNav[];
  otherPages: SidebarPageNav[];
  /** `"${section}-${pageId}"` of the row whose modes are expanded, or null. */
  expandedKey: string | null;
  onToggleRow: (key: string | null) => void;
  onNavigate: (pageId: string, modeId?: string) => void;
  className?: string;
}

export const MasterNavDropdown = forwardRef<HTMLDivElement, MasterNavDropdownProps>(function MasterNavDropdown(
  { activePage, activeModeId, recentPages, otherPages, expandedKey, onToggleRow, onNavigate, className },
  ref,
) {
  const highlightedModeId = activeModeId ?? activePage.modes?.[0]?.id ?? null;

  const renderRow = (page: SidebarPageNav, keyPrefix: string) => {
    const rowKey = `${keyPrefix}-${page.id}`;
    const open = expandedKey === rowKey;
    const isPageActive = page.id === activePage.id;
    const PageIcon = page.icon;
    const modeCount = page.modes?.length ?? 0;
    return (
      <div key={rowKey}>
        <div
          className={cn(
            'flex items-stretch overflow-hidden rounded-xl transition-colors',
            isPageActive && 'bg-blue-600',
          )}
        >
          {/* Left: go straight to the page's default mode. */}
          <button
            type="button"
            onClick={() => onNavigate(page.id)}
            title={`Go to ${page.label}`}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left transition-colors',
              isPageActive ? 'text-white' : 'rounded-xl hover:bg-surface-canvas',
            )}
          >
            <PageIcon className={cn('h-[18px] w-[18px] shrink-0', isPageActive ? 'text-white' : 'text-text-muted')} />
            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{page.label}</span>
          </button>
          {/* Right: expand / collapse this page's modes (no-op if 0/1 mode). */}
          {modeCount > 1 && (
            <button
              type="button"
              onClick={() => onToggleRow(open ? null : rowKey)}
              aria-expanded={open}
              title={`${modeCount} modes`}
              className={cn(
                'flex shrink-0 items-center gap-1.5 px-2.5 py-2 transition-colors',
                isPageActive ? 'text-white/90 hover:text-white' : 'rounded-xl hover:bg-surface-canvas',
              )}
            >
              <span
                className={cn(
                  'text-[11px] font-bold tabular-nums',
                  isPageActive ? 'text-white/80' : 'text-text-muted/60',
                )}
              >
                {modeCount}
              </span>
              <motion.span
                animate={{ rotate: open ? 180 : 0 }}
                transition={spring}
                className={isPageActive ? 'text-white' : 'text-text-muted'}
              >
                <ChevronDown className="h-4 w-4" />
              </motion.span>
            </button>
          )}
        </div>
        <AnimatePresence initial={false}>
          {open && page.modes && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={softSpring}
              className="overflow-hidden"
            >
              <div className="space-y-0.5 py-1 pl-[34px] pr-1">
                {page.modes.map((mode) => {
                  const ModeIcon = mode.icon;
                  const isModeActive = isPageActive && mode.id === highlightedModeId;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => onNavigate(page.id, mode.id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors',
                        isModeActive
                          ? 'bg-blue-600 text-white'
                          : 'text-text-default hover:bg-blue-600 hover:text-white',
                      )}
                    >
                      <ModeIcon className="h-4 w-4 shrink-0 opacity-80" />
                      <span className="min-w-0 flex-1 truncate">{mode.label}</span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={softSpring}
      className={cn(
        'z-50 max-h-[340px] overflow-y-auto rounded-2xl border border-border-soft bg-surface-card p-1 shadow-xl shadow-slate-900/10',
        className,
      )}
    >
      {recentPages.length > 0 && (
        <>
          <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-widest text-text-muted/70">Recent</p>
          {recentPages.map((page) => renderRow(page, 'recent'))}
          <div className="my-1 h-px bg-border-soft" />
        </>
      )}
      {PAGE_GROUPS.map((group) => {
        const groupPages = otherPages.filter((p) => (p.kind ?? 'bottom') === group.kind);
        if (groupPages.length === 0) return null;
        return (
          <div key={group.kind}>
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-widest text-text-muted/70">{group.label}</p>
            {groupPages.map((page) => renderRow(page, group.kind))}
          </div>
        );
      })}
    </motion.div>
  );
});
