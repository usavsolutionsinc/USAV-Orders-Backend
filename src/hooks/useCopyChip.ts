'use client';

/**
 * Shared behavior for the id-chip family (`@/components/ui/CopyChip`):
 * site-tooltip anchoring (`useChipTooltip`) and copy-to-clipboard on top of it
 * (`useCopyChip`). Hover preview uses the site-wide tooltip from
 * `SiteTooltipProvider` (wired in `src/components/Providers.tsx`); if the
 * provider is absent the hooks degrade gracefully — copy still works, there is
 * just no hover bubble.
 */
import { MouseEvent, MutableRefObject, useCallback, useEffect, useId, useRef } from 'react';
import { useSiteTooltipOptional } from '@/components/providers/SiteTooltipProvider';
import { normalizeCopyText } from '@/lib/copy-chip-format';

export interface ChipTooltipAnchor {
  /** Attach to the chip's outer wrapper — the tooltip positions off this rect. */
  chipRef: MutableRefObject<HTMLDivElement | null>;
  /** False when no `SiteTooltipProvider` is mounted (fall back to a `title` attr). */
  hasTooltipProvider: boolean;
  openTooltip: () => void;
  closeTooltip: () => void;
  closeTooltipImmediate: () => void;
}

interface ChipTooltipInternals extends ChipTooltipAnchor {
  anchorId: string;
  tooltipCtxRef: MutableRefObject<ReturnType<typeof useSiteTooltipOptional>>;
}

/**
 * Tooltip-anchor wiring for a chip: stable anchor id, wrapper rect lookup, and
 * open/close handlers, with `closeNow` cleanup on unmount. `enabled` gates
 * opening only — close handlers always work so a chip that becomes empty can
 * still dismiss its bubble.
 */
export function useChipTooltip({
  enabled,
  tooltipValue,
}: {
  enabled: boolean;
  tooltipValue: string;
}): ChipTooltipInternals {
  const anchorId = useId();
  const chipRef = useRef<HTMLDivElement | null>(null);
  const tooltipCtx = useSiteTooltipOptional();
  const tooltipCtxRef = useRef(tooltipCtx);
  tooltipCtxRef.current = tooltipCtx;

  const getRect = useCallback(() => chipRef.current?.getBoundingClientRect() ?? null, []);

  useEffect(() => {
    return () => {
      tooltipCtxRef.current?.closeNow(anchorId);
    };
  }, [anchorId]);

  const openTooltip = () => {
    if (!enabled || !tooltipCtx) return;
    tooltipCtx.activate({ anchorId, value: tooltipValue, getRect });
  };

  const closeTooltip = () => {
    tooltipCtx?.scheduleClose(anchorId);
  };

  const closeTooltipImmediate = () => {
    tooltipCtx?.closeNow(anchorId);
  };

  return {
    chipRef,
    anchorId,
    tooltipCtxRef,
    hasTooltipProvider: !!tooltipCtx,
    openTooltip,
    closeTooltip,
    closeTooltipImmediate,
  };
}

export interface CopyChipBehavior extends ChipTooltipAnchor {
  /** Trimmed copy payload; `''` when the value is an empty-display sentinel. */
  normalizedValue: string;
  canCopy: boolean;
  /** Disable the button only when copy is wanted but there is nothing to copy. */
  isDisabled: boolean;
  handleCopy: (e: MouseEvent<HTMLButtonElement>) => void;
}

/**
 * Full copy-chip behavior: normalized value, copy gating, clipboard write with
 * the tooltip's "Copied" flash, and hover-tooltip wiring whose bubble shows the
 * value about to be copied (kept in sync if the value changes while open).
 */
export function useCopyChip({
  value,
  disableCopy = false,
  disableTooltip = false,
  onCopy,
}: {
  value: string | null | undefined;
  disableCopy?: boolean;
  disableTooltip?: boolean;
  /** Called after a successful clipboard write. Use for side-effects (e.g. dispatch a custom event). */
  onCopy?: (value: string) => void;
}): CopyChipBehavior {
  const normalizedValue = normalizeCopyText(value);
  const canCopy = !disableCopy && !!normalizedValue && normalizedValue !== '---';
  const isDisabled = !canCopy && !disableCopy;

  const { anchorId, tooltipCtxRef, ...tooltip } = useChipTooltip({
    enabled: !disableTooltip && canCopy,
    tooltipValue: normalizedValue,
  });

  useEffect(() => {
    tooltipCtxRef.current?.syncValueIfActive(anchorId, normalizedValue);
  }, [canCopy, anchorId, normalizedValue, tooltipCtxRef]);

  useEffect(() => {
    if (!canCopy) {
      tooltipCtxRef.current?.closeNow(anchorId);
    }
  }, [canCopy, anchorId, tooltipCtxRef]);

  const handleCopy = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!canCopy) return;
    navigator.clipboard.writeText(normalizedValue);
    onCopy?.(normalizedValue);
    if (tooltipCtxRef.current?.isActiveAnchor(anchorId)) {
      tooltipCtxRef.current.notifyCopied(anchorId);
    }
  };

  return { ...tooltip, normalizedValue, canCopy, isDisabled, handleCopy };
}
