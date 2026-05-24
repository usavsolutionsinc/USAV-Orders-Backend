'use client';

/**
 * Portal-rendered "+ Add role" popover, anchored to a trigger button.
 *
 * Why a portal: this used to live inline inside the Roles sub-card of
 * `StaffAccessDetail`. The card creates a stacking context that swallowed
 * the popover under the Page access card below it. Rendering through
 * `createPortal` to document.body escapes every parent stacking context
 * and a z-[120] keeps us above the FAB (z-40) and SwitchStaffSheet (z-80).
 *
 * Re-anchors on resize and scroll. Closes on outside-click and Escape.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface RoleSlim {
  id: number;
  key: string;
  label: string;
  color: string;
  position: number;
  permissions: string[];
  is_system: boolean;
}

interface AddRolePopoverProps {
  roles: RoleSlim[];
  onAdd: (roleId: number) => void;
  disabled?: boolean;
}

const POPOVER_WIDTH = 240; // px

export function AddRolePopover({ roles, onAdd, disabled }: AddRolePopoverProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const computePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    // Anchor below the trigger, left-aligned by default. If the popover
    // would overflow the right edge, flip right-aligned.
    const left = Math.min(
      r.left,
      window.innerWidth - POPOVER_WIDTH - 8,
    );
    setPos({ top: r.bottom + 6, left: Math.max(8, left) });
  }, []);

  useEffect(() => {
    if (!open) return;
    computePosition();
    const onScrollOrResize = () => computePosition();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, computePosition]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (popoverRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  if (roles.length === 0) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 bg-white px-2 py-0.5 text-caption font-semibold text-gray-700 transition hover:border-blue-400 hover:text-blue-700 disabled:opacity-50"
      >
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
        Add role
      </button>

      {mounted && open && pos && createPortal(
        <div
          ref={popoverRef}
          role="menu"
          aria-label="Add role"
          className="fixed z-[120] max-h-72 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl shadow-gray-900/15"
          style={{ top: pos.top, left: pos.left, width: POPOVER_WIDTH }}
        >
          <ul className="divide-y divide-gray-100">
            {roles.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => { onAdd(r.id); setOpen(false); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-50"
                >
                  <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: r.color }} aria-hidden />
                  <span className="flex-1 truncate text-label font-semibold text-gray-900">{r.label}</span>
                  <span className="text-micro text-gray-400">{r.key}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </>
  );
}
