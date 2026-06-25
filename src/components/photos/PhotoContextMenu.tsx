'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { zIndex } from '@/design-system/tokens/z-index';
import { cn } from '@/utils/_cn';

export interface PhotoContextMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  separatorBefore?: boolean;
}

/**
 * A cursor-anchored right-click menu (portal). Used for per-photo "drilling"
 * actions in the library (view, copy link, attach to a Zendesk ticket, download,
 * delete) — the right-click counterpart to the selection toolbar. Clamps to the
 * viewport and closes on outside-click / Escape / scroll.
 */
export function PhotoContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: PhotoContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: zIndex.panelPopover + 5 }}
      className="min-w-[200px] overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-xl"
    >
      {items.map((item) => (
        <div key={item.key}>
          {item.separatorBefore ? <div className="my-1 border-t border-gray-100" /> : null}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              item.onClick();
              onClose();
            }}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12px] font-semibold transition',
              item.danger ? 'text-rose-600 hover:bg-rose-50' : 'text-gray-700 hover:bg-gray-50',
            )}
          >
            {item.icon ? (
              <span className={cn('shrink-0', item.danger ? 'text-rose-500' : 'text-gray-400')}>{item.icon}</span>
            ) : null}
            {item.label}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
