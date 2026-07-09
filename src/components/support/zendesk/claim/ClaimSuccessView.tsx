'use client';

import { CheckCircle, ExternalLink } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import type { ClaimResult } from './claim-types';

/** Linear/Notion-style success screen shown inside the modal after submit. */
export function ClaimSuccessView({ result, onClose }: { result: ClaimResult; onClose: () => void }) {
  const verb = result.mode === 'create' ? 'created' : 'updated';
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8 py-14 text-center">
      <div className="relative">
        {/* one-shot reveal ring — not a looping ping */}
        <span
          aria-hidden
          className="absolute inset-0 animate-ping rounded-full bg-emerald-200/70"
          style={{ animationIterationCount: 1, animationDuration: '650ms' }}
        />
        <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 ring-1 ring-inset ring-emerald-200">
          <CheckCircle className="h-11 w-11 text-emerald-600" />
        </span>
      </div>

      <div className="space-y-1.5">
        <h3 className="text-lg font-bold tracking-tight text-text-default">Ticket {verb}</h3>
        <p className="max-w-xs text-sm leading-relaxed text-text-soft">
          Ticket <span className="font-bold text-text-muted">{result.number}</span> was {verb}
          {result.attached > 0
            ? ` with ${result.attached} photo${result.attached === 1 ? '' : 's'} attached`
            : ''}
          .
        </p>
      </div>

      <div className="mt-1 flex items-center gap-2.5">
        {result.url ? (
          <a href={result.url} target="_blank" rel="noopener noreferrer">
            <Button variant="secondary" icon={<ExternalLink className="h-4 w-4" />}>
              Open in Support
            </Button>
          </a>
        ) : null}
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
