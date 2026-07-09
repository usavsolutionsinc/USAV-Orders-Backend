'use client';

import { Globe, Lock } from '@/components/Icons';
import { cn } from '@/utils/_cn';

interface Props {
  /** false = internal note (private); true = public reply (emailed). */
  value: boolean;
  onChange: (v: boolean) => void;
  internalLabel: string;
  publicLabel: string;
  className?: string;
}

/**
 * Internal-note ↔ public-reply segmented toggle — the single source of truth for
 * the "is this Zendesk comment private or emailed?" control. Extracted from the
 * Support console's claim composer so every Zendesk surface (support claim + chat
 * composers, receiving claim + photo-note modals) renders the identical control:
 * amber lock = internal/private, blue globe = public/emailed.
 */
export function VisibilityToggle({ value, onChange, internalLabel, publicLabel, className }: Props) {
  return (
    <div className={cn('inline-flex rounded-lg bg-surface-sunken p-0.5', className)}>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={cn(
          'ds-raw-button inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-caption font-bold transition',
          !value ? 'bg-surface-card text-amber-700 shadow-sm' : 'text-text-soft hover:text-text-muted',
        )}
      >
        <Lock className="h-3.5 w-3.5" /> {internalLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange(true)}
        className={cn(
          'ds-raw-button inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-caption font-bold transition',
          value ? 'bg-surface-card text-blue-700 shadow-sm' : 'text-text-soft hover:text-text-muted',
        )}
      >
        <Globe className="h-3.5 w-3.5" /> {publicLabel}
      </button>
    </div>
  );
}
