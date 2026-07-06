'use client';

import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/utils/_cn';
import { SlidersHorizontal, Check } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { AnchoredLayer } from '@/design-system/primitives/AnchoredLayer';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { ToolbarButton } from '@/components/ui/ToolbarButton';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import { useMotionPresence, useMotionTransition } from '@/design-system/foundations/motion-framer-hooks';
import { useTableColumnConfig } from './TableColumnConfig';

/**
 * "Columns" config control for a shared list table. Drop it into the table's
 * header (e.g. `DateRangeHeader` `columns` slot, `iconOnly`). It renders only when a
 * {@link TableColumnConfigProvider} is mounted above it, and lists that table's
 * toggleable columns (from the registry) as checkboxes — each toggle hides/shows
 * the column for the signed-in staffer and persists to their prefs.
 *
 * The panel renders through {@link AnchoredLayer} (body portal + rect tracking)
 * so it never clips inside a scrolling header. Board-toolbar triggers use
 * `bottom-end` so the menu's right edge flush-aligns with the trigger — matching
 * the pencil + lane table corner below.
 */

const GAP = 4;

/** Board-toolbar popover — drops from the trigger's right edge with a slight slide-in. */
const toolbarColumnPanelPresence = {
  initial: { opacity: 0, y: -4, x: 8 },
  animate: { opacity: 1, y: 0, x: 0 },
  exit: { opacity: 0, y: -6, x: 4 },
};

export function ColumnConfigButton({
  className,
  iconOnly = false,
  variant = 'ghost',
}: {
  className?: string;
  iconOnly?: boolean;
  /**
   * `ghost` (default) — the borderless header control used inside dense-table
   * headers. `toolbar` — the shared Linear view-toolbar control (rounded, soft
   * border, solid-blue when its popover is open) used in the board headers so
   * Columns matches the staff / select controls beside it. `toolbar` is always
   * icon-only.
   */
  variant?: 'ghost' | 'toolbar';
}) {
  const cfg = useTableColumnConfig();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelPresence = useMotionPresence(
    variant === 'toolbar' ? toolbarColumnPanelPresence : framerPresence.dropdownPanel,
  );
  const panelTransition = useMotionTransition(framerTransition.dropdownOpen);

  if (!cfg || cfg.columns.length === 0) return null;

  const hiddenCount = cfg.hidden.size;
  const placement = variant === 'toolbar' ? 'bottom-end' : 'bottom-start';

  // Shared view-toolbar variant — the Linear method: rounded, soft-bordered,
  // solid-blue while its popover is open, so it matches the staff / select
  // controls beside it in the board headers. Always icon-only; the hidden-columns
  // signal is a small corner dot.
  const trigger =
    variant === 'toolbar' ? (
      <HoverTooltip label="Configure columns" focusable={false}>
        <ToolbarButton
          ref={btnRef}
          iconOnly
          active={open}
          data-testid="column-config-trigger"
          onClick={() => setOpen((v) => !v)}
          className="relative"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Configure columns"
        >
          <SlidersHorizontal className="h-4 w-4" />
          {hiddenCount > 0 ? (
            <span
              className={cn(
                'absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-white',
                open ? 'bg-surface-card' : 'bg-blue-600',
              )}
              aria-hidden
            />
          ) : null}
        </ToolbarButton>
      </HoverTooltip>
    ) : (
      <HoverTooltip label="Configure columns" focusable={false}>
        <Button
          ref={btnRef}
          variant="ghost"
          size="sm"
          data-testid="column-config-trigger"
          onClick={() => setOpen((v) => !v)}
          icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
          className={cn(
            'h-auto gap-1 rounded text-eyebrow font-black uppercase tracking-widest -my-0.5',
            iconOnly ? 'relative px-1 py-1' : 'px-1.5 py-0.5',
            'text-text-soft hover:bg-surface-hover hover:text-text-muted',
            open && 'bg-surface-canvas text-text-muted',
          )}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={iconOnly ? 'Configure columns' : undefined}
        >
          {iconOnly ? (
            hiddenCount > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-blue-600 ring-2 ring-white" aria-hidden />
            ) : null
          ) : (
            <>
              <span className="leading-none">Columns</span>
              {hiddenCount > 0 ? (
                <span className="rounded bg-blue-50 px-1 text-[8.5px] font-black leading-none text-blue-700 ring-1 ring-inset ring-blue-200">
                  {hiddenCount}
                </span>
              ) : null}
            </>
          )}
        </Button>
      </HoverTooltip>
    );

  return (
    <div className={cn('shrink-0', className)}>
      {trigger}

      <AnchoredLayer
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={btnRef}
        placement={placement}
        gap={GAP}
      >
        <AnimatePresence>
          {open ? (
            <motion.div
              initial={panelPresence.initial}
              animate={panelPresence.animate}
              exit={panelPresence.exit}
              transition={panelTransition}
              style={{ transformOrigin: variant === 'toolbar' ? 'top right' : 'top left' }}
              role="menu"
              data-testid="column-config-panel"
              className="w-56 rounded-lg border border-border-soft bg-surface-card p-1 shadow-xl"
            >
              <div className="flex items-center justify-between px-2 py-1.5">
                <p className="text-eyebrow font-black uppercase tracking-widest text-text-faint">
                  Show columns
                </p>
                {hiddenCount > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => cfg.reset()}
                    className="h-auto rounded px-0 py-0 text-eyebrow font-bold uppercase tracking-widest text-blue-600 hover:bg-transparent hover:text-blue-700 -my-0.5"
                  >
                    Reset
                  </Button>
                ) : null}
              </div>
              <div className="divide-y divide-border-hairline">
                {cfg.columns.map((col) => {
                  const shown = !cfg.isHidden(col.key);
                  return (
                    <button
                      key={col.key}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={shown}
                      data-testid={`column-toggle-${col.key}`}
                      onClick={() => cfg.toggle(col.key)}
                      className="ds-raw-button flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-caption font-semibold text-text-muted hover:bg-surface-hover"
                    >
                      <span
                        className={cn(
                          'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
                          shown
                            ? 'border-blue-500 bg-blue-500 text-white'
                            : 'border-border-default bg-surface-card text-transparent',
                        )}
                      >
                        <Check className="h-3 w-3" />
                      </span>
                      <span className="flex-1 truncate">{col.label}</span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </AnchoredLayer>
    </div>
  );
}
