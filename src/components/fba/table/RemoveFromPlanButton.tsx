'use client';

import { useState } from 'react';
import { Trash2, X } from '@/components/Icons';

export function RemoveFromPlanButton({
  fnsku,
  onConfirm,
  disabled,
}: {
  fnsku: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const [phase, setPhase] = useState<'idle' | 'confirm'>('idle');

  if (phase === 'confirm') {
    return (
      <div
        className="flex items-center gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label={`Cancel removing ${fnsku}`}
          title="Cancel"
          className="inline-flex h-7 w-7 items-center justify-center text-zinc-500 transition-colors hover:text-zinc-800"
          onClick={() => setPhase('idle')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Remove ${fnsku}`}
          title="Remove"
          className="inline-flex h-7 w-7 items-center justify-center text-red-700 transition-colors hover:text-red-900"
          onClick={() => {
            setPhase('idle');
            onConfirm();
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        setPhase('confirm');
      }}
      aria-label={`Remove ${fnsku} from plan`}
      title="Remove from plan"
      className="inline-flex h-7 w-7 items-center justify-center text-red-700 transition-colors hover:text-red-900 disabled:opacity-40"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}
