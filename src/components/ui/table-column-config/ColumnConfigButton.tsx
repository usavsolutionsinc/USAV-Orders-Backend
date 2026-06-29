'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/utils/_cn';
import { SlidersHorizontal, Check } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { useTableColumnConfig } from './TableColumnConfig';

/**
 * "Columns" config control for a shared list table. Drop it into the table's
 * header (e.g. `DateRangeHeader` `columns` slot, `iconOnly`). It renders only when a
 * {@link TableColumnConfigProvider} is mounted above it, and lists that table's
 * toggleable columns (from the registry) as checkboxes — each toggle hides/shows
 * the column for the signed-in staffer and persists to their prefs.
 *
 * The panel renders in a BODY PORTAL (house rule: contextual popovers must portal
 * so a scrolling sidebar/header never clips them) and is clamped to the viewport,
 * anchored under the trigger.
 */

const PANEL_W = 224; // w-56
const GAP = 4;

export function ColumnConfigButton({ className, iconOnly = false }: { className?: string; iconOnly?: boolean }) {
  const cfg = useTableColumnConfig();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Open below the trigger; align the panel's LEFT edge to the trigger, then
    // clamp so the right edge stays inside the viewport (8px gutter).
    const left = Math.max(8, Math.min(r.left, window.innerWidth - PANEL_W - 8));
    const top = Math.min(r.bottom + GAP, window.innerHeight - 16);
    setCoords({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onReflow = () => place();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReflow);
    // capture: catch scrolls in any ancestor scroll container, not just window.
    window.addEventListener('scroll', onReflow, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open, place]);

  if (!cfg || cfg.columns.length === 0) return null;

  const hiddenCount = cfg.hidden.size;

  return (
    <div className={cn('shrink-0', className)}>
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
            'text-gray-500 hover:bg-gray-50 hover:text-gray-700',
            open && 'bg-gray-50 text-gray-700',
          )}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={iconOnly ? 'Configure columns' : undefined}
        >
          {iconOnly ? (
            // Hidden-columns signal collapses to a small dot so the control stays
            // a single top-right icon.
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

      {open && coords
        ? createPortal(
            <div
              ref={panelRef}
              role="menu"
              data-testid="column-config-panel"
              className="fixed z-tooltip w-56 rounded-lg border border-gray-200 bg-white p-1 shadow-xl"
              style={{ top: coords.top, left: coords.left }}
            >
              <div className="flex items-center justify-between px-2 py-1.5">
                <p className="text-eyebrow font-black uppercase tracking-widest text-gray-400">
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
              <div className="divide-y divide-gray-100">
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
                      className="ds-raw-button flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-caption font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      <span
                        className={cn(
                          'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
                          shown
                            ? 'border-blue-500 bg-blue-500 text-white'
                            : 'border-gray-300 bg-white text-transparent',
                        )}
                      >
                        <Check className="h-3 w-3" />
                      </span>
                      <span className="flex-1 truncate">{col.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
