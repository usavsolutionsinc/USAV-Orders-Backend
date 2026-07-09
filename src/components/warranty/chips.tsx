'use client';

import { cn } from '@/utils/_cn';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import {
  WARRANTY_STATUS_LABEL,
  WARRANTY_STATUS_TONE,
  type WarrantyClaimStatus,
} from '@/lib/warranty/types';
import type { WarrantyClockBasis } from '@/lib/warranty/clock';

/** Tone token → slim chip classes (mirrors the receiving display-primitive tone maps). */
const TONE_CLASSES: Record<string, string> = {
  slate: 'bg-surface-sunken text-text-muted ring-border-soft',
  blue: 'bg-surface-accent text-text-accent ring-border-accent',
  emerald: 'bg-surface-success text-text-success ring-border-success',
  rose: 'bg-surface-danger text-text-danger ring-border-danger',
  amber: 'bg-surface-warning text-text-warning ring-border-warning',
  teal: 'bg-fill-info/10 text-text-info ring-fill-info/40',
  gray: 'bg-surface-sunken text-text-muted ring-border-soft',
  zinc: 'bg-surface-strong text-text-muted ring-border-default',
};

export function WarrantyStatusBadge({ status, className }: { status: WarrantyClaimStatus; className?: string }) {
  const tone = WARRANTY_STATUS_TONE[status] ?? 'slate';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-caption font-medium ring-1 ring-inset',
        TONE_CLASSES[tone] ?? TONE_CLASSES.slate,
        className,
      )}
    >
      {WARRANTY_STATUS_LABEL[status] ?? status}
    </span>
  );
}

function clockTone(daysRemaining: number | null): string {
  if (daysRemaining == null) return 'gray';
  if (daysRemaining < 0) return 'zinc'; // expired
  if (daysRemaining <= 7) return 'rose';
  if (daysRemaining <= 14) return 'amber';
  return 'emerald';
}

function clockLabel(daysRemaining: number | null): string {
  if (daysRemaining == null) return 'No date';
  if (daysRemaining < 0) return 'Expired';
  if (daysRemaining === 0) return 'Last day';
  return `${daysRemaining}d left`;
}

/**
 * Warranty countdown chip with a basis badge: solid "Delivered" when the clock
 * is anchored on a real carrier delivered date, dashed "Est." while it's still
 * provisional (packed + estimate) and subject to recompute.
 */
export function WarrantyClockChip({
  daysRemaining,
  basis,
  className,
}: {
  daysRemaining: number | null;
  basis: WarrantyClockBasis | null;
  className?: string;
}) {
  const tone = clockTone(daysRemaining);
  const provisional = basis === 'PACKED_PLUS_ESTIMATE';
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <span
        className={cn(
          'inline-flex items-center rounded-full px-2 py-0.5 text-caption font-semibold ring-1 ring-inset tabular-nums',
          TONE_CLASSES[tone],
        )}
      >
        {clockLabel(daysRemaining)}
      </span>
      {basis && (
        <HoverTooltip
          label={
            provisional
              ? 'Provisional — based on packed date + 4-day estimate; recomputed when a carrier delivered date lands'
              : 'Based on the carrier delivered date'
          }
          asChild
        >
          <span
            className={cn(
              'inline-flex items-center rounded px-1.5 py-0.5 text-micro font-medium uppercase tracking-wide',
              provisional
                ? 'border border-dashed border-border-warning text-text-warning'
                : 'bg-surface-success text-text-success',
            )}
          >
            {provisional ? 'Est.' : 'Delivered'}
          </span>
        </HoverTooltip>
      )}
    </span>
  );
}
