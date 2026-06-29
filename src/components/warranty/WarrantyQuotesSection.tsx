'use client';

import { cn } from '@/utils/_cn';
import { Button } from '@/design-system/primitives';
import { useWarrantyMutations } from '@/hooks/useWarrantyMutations';
import type { WarrantyQuoteRow } from '@/lib/warranty/types';
import { warrantyQuoteToneClass } from '@/lib/warranty-quote-status';

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
            <span className="font-mono text-label text-gray-700">{q.quoteNumber}</span>
            <span className={cn('rounded-full px-2 py-0.5 text-caption font-medium', warrantyQuoteToneClass(q.status))}>
              {q.status}
            </span>
          </div>
          <div className="mt-1 text-sm text-gray-900">{fmt(q.total)}</div>
          {q.lineItems.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {q.lineItems.map((li, i) => (
                <li key={i} className="flex justify-between text-caption text-gray-500">
                  <span className="truncate">{li.label} × {li.qty}</span>
                  <span className="tabular-nums">${(Number(li.unitPrice) || 0).toFixed(2)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex gap-2">
            {q.status === 'DRAFT' && (
              <Button variant="secondary" size="sm" type="button" disabled={quoteStatus.isPending} onClick={() => act(q.id, 'SENT')}>
                Mark sent
              </Button>
            )}
            {q.status === 'SENT' && (
              <>
                <Button variant="primary" size="sm" type="button" disabled={quoteStatus.isPending} onClick={() => act(q.id, 'ACCEPTED')}
                  className="bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-700 shadow-emerald-600/25">
                  Accepted
                </Button>
                <Button variant="secondary" size="sm" type="button" disabled={quoteStatus.isPending} onClick={() => act(q.id, 'DECLINED')}>
                  Declined
                </Button>
              </>
            )}
          </div>
        </li>
      ))}
      {quoteStatus.error && (
        <li className="text-caption text-rose-600">
          {quoteStatus.error instanceof Error ? quoteStatus.error.message : 'Quote update failed.'}
        </li>
      )}
    </ul>
  );
}
