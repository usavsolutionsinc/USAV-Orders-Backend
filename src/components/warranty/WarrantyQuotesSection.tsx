'use client';

import { cn } from '@/utils/_cn';
import { useWarrantyMutations } from '@/hooks/useWarrantyMutations';
import type { WarrantyQuoteRow } from '@/lib/warranty/types';

const QUOTE_TONE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  SENT: 'bg-blue-100 text-blue-700',
  ACCEPTED: 'bg-emerald-100 text-emerald-700',
  DECLINED: 'bg-rose-100 text-rose-700',
  EXPIRED: 'bg-zinc-200 text-zinc-700',
};

function fmt(amount: string | null): string {
  if (amount == null) return '—';
  const n = Number(amount);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : amount;
}

export function WarrantyQuotesSection({ claimId, quotes }: { claimId: number; quotes: WarrantyQuoteRow[] }) {
  const { quoteStatus } = useWarrantyMutations();
  if (!quotes || quotes.length === 0) return null;

  const act = (quoteId: number, status: string) => quoteStatus.mutate({ quoteId, claimId, status });

  return (
    <ul className="space-y-2">
      {quotes.map((q) => (
        <li key={q.id} className="rounded-lg border border-gray-100 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[12px] text-gray-700">{q.quoteNumber}</span>
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', QUOTE_TONE[q.status] ?? QUOTE_TONE.DRAFT)}>
              {q.status}
            </span>
          </div>
          <div className="mt-1 text-sm text-gray-900">{fmt(q.total)}</div>
          {q.lineItems.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {q.lineItems.map((li, i) => (
                <li key={i} className="flex justify-between text-[11px] text-gray-500">
                  <span className="truncate">{li.label} × {li.qty}</span>
                  <span className="tabular-nums">${(Number(li.unitPrice) || 0).toFixed(2)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex gap-2">
            {q.status === 'DRAFT' && (
              <button type="button" disabled={quoteStatus.isPending} onClick={() => act(q.id, 'SENT')}
                className="rounded-md border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                Mark sent
              </button>
            )}
            {q.status === 'SENT' && (
              <>
                <button type="button" disabled={quoteStatus.isPending} onClick={() => act(q.id, 'ACCEPTED')}
                  className="rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                  Accepted
                </button>
                <button type="button" disabled={quoteStatus.isPending} onClick={() => act(q.id, 'DECLINED')}
                  className="rounded-md border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                  Declined
                </button>
              </>
            )}
          </div>
        </li>
      ))}
      {quoteStatus.error && (
        <li className="text-[11px] text-rose-600">
          {quoteStatus.error instanceof Error ? quoteStatus.error.message : 'Quote update failed.'}
        </li>
      )}
    </ul>
  );
}
