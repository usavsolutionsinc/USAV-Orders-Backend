'use client';

/**
 * Eyebrow + title (+ optional right-aligned meta) header for the Operations
 * dashboard's scroll sections. Extracted from OperationsDashboard so the
 * dashboard is pure composition.
 */

import { sectionLabel, cardTitle } from '@/design-system/tokens/typography/presets';

interface OperationsSectionHeaderProps {
  eyebrow: string;
  title: string;
  meta?: string;
}

export function OperationsSectionHeader({ eyebrow, title, meta }: OperationsSectionHeaderProps) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div>
        <span className={sectionLabel}>{eyebrow}</span>
        <h2 className={`${cardTitle} mt-0.5`}>{title}</h2>
      </div>
      {meta && (
        <span className="hidden sm:inline-flex text-caption font-semibold text-text-faint">
          {meta}
        </span>
      )}
    </div>
  );
}
