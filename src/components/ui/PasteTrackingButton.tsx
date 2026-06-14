'use client';

import { MouseEvent, useState } from 'react';
import { Link2, Check, Loader2 } from '@/components/Icons';
import { useOrderAssignment } from '@/hooks/useOrderAssignment';
import { AddValueChipFace } from '@/components/ui/CopyChip';

type Status = 'idle' | 'saving' | 'success' | 'error';

/**
 * Empty-tracking-slot action on the unshipped queue: pastes the clipboard's
 * tracking number onto the order. Renders the shared {@link AddValueChipFace}
 * "Add TRK#" affordance (dashed underline) — the SAME chip-family look the
 * Incoming "Add TRK#" popover uses — instead of a bare "----" placeholder, so
 * the two surfaces read identically (same chain-link Link2 icon). Status drives
 * the icon + color for saving/success/error feedback.
 */
export function PasteTrackingButton({ orderId }: { orderId: number }) {
  const [status, setStatus] = useState<Status>('idle');
  const mutation = useOrderAssignment();

  const handlePaste = async (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (status === 'saving') return;

    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) return;

      setStatus('saving');
      await mutation.mutateAsync({ orderId, shippingTrackingNumber: text });
      setStatus('success');
      setTimeout(() => setStatus('idle'), 1500);
    } catch {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 1500);
    }
  };

  // Chain-link icon (Link2) so the dashboard paste affordance matches the
  // receiving "Add TRK#" exactly; spinner/check only swap in for transient
  // saving/success feedback.
  const icon =
    status === 'saving' ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> :
    status === 'success' ? <Check className="h-3.5 w-3.5 shrink-0" /> :
    <Link2 className="h-3.5 w-3.5 shrink-0" />;

  const colorClass =
    status === 'success' ? 'text-emerald-600' :
    status === 'error' ? 'text-red-600' :
    'text-blue-600';
  const underlineClass =
    status === 'success' ? 'border-emerald-400' :
    status === 'error' ? 'border-red-400' :
    'border-blue-400';

  return (
    <button
      type="button"
      onClick={handlePaste}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      title="Paste a copied tracking number onto this order"
      className="inline-flex shrink-0 items-center transition-transform active:scale-95"
    >
      <AddValueChipFace label="Add TRK#" icon={icon} colorClass={colorClass} underlineClass={underlineClass} />
    </button>
  );
}
