'use client';

import type { AiStructuredAnswer } from '@/lib/ai/types';
import { sectionLabel, tableHeader, tableCell, dataValue } from '@/design-system/tokens/typography/presets';

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
      <div className="border border-gray-200 bg-white px-4 py-3 text-gray-800">
        <p className="text-[12px] leading-6 whitespace-pre-wrap">{content}</p>
        <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-2">
          <span className={sectionLabel}>
            {modeLabel || 'Assistant'}
          </span>
          <span className="text-[10px] text-gray-500">{timestampLabel}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`border bg-white ${analysis.kind === 'repair_diagnostics' ? 'border-blue-200' : 'border-gray-200'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="min-w-0">
          <p className={sectionLabel}>
            {analysis.modeLabel}
          </p>
          <h3 className="mt-1 text-[14px] font-semibold tracking-tight text-gray-900">{analysis.title}</h3>
          {analysis.timeframe ? (
            <p className="mt-1 text-[11px] text-gray-500">{analysis.timeframe.exactLabel}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className={`border px-2 py-1 ${sectionLabel} ${confidenceClasses(analysis.confidence)}`}>
            {analysis.confidence} confidence
          </span>
          <span className="text-[10px] text-gray-500">{timestampLabel}</span>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        <p className="text-[12px] leading-6 text-gray-800">{analysis.summary}</p>
        {content.trim() && content.trim() !== analysis.summary.trim() ? (
          <div className="border-l border-gray-200 pl-3 text-[11px] leading-6 text-gray-600">
            {content}
          </div>
        ) : null}

        {analysis.metrics?.length ? (
          <div className="grid gap-2 sm:grid-cols-3">
            {analysis.metrics.map((metric) => (
              <div key={metric.label} className="border border-gray-200 px-3 py-2">
                <p className={sectionLabel}>{metric.label}</p>
                <p className="mt-1 text-[18px] font-semibold tracking-tight text-gray-900">{metric.value}</p>
                {metric.detail ? (
                  <p className="mt-1 text-[11px] leading-5 text-gray-500">{metric.detail}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {analysis.breakdown?.length ? (
          <div className="border border-gray-200">
            <div className={`border-b border-gray-100 px-3 py-2 ${sectionLabel}`}>
              {analysis.breakdownTitle || 'Breakdown'}
            </div>
            <div className="divide-y divide-gray-100">
              {analysis.breakdown.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[12px]">
                  <div className="min-w-0">
                    {row.href ? (
                      <a href={row.href} className="font-medium text-gray-900 underline-offset-2 hover:underline">
                        {row.label}
                      </a>
                    ) : (
                      <span className="font-medium text-gray-900">{row.label}</span>
                    )}
                    {row.detail ? <p className="text-[11px] text-gray-500">{row.detail}</p> : null}
                  </div>
                  <span className={tableCell}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {analysis.sampleRecords?.length ? (
          <details className="border border-gray-200">
            <summary className={`cursor-pointer px-3 py-2 ${sectionLabel}`}>
              {analysis.sampleTitle || 'Sample records'}
            </summary>
            <div className="divide-y divide-gray-100 border-t border-gray-100">
              {analysis.sampleRecords.map((record) => (
                <div key={record.id} className="px-3 py-2">
                  {record.href ? (
                    <a href={record.href} className="text-[12px] font-medium text-gray-900 underline-offset-2 hover:underline">
                      {record.primary}
                    </a>
                  ) : (
                    <p className="text-[12px] font-medium text-gray-900">{record.primary}</p>
                  )}
                  {record.secondary ? <p className="mt-1 text-[11px] text-gray-500">{record.secondary}</p> : null}
                </div>
              ))}
            </div>
          </details>
        ) : null}

        <div className="flex flex-wrap gap-2 text-[10px]">
          {analysis.sources.map((source) => (
            <span key={source.id} className="border border-gray-200 bg-gray-50 px-2 py-1 text-gray-600" title={source.detail}>
              {source.label}
            </span>
          ))}
        </div>

        {analysis.actions?.length ? (
          <div className="flex flex-wrap gap-2">
            {analysis.actions.map((action) => (
              <a
                key={action.href}
                href={action.href}
                className="border border-gray-300 px-3 py-1.5 text-[11px] font-medium text-gray-700 transition-colors hover:border-gray-400 hover:text-gray-900"
              >
                {action.label}
              </a>
            ))}
          </div>
        ) : null}

        {analysis.followUps?.length ? (
          <div className="flex flex-wrap gap-2">
            {analysis.followUps.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => onFollowUp?.(prompt)}
                className="border border-gray-200 px-3 py-1.5 text-left text-[11px] text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900"
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
