'use client';

import React, { useEffect } from 'react';
import { X } from '@/components/Icons';

export type ReturnEvent = {
  id: string;
  serial_number: string;
  line_id: number | null;
  sku: string | null;
  prior_status: string | null;
  at: number;
};

type Props = {
  returns: ReturnEvent[];
  onDismiss: (id: string) => void;
  autoDismissMs?: number;
};

export function ReceivingReturnBanner({
  returns,
  onDismiss,
  autoDismissMs = 8000,
}: Props) {
  useEffect(() => {
    if (returns.length === 0) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const r of returns) {
      const remaining = autoDismissMs - (Date.now() - r.at);
      if (remaining <= 0) {
        onDismiss(r.id);
        continue;
      }
      timers.push(setTimeout(() => onDismiss(r.id), remaining));
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [returns, onDismiss, autoDismissMs]);

  if (returns.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 border-b border-amber-200 bg-amber-50 px-3 py-2">
      {returns.map((ret) => (
        <div
          key={ret.id}
          className="flex items-start gap-2 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5"
        >
          <div className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-black uppercase tracking-wider text-amber-800">
              Return detected
            </p>
            <p className="mt-0.5 truncate font-mono text-[10px] font-bold text-gray-900">
              {ret.serial_number}
            </p>
            {ret.sku && (
              <p className="truncate text-[9px] font-bold text-gray-600">{ret.sku}</p>
            )}
            {ret.prior_status && (
              <p className="text-[8px] font-black uppercase tracking-wider text-gray-400">
                prior: {ret.prior_status}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onDismiss(ret.id)}
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-amber-700 hover:bg-amber-100"
            aria-label="Dismiss return notice"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
