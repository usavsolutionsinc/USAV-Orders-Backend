import type { ReactNode } from 'react';
import { Barcode, Check, ClipboardList, Lock, PackageCheck } from '@/components/Icons';

/**
 * Single source of truth for FBA status display. Replaces ad-hoc STATUS_STYLES
 * maps scattered through the dashboard table and card surfaces.
 *
 * Status vocabulary (shared by shipment-level and item-level):
 *   PLANNED        — queued, not yet picked
 *   READY_TO_GO    — prepped and allocated to a tracking bundle
 *   LABEL_ASSIGNED — carrier label applied
 *   SHIPPED        — handed to carrier
 *   CLOSED         — plan/shipment archived
 */
export type FbaStatus =
  | 'PLANNED'
  | 'READY_TO_GO'
  | 'LABEL_ASSIGNED'
  | 'SHIPPED'
  | 'CLOSED';

interface StatusToken {
  label: string;
  icon: (props: { className?: string }) => ReactNode;
  /** Tailwind classes for the pill (bg + text + border). */
  pill: string;
  /** Tailwind class for the icon color. */
  icon_tone: string;
}

const TOKENS: Record<FbaStatus, StatusToken> = {
  PLANNED: {
    label: 'Planned',
    icon: ClipboardList,
    pill: 'bg-gray-100 text-gray-600 border-gray-200',
    icon_tone: 'text-gray-500',
  },
  READY_TO_GO: {
    label: 'Ready',
    icon: Check,
    pill: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    icon_tone: 'text-emerald-600',
  },
  LABEL_ASSIGNED: {
    label: 'Labeled',
    icon: Barcode,
    pill: 'bg-blue-100 text-blue-700 border-blue-200',
    icon_tone: 'text-blue-600',
  },
  SHIPPED: {
    label: 'Shipped',
    icon: PackageCheck,
    pill: 'bg-purple-100 text-purple-700 border-purple-200',
    icon_tone: 'text-purple-600',
  },
  CLOSED: {
    label: 'Closed',
    icon: Lock,
    pill: 'bg-slate-100 text-slate-600 border-slate-200',
    icon_tone: 'text-slate-500',
  },
};

const FALLBACK: StatusToken = {
  label: '—',
  icon: ClipboardList,
  pill: 'bg-gray-100 text-gray-500 border-gray-200',
  icon_tone: 'text-gray-400',
};

export interface FbaStatusBadgeProps {
  status: FbaStatus | string;
  /** `xs` matches legacy dashboard badge sizing; `sm` suits card headers. */
  size?: 'xs' | 'sm';
  /** When true, only the icon is rendered — useful in dense rows. */
  iconOnly?: boolean;
  className?: string;
}

export function FbaStatusBadge({
  status,
  size = 'xs',
  iconOnly = false,
  className,
}: FbaStatusBadgeProps) {
  const token = (TOKENS as Record<string, StatusToken>)[status] ?? FALLBACK;
  const Icon = token.icon;

  const pad = size === 'sm' ? 'px-2 py-1' : 'px-2 py-0.5';
  const text = size === 'sm' ? 'text-[10px]' : 'text-[9px]';
  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-2.5 w-2.5';

  if (iconOnly) {
    return (
      <span
        aria-label={token.label}
        title={token.label}
        className={`inline-flex items-center justify-center ${className ?? ''}`}
      >
        <Icon className={`${iconSize} ${token.icon_tone}`} />
      </span>
    );
  }

  return (
    <span
      aria-label={token.label}
      className={`inline-flex items-center gap-1 rounded-lg border font-black uppercase tracking-widest ${pad} ${text} ${token.pill} ${className ?? ''}`}
    >
      <Icon className={`${iconSize} ${token.icon_tone}`} />
      {token.label}
    </span>
  );
}

export const FBA_STATUS_TOKENS = TOKENS;
