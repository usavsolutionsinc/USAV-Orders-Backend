'use client';

import type { ReactNode } from 'react';
import { cn } from '@/utils/_cn';

/**
 * The lifted "bubble" surface used for the full-page order view's sections — a
 * rounded, softly-elevated card (`bg-surface-card` floating above the
 * `bg-surface-canvas` page) matching the Shopify/Stripe order-page idiom.
 *
 * Kept as a shared constant so the reused ShippedDetailsPanelContent (via its
 * `variant="card"` path), the full page's Documents/Timeline sections, and the
 * right-rail cards all render the same elevation, radius, and padding.
 */
export const SECTION_CARD_CLASS =
  'rounded-2xl border border-border-soft bg-surface-card p-5 shadow-sm';

export function SectionCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn(SECTION_CARD_CLASS, className)}>{children}</div>;
}
