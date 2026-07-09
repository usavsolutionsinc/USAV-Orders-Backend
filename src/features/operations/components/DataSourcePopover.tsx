'use client';

/**
 * Portal-only data-source panel anchored to any element (e.g. KPI card).
 * Closing: outside-click (excluding anchor), Escape.
 */
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type DataSourceInfo = {
  headline: string;
  bullets: string[];
  endpoint: string;
};

const WIDTH = 300;

type DataSourcePopoverProps = {
  info: DataSourceInfo;
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function DataSourcePopover({ info, anchorRef, open, onOpenChange }: DataSourcePopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const position = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = r.left + (r.width - WIDTH) / 2;
    left = Math.min(Math.max(8, left), window.innerWidth - WIDTH - 8);
    setPos({ top: r.bottom + 2, left });
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    position();
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    const onMV = () => position();
    window.addEventListener('scroll', onMV, true);
    window.addEventListener('resize', onMV);
    return () => {
      window.removeEventListener('scroll', onMV, true);
      window.removeEventListener('resize', onMV);
    };
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onOpenChange(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, onOpenChange, anchorRef]);

  if (!mounted || !open || !pos) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`Data source: ${info.headline}`}
      className="fixed z-modal rounded-2xl border border-border-soft bg-surface-card p-3.5 text-left shadow-[0_8px_32px_rgba(45,42,38,0.12)]"
      style={{ top: pos.top, left: pos.left, width: WIDTH, maxHeight: 'min(420px, 70vh)', overflowY: 'auto' }}
    >
      <p className="text-caption font-black uppercase tracking-[0.12em] text-text-muted">Data source</p>
      <p className="mt-1 text-[13px] font-bold leading-snug text-text-default">{info.headline}</p>
      <ul className="mt-2.5 space-y-1.5 text-caption font-medium leading-relaxed text-text-muted">
        {info.bullets.map((b, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#C4BAA8]" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-border-soft pt-2.5 text-micro font-semibold uppercase tracking-wide text-text-muted">
        API route
      </p>
      <code className="mt-1 block break-all rounded-lg bg-surface-card px-2 py-1.5 font-mono text-micro leading-relaxed text-text-default">
        {info.endpoint}
      </code>
    </div>,
    document.body,
  );
}
