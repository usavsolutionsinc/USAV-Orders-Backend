'use client';

import { DashboardKPICard } from './DashboardKPICard';
import { PRIMARY_KPI_CARDS } from './operations-kpi-config';
import type { DashboardData } from '@/features/operations/types';
import type { KpiKind } from './KpiDetailsModal';

export interface PrimaryKpiGridProps {
  summary?: DashboardData['summary'];
  onOpen: (kind: KpiKind) => void;
}

/** The four primary KPI tiles, rendered from {@link PRIMARY_KPI_CARDS}. */
export function PrimaryKpiGrid({ summary, onOpen }: PrimaryKpiGridProps) {
  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
      {PRIMARY_KPI_CARDS.map((card) => {
        const cell = summary?.[card.summaryKey];
        const startsPositive = String(cell?.delta || '').startsWith('+');
        return (
          <DashboardKPICard
            key={card.kind}
            title={card.title}
            value={cell?.value?.toString() || '0'}
            subtext={card.subtext}
            trend={String(cell?.delta || '+0%')}
            isPositive={card.invertDelta ? !startsPositive : startsPositive}
            icon={card.icon}
            colorTone={card.colorTone}
            chartType={card.chartType}
            progress={card.progress}
            onOpen={() => onOpen(card.kind)}
          />
        );
      })}
    </div>
  );
}
