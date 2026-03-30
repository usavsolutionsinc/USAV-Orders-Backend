'use client';

import { MouseEvent, useState } from 'react';
import { Clipboard, Check, Loader2 } from '@/components/Icons';
import { useOrderAssignment } from '@/hooks/useOrderAssignment';
import { monoValue } from '@/design-system/tokens/typography/presets';

type Status = 'idle' | 'saving' | 'success' | 'error';

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

  const icon =
    status === 'saving' ? <Loader2 className="w-4 h-4 shrink-0 text-blue-500 animate-spin" /> :
    status === 'success' ? <Check className="w-4 h-4 shrink-0 text-emerald-500" /> :
    status === 'error' ? <Clipboard className="w-4 h-4 shrink-0 text-red-500" /> :
    <Clipboard className="w-4 h-4 shrink-0 text-blue-500" />;

  const underline =
    status === 'success' ? 'border-emerald-500' :
    status === 'error' ? 'border-red-500' :
    'border-blue-500';

  return (
    <div className="relative w-fit max-w-full">
      <button
        type="button"
        onClick={handlePaste}
        className="inline-flex w-fit max-w-full items-center justify-start gap-0.5 py-0 bg-white text-black text-left transition-all active:scale-95"
      >
        <span className="shrink-0">{icon}</span>
        <span className={`${monoValue} tracking-tight leading-none border-b-2 pb-0.5 min-w-0 text-left whitespace-nowrap ${underline}`}>
          ----
        </span>
      </button>
    </div>
  );
}
