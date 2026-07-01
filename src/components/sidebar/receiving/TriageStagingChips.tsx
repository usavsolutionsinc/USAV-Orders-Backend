'use client';

/**
 * Shared "Staged / Shelf / Lane" popover chip row (A3) — reused by every
 * triage rail's `renderPopoverContext` so the three chips render identically
 * everywhere a `TriageStagingContext` is available. Renders nothing when the
 * carton has no staging context at all (never an empty rule line).
 */

import { Check, MapPin } from '@/components/Icons';
import { triageLaneLabel } from '@/lib/receiving/triage-lane-policy';
import type { TriageStagingContext } from './useTriageStagingMap';

export function TriageStagingChips({ ctx }: { ctx: TriageStagingContext | undefined }) {
  if (!ctx) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-2.5">
      {ctx.complete ? (
        <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-emerald-700 ring-1 ring-inset ring-emerald-200">
          <Check className="h-2.5 w-2.5" />
          Staged
        </span>
      ) : null}
      {ctx.locationLabel ? (
        <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-blue-700 ring-1 ring-inset ring-blue-200">
          <MapPin className="h-2.5 w-2.5" />
          {ctx.locationLabel}
        </span>
      ) : null}
      {ctx.lane ? (
        <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-gray-700 ring-1 ring-inset ring-gray-200">
          {triageLaneLabel(ctx.lane)}
        </span>
      ) : null}
    </div>
  );
}
