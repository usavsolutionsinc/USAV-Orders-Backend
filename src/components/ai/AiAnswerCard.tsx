'use client';

import type { AiStructuredAnswer } from '@/lib/ai/types';
import { sectionLabel, tableHeader, tableCell, dataValue } from '@/design-system/tokens/typography/presets';
import MarkdownRenderer from '@/components/ai/MarkdownRenderer';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

function confidenceClasses(confidence: AiStructuredAnswer['confidence']) {
  if (confidence === 'high') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (confidence === 'medium') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-red-200 bg-red-50 text-red-700';
}

export default function AiAnswerCard({
  analysis,
  content,
  modeLabel,
  timestampLabel,
  onFollowUp,
}: {
  analysis?: AiStructuredAnswer | null;
  content: string;
  modeLabel?: string;
  timestampLabel: string;
  onFollowUp?: (prompt: string) => void;
}) {
  if (!analysis) {
    return (
      <div className="border border-border-soft bg-surface-card px-4 py-3 text-text-default">
        <MarkdownRenderer content={content} />
        <div className="mt-3 flex items-center justify-between border-t border-border-hairline pt-2">
          <span className={sectionLabel}>
            {modeLabel || 'Assistant'}
          </span>
          <span className="text-micro text-text-soft">{timestampLabel}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`border bg-surface-card ${analysis.kind === 'repair_diagnostics' ? 'border-blue-200' : 'border-border-soft'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-hairline px-4 py-3">
        <div className="min-w-0">
          <p className={sectionLabel}>
            {analysis.modeLabel}
          </p>
          <h3 className="mt-1 text-sm font-semibold tracking-tight text-text-default">{analysis.title}</h3>
          {analysis.timeframe ? (
            <p className="mt-1 text-caption text-text-soft">{analysis.timeframe.exactLabel}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className={`border px-2 py-1 ${sectionLabel} ${confidenceClasses(analysis.confidence)}`}>
            {analysis.confidence} confidence
          </span>
          <span className="text-micro text-text-soft">{timestampLabel}</span>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        <MarkdownRenderer content={analysis.summary} />
        {content.trim() && content.trim() !== analysis.summary.trim() ? (
          <div className="border-l border-border-soft pl-3 text-caption leading-6 text-text-muted">
            <MarkdownRenderer content={content} />
          </div>
        ) : null}

        {analysis.metrics?.length ? (
          <div className="grid gap-2 sm:grid-cols-3">
            {analysis.metrics.map((metric) => (
              <div key={metric.label} className="border border-border-soft px-3 py-2">
                <p className={sectionLabel}>{metric.label}</p>
                <p className="mt-1 text-lg font-semibold tracking-tight text-text-default">{metric.value}</p>
                {metric.detail ? (
                  <p className="mt-1 text-caption leading-5 text-text-soft">{metric.detail}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {analysis.breakdown?.length ? (
          <div className="border border-border-soft">
            <div className={`border-b border-border-hairline px-3 py-2 ${sectionLabel}`}>
              {analysis.breakdownTitle || 'Breakdown'}
            </div>
            <div className="divide-y divide-border-hairline">
              {analysis.breakdown.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-3 px-3 py-2 text-label">
                  <div className="min-w-0">
                    {row.href ? (
                      <a href={row.href} className="font-medium text-text-default underline-offset-2 hover:underline">
                        {row.label}
                      </a>
                    ) : (
                      <span className="font-medium text-text-default">{row.label}</span>
                    )}
                    {row.detail ? <p className="text-caption text-text-soft">{row.detail}</p> : null}
                  </div>
                  <span className={tableCell}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {analysis.sampleRecords?.length ? (
          <details className="border border-border-soft">
            <summary className={`cursor-pointer px-3 py-2 ${sectionLabel}`}>
              {analysis.sampleTitle || 'Sample records'}
            </summary>
            <div className="divide-y divide-border-hairline border-t border-border-hairline">
              {analysis.sampleRecords.map((record) => (
                <div key={record.id} className="px-3 py-2">
                  {record.href ? (
                    <a href={record.href} className="text-label font-medium text-text-default underline-offset-2 hover:underline">
                      {record.primary}
                    </a>
                  ) : (
                    <p className="text-label font-medium text-text-default">{record.primary}</p>
                  )}
                  {record.secondary ? <p className="mt-1 text-caption text-text-soft">{record.secondary}</p> : null}
                </div>
              ))}
            </div>
          </details>
        ) : null}

        <div className="flex flex-wrap gap-2 text-micro">
          {analysis.sources.map((source) => (
            <HoverTooltip key={source.id} label={source.detail ?? ''} asChild>
              <span className="border border-border-soft bg-surface-canvas px-2 py-1 text-text-muted">
                {source.label}
              </span>
            </HoverTooltip>
          ))}
        </div>

        {analysis.actions?.length ? (
          <div className="flex flex-wrap gap-2">
            {analysis.actions.map((action) => (
              <a
                key={action.href}
                href={action.href}
                className="border border-border-default px-3 py-1.5 text-caption font-medium text-text-muted transition-colors hover:border-border-emphasis hover:text-text-default"
              >
                {action.label}
              </a>
            ))}
          </div>
        ) : null}

        {analysis.followUps?.length ? (
          <div className="flex flex-wrap gap-2">
            {analysis.followUps.map((prompt) => (
              // ds-raw-button: left-aligned multi-line follow-up prompt row, not a centered DS Button
              <button
                key={prompt}
                type="button"
                onClick={() => onFollowUp?.(prompt)}
                className="border border-border-soft px-3 py-1.5 text-left text-caption text-text-muted transition-colors hover:border-border-default hover:bg-surface-hover hover:text-text-default"
              >
                {prompt}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
