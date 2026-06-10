'use client';

import {
  useEffect,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/utils/_cn';
import { zIndex, type ZIndexToken } from '@/design-system/tokens/z-index';

// ─── Layer ───────────────────────────────────────────────────────────────────
//
// The canonical building block for anything that participates in the GLOBAL
// stacking order (modals, popovers, panels, drawers, banners, tooltips).
//
// It does two things, correctly, so individual overlays stop re-deriving them:
//   1. Applies a z-index from the single-source-of-truth scale
//      (`tokens/z-index.ts`) via the `level` token — never a raw number.
//   2. Optionally portals to <body> so the layer escapes any ancestor that
//      established a containing block / stacking context (transform, filter,
//      backdrop-filter, will-change, perspective, contain) — the trap that
//      makes a high z-index silently fail for in-flow popovers.
//
// It owns NO chrome (no backdrop, scroll-lock, focus-trap, motion) — compose
// those in the caller, or use the higher-level RightPaneOverlay / BottomSheet
// for full modals. Layer is the low-level z + portal applicator.
//
// Usage:
//   <Layer level="modal" className="fixed inset-0 flex items-center justify-center">
//     …dialog…
//   </Layer>
//
//   // inline / non-Tailwind contexts:
//   const z = useZIndex('panelPopover');
//   <div style={{ position: 'fixed', top, left, zIndex: z }} />

export interface LayerProps extends HTMLAttributes<HTMLDivElement> {
  /** Stacking band token from the scale (e.g. 'modal', 'panelPopover', 'toast'). */
  level: ZIndexToken;
  /**
   * Render through a portal to <body>. Default true — the safe choice for any
   * `fixed`/`absolute` overlay, since it cannot then be trapped by an ancestor
   * stacking context. Set false only for a layer that intentionally stacks
   * within its parent's local context.
   */
  portal?: boolean;
  /** Offset from the band (e.g. +1 for a panel that must sit over its backdrop). */
  offset?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * Resolve a scale token to its numeric z-index — for inline styles, framer
 * `animate`, canvas, or any non-className context.
 */
export function useZIndex(level: ZIndexToken, offset = 0): number {
  return zIndex[level] + offset;
}

export function Layer({
  level,
  portal = true,
  offset = 0,
  className,
  style,
  children,
  ...rest
}: LayerProps) {
  // Only mount the portal target on the client (App Router SSR safety).
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTarget(document.body);
  }, []);

  const node = (
    <div className={cn(className)} style={{ zIndex: zIndex[level] + offset, ...style }} {...rest}>
      {children}
    </div>
  );

  if (!portal) return node;
  if (!target) return null;
  return createPortal(node, target);
}
