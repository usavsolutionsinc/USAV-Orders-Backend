'use client';

import { Check, FileText, Loader2, RefreshCw, Sparkles, X } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { useSupportSuggestion, type SupportSuggestionResult } from '@/hooks/useSupportSuggestion';
import { cn } from '@/utils/_cn';

const CONFIDENCE_CHIP: Record<SupportSuggestionResult['confidence'], string> = {
  high: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  medium: 'bg-amber-50 text-amber-700 ring-amber-200',
  low: 'bg-gray-100 text-gray-600 ring-gray-200',
};

/**
 * Local-AI suggested-reply panel — sits above the composer in the ticket detail.
 * Asks /api/support/suggest for a Bose-RAG-grounded draft, then lets the agent
 * drop it into the composer (Use), regenerate, or dismiss. Generation only — the
 * agent always reviews before sending.
 */
export function SupportSuggestionPanel({
  ticketId,
  subject,
  question,
  onUse,
}: {
  ticketId: number;
  subject?: string;
  question: string;
  onUse: (text: string) => void;
}) {
  const suggest = useSupportSuggestion();
  const result = suggest.data;
  const hasQuestion = Boolean(question.trim());

  const run = () => {
    if (!hasQuestion || suggest.isPending) return;
    suggest.mutate({ ticketId, subject, question });
  };

  return (
    <div className="shrink-0 border-t border-gray-100 bg-white px-4 py-2.5">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-500">
          <Sparkles className="h-3.5 w-3.5 text-blue-500" /> AI suggested reply
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[8.5px] font-black uppercase tracking-widest text-gray-500 ring-1 ring-inset ring-gray-200">
            Local
          </span>
        </span>
        {!result ? (
          <Button
            variant="secondary"
            size="sm"
            loading={suggest.isPending}
            disabled={!hasQuestion}
            onClick={run}
            icon={<Sparkles className="h-3.5 w-3.5" />}
          >
            Suggest reply
          </Button>
        ) : null}
      </div>

      {!hasQuestion ? (
        <p className="mt-1.5 text-[11px] text-gray-400">
          No customer message yet to draft a reply from.
        </p>
      ) : null}

      {suggest.isPending ? (
        <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Grounding in Bose docs &amp; drafting…
        </p>
      ) : null}

      {suggest.isError ? (
        <div className="mt-2 rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-3 text-center text-[12px] text-rose-700">
          {(suggest.error as Error)?.message || 'Could not generate a suggestion.'}
          <div className="mt-2">
            <Button variant="secondary" size="sm" onClick={run} icon={<RefreshCw className="h-3.5 w-3.5" />}>
              Try again
            </Button>
          </div>
        </div>
      ) : null}

      {result ? (
        <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ring-1 ring-inset',
                CONFIDENCE_CHIP[result.confidence],
              )}
            >
              {result.confidence} confidence
            </span>
            {!result.grounded ? (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-gray-500 ring-1 ring-inset ring-gray-200">
                no doc match
              </span>
            ) : null}
            {result.sources.slice(0, 4).map((src) => (
              <span
                key={src}
                className="inline-flex max-w-[12rem] items-center gap-1 truncate rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-700 ring-1 ring-inset ring-blue-200"
                title={src}
              >
                <FileText className="h-3 w-3 shrink-0" />
                <span className="truncate">{src}</span>
              </span>
            ))}
          </div>

          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-gray-900">{result.suggestion}</p>

          <div className="mt-2.5 flex items-center gap-1.5">
            <Button
              variant="primary"
              size="sm"
              onClick={() => onUse(result.suggestion)}
              icon={<Check className="h-3.5 w-3.5" />}
            >
              Use draft
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={suggest.isPending}
              onClick={run}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
            >
              Regenerate
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => suggest.reset()}
              icon={<X className="h-3.5 w-3.5" />}
            >
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
