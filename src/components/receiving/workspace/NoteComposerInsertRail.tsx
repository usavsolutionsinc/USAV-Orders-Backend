'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Loader2, Plus } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Popover } from '@/design-system/primitives/Popover';
import { NOTE_OVERLAY_ICON, NOTE_OVERLAY_ICON_BTN } from './note-composer-helpers';

export type NoteComposerInsertAction = {
  id: string;
  label: string;
  ariaLabel: string;
  icon: ReactNode;
  buttonClassName: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
};

/** Below this container width, collapse the icon rail into an Insert menu. */
const COMPACT_RAIL_WIDTH_PX = 420;

const COMPACT_TRIGGER_BTN = `${NOTE_OVERLAY_ICON_BTN} h-[22px] w-auto min-w-[22px] gap-0.5 px-1.5 text-micro font-semibold text-text-muted transition hover:bg-surface-sunken/80 hover:text-text-default hover:shadow-sm hover:ring-1 hover:ring-border-soft/80`;

function InsertIconButton({ action }: { action: NoteComposerInsertAction }) {
  return (
    <HoverTooltip label={action.label} asChild>
      <button
        type="button"
        onClick={action.onClick}
        disabled={action.disabled || action.loading}
        aria-label={action.ariaLabel}
        className={`${action.buttonClassName} disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {action.loading ? <Loader2 className={`${NOTE_OVERLAY_ICON} animate-spin`} /> : action.icon}
      </button>
    </HoverTooltip>
  );
}

/**
 * Top-right insert rail for note composers. Icons wrap on wide surfaces; on
 * narrow containers (resized claim modal, small panes) collapses to an Insert
 * menu so controls never crowd the first line of text.
 */
export function NoteComposerInsertRail({ actions }: { actions: NoteComposerInsertAction[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const compactTriggerRef = useRef<HTMLButtonElement>(null);
  const [compact, setCompact] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      setCompact(entry.contentRect.width < COMPACT_RAIL_WIDTH_PX);
    });
    ro.observe(el);
    setCompact(el.getBoundingClientRect().width < COMPACT_RAIL_WIDTH_PX);
    return () => ro.disconnect();
  }, []);

  if (actions.length === 0) return null;

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-x-2 top-2 flex justify-end">
      {compact ? (
        <div className="pointer-events-auto">
          <button
            ref={compactTriggerRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Insert into note"
            onClick={() => setMenuOpen((open) => !open)}
            className={COMPACT_TRIGGER_BTN}
          >
            <Plus className="h-3 w-3 shrink-0" />
            <span>Insert</span>
          </button>
          <Popover
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            anchorRef={compactTriggerRef}
            placement="bottom-end"
            role="menu"
            aria-label="Insert into note"
            padded={false}
            className="min-w-[11rem] py-1"
          >
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                disabled={action.disabled || action.loading}
                onClick={() => {
                  action.onClick();
                  setMenuOpen(false);
                }}
                className="ds-raw-button flex w-full items-center gap-2 px-3 py-2 text-left text-caption font-medium text-text-default transition hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center text-text-muted">
                  {action.loading ? (
                    <Loader2 className={`${NOTE_OVERLAY_ICON} animate-spin`} />
                  ) : (
                    action.icon
                  )}
                </span>
                <span className="min-w-0 truncate">{action.label}</span>
              </button>
            ))}
          </Popover>
        </div>
      ) : (
        <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-end gap-0.5">
          {actions.map((action) => (
            <InsertIconButton key={action.id} action={action} />
          ))}
        </div>
      )}
    </div>
  );
}
