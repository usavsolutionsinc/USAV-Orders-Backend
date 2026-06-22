import { useCallback, useId, useRef, type MouseEvent } from 'react';
import { useSiteTooltipOptional } from '@/components/providers/SiteTooltipProvider';

/**
 * A hover-to-copy identifier. Shows the full SKU/item value in mono style,
 * surfaces the site copy tooltip on hover/focus, and writes the raw value to the
 * clipboard on click. Reuses the shared SiteTooltipProvider so the "click to copy
 * → Copied" bubble matches the rest of the app.
 */
export function CopyableId({ value, className = '' }: { value: string; className?: string }) {
  const anchorId = useId();
  const ref = useRef<HTMLButtonElement | null>(null);
  const tooltip = useSiteTooltipOptional();
  const getRect = useCallback(() => ref.current?.getBoundingClientRect() ?? null, []);
  const trimmed = value.trim();

  const open = useCallback(() => {
    if (tooltip && trimmed) tooltip.activate({ anchorId, value: trimmed, getRect });
  }, [tooltip, trimmed, anchorId, getRect]);
  const close = useCallback(() => tooltip?.scheduleClose(anchorId), [tooltip, anchorId]);

  const copy = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (!trimmed) return;
      void navigator.clipboard?.writeText(trimmed);
      if (tooltip?.isActiveAnchor(anchorId)) tooltip.notifyCopied(anchorId);
    },
    [trimmed, tooltip, anchorId],
  );

  return (
    <button
      ref={ref}
      type="button"
      onClick={copy}
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
      disabled={!trimmed}
      title={!tooltip && trimmed ? trimmed : undefined}
      className={`min-w-0 truncate text-left transition-colors hover:text-blue-600 hover:underline disabled:no-underline disabled:hover:text-current ${className}`}
    >
      {value}
    </button>
  );
}
