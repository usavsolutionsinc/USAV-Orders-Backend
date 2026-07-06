'use client';

/**
 * Soft industry-standard nudges — recommendations only, never hard gates.
 * Small-business tenants can ignore every item and keep working.
 */

import { surfaceRecommendations, type WorkflowRecommendation } from '@/lib/receiving/workflow-recommendations';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

export function WorkflowRecommendationsStrip({
  row,
  surface,
  photoCount = 0,
  className = '',
}: {
  row: ReceivingLineRow;
  surface: 'triage' | 'unbox';
  photoCount?: number;
  className?: string;
}) {
  const recs = surfaceRecommendations({
    row,
    surface,
    photoCount,
    conditionExplicitlySet: !!row.condition_set_at,
  });
  if (recs.length === 0) return null;
  return (
    <div className={`space-y-1.5 ${className}`}>
      {recs.slice(0, 2).map((r) => (
        <RecommendationChip key={r.id} rec={r} />
      ))}
    </div>
  );
}

function RecommendationChip({ rec }: { rec: WorkflowRecommendation }) {
  const toneClass =
    rec.tone === 'success'
      ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
      : rec.tone === 'tip'
        ? 'bg-blue-50 text-blue-800 ring-blue-200'
        : 'bg-surface-sunken text-text-muted ring-border-soft';
  return (
    <div
      className={`rounded-lg px-3 py-2 text-xs ring-1 ring-inset ${toneClass}`}
      role="note"
    >
      <p className="font-semibold">{rec.title}</p>
      {rec.detail ? <p className="mt-0.5 opacity-90">{rec.detail}</p> : null}
    </div>
  );
}
