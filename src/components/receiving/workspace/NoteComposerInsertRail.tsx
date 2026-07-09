'use client';

import { type ReactNode, useRef, useState } from 'react';
import { Loader2, Plus } from '@/components/Icons';
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

const INSERT_TRIGGER_BTN = `${NOTE_OVERLAY_ICON_BTN} h-[22px] w-auto min-w-[22px] gap-0.5 px-1.5 text-micro font-semibold text-text-muted transition hover:bg-surface-sunken/80 hover:text-text-default hover:shadow-sm hover:ring-1 hover:ring-border-soft/80`;

const RAIL_CHROME =
  'rounded-md bg-surface-card/90 px-0.5 py-0.5 shadow-sm ring-1 ring-border-soft/50 backdrop-blur-[2px]';

/**
 * Top-right insert control for note composers. Always renders a single
 * "+ Insert" trigger that opens a labeled menu — same affordance in the
 * label-notes field, claim body, and any future composers.
 */
export function NoteComposerInsertRail({ actions }: { actions: NoteComposerInsertAction[] }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  if (actions.length === 0) return null;

  return (
    <div className="pointer-events-none absolute right-1.5 top-1.5 z-10">
      <div className={`pointer-events-auto ${RAIL_CHROME}`}>
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Insert into note"
          onClick={() => setMenuOpen((open) => !open)}
          className={INSERT_TRIGGER_BTN}
        >
          <Plus className="h-3 w-3 shrink-0" />
          <span>Insert</span>
        </button>
        <Popover
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          anchorRef={triggerRef}
          placement="bottom-end"
          level="panelOverlay"
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
    </div>
  );
}
