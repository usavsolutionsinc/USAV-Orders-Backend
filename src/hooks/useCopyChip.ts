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
import { recordCopy } from '@/lib/clipboard-history';

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
  tooltipAction = 'copy',
}: {
  enabled: boolean;
  tooltipValue: string;
  tooltipAction?: 'copy' | 'external-link';
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
    tooltipCtx.activate({ anchorId, value: tooltipValue, getRect, action: tooltipAction });
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
  /** Show / refresh the site tooltip bubble (copy flash or external-link preview). */
  flashTooltip: () => void;
  /** Open the site tooltip without the copied flash (external-link preview). */
  showTooltipPreview: () => void;
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
  tooltipTrigger = 'hover',
  onCopy,
  historyKind,
  historyDisplay,
  tooltipAction = 'copy',
}: {
  value: string | null | undefined;
  disableCopy?: boolean;
  disableTooltip?: boolean;
  /** `click` — bubble only on chip click (pairs with a separate hover action menu). */
  tooltipTrigger?: 'hover' | 'click';
  /** Called after a successful clipboard write. Use for side-effects (e.g. dispatch a custom event). */
  onCopy?: (value: string) => void;
  /** Chip tone, logged to the device clipboard history for typed re-rendering. */
  historyKind?: string;
  /** Short chip label, logged to the device clipboard history. */
  historyDisplay?: string;
  /** Trailing icon in the hover bubble — external-link for open-in-tab chips. */
  tooltipAction?: 'copy' | 'external-link';
}): CopyChipBehavior {
  const normalizedValue = normalizeCopyText(value);
  const canCopy = !disableCopy && !!normalizedValue && normalizedValue !== '---';
  const isDisabled = !canCopy && !disableCopy;

  const { anchorId, tooltipCtxRef, chipRef, ...tooltip } = useChipTooltip({
    enabled: !disableTooltip && !!normalizedValue && normalizedValue !== '---',
    tooltipValue: normalizedValue,
    tooltipAction,
  });

  const getRect = useCallback(() => chipRef.current?.getBoundingClientRect() ?? null, [chipRef]);

  useEffect(() => {
    tooltipCtxRef.current?.syncValueIfActive(anchorId, normalizedValue);
  }, [canCopy, anchorId, normalizedValue, tooltipCtxRef]);

  useEffect(() => {
    if (!canCopy) {
      tooltipCtxRef.current?.closeNow(anchorId);
    }
  }, [canCopy, anchorId, tooltipCtxRef]);

  const flashTooltip = () => {
    if (disableTooltip || !tooltipCtxRef.current) return;
    const ctx = tooltipCtxRef.current;
    if (!ctx.isActiveAnchor(anchorId)) {
      ctx.activate({ anchorId, value: normalizedValue, getRect, action: tooltipAction });
    }
    ctx.notifyCopied(anchorId);
  };

  const showTooltipPreview = () => {
    if (disableTooltip || !tooltipCtxRef.current) return;
    if (!normalizedValue || normalizedValue === '---') return;
    tooltipCtxRef.current.activate({
      anchorId,
      value: normalizedValue,
      getRect,
      action: tooltipAction,
    });
  };

  const handleCopy = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!canCopy) return;
    navigator.clipboard.writeText(normalizedValue);
    recordCopy(normalizedValue, { kind: historyKind, display: historyDisplay });
    onCopy?.(normalizedValue);
    if (tooltipTrigger === 'click') {
      flashTooltip();
    } else if (tooltipCtxRef.current?.isActiveAnchor(anchorId)) {
      tooltipCtxRef.current.notifyCopied(anchorId);
    }
  };

  return { ...tooltip, chipRef, normalizedValue, canCopy, isDisabled, handleCopy, flashTooltip, showTooltipPreview };
}
