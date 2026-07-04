'use client';

import { Suspense, useState } from 'react';
import { Loader2 } from '@/components/Icons';
import { PerformanceGoals } from './PerformanceGoals';
import { OperationsMatrix } from './OperationsMatrix';
import { StaffGoalsRail } from './StaffGoalsRail';
import { LiveFeedCard } from './LiveFeedCard';
import { InventoryHealthRow } from './InventoryHealthRow';
import { ExceptionsRow } from './ExceptionsRow';
import { PipelineRow } from './PipelineRow';
import { VelocityAndDeadStock } from './VelocityAndDeadStock';
import { SupportOverviewCard } from './SupportOverviewCard';
import { SecondaryKPITiles } from './SecondaryKPITiles';
import PendingOrdersTable from '@/components/PendingOrdersTable';
import { KpiDetailsModal, type KpiKind } from './KpiDetailsModal';
import { PrimaryKpiGrid } from './PrimaryKpiGrid';
import { OperationsGoalHero } from './OperationsGoalHero';
import { OperationsAgentsRow } from './OperationsAgentsRow';
import { OperationsSectionHeader as SectionHeader } from './OperationsSectionHeader';
import { useOperationsDashboardData } from './useOperationsDashboardData';
import { selectKpiValue } from './operations-dashboard-logic';

export function OperationsDashboard() {
  const [openKpi, setOpenKpi] = useState<KpiKind | null>(null);
  const { data, isLoading } = useOperationsDashboardData();

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full overflow-y-auto bg-surface-canvas text-text-default">
      <main className="flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-16 space-y-6">

        {/* ── TOP: the current goal (P3-ADM-01 acceptance A — goal-first) ── */}
        <OperationsGoalHero staffProgress={data?.staffProgress} isLoading={isLoading} />

        {/* ── Local agents paired to the workflow (acceptance C) ── */}
        <section>
          <OperationsAgentsRow />
        </section>

        {/* ── SCROLL: live operations, stats & research (acceptance B) ── */}
        <section>
          <SectionHeader
            eyebrow="Today’s snapshot"
            title="Numbers at a glance"
            meta="Live · refreshes every minute"
          />
          <PrimaryKpiGrid summary={data?.summary} onOpen={setOpenKpi} />

          <div className="mt-3">
            <SecondaryKPITiles summary={data?.summary} />
          </div>
        </section>

        <section>
          <StaffGoalsRail staffProgress={data?.staffProgress} isLoading={isLoading} />
        </section>

        <section>
          <InventoryHealthRow />
        </section>

        <section>
          <ExceptionsRow />
        </section>

        <section>
          <PipelineRow />
        </section>

        <section>
          <VelocityAndDeadStock />
        </section>

        <section>
          <SectionHeader
            eyebrow="Goals & recommendations"
            title="What to focus on next"
          />
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-8">
              <OperationsMatrix />
            </div>
            <div className="lg:col-span-4">
              <PerformanceGoals />
            </div>
          </div>
        </section>

        <section>
          <SupportOverviewCard />
        </section>

        <section>
          <LiveFeedCard
            feed={data?.activityFeed}
            isLoading={isLoading}
            ablyStatus="connected"
          />
        </section>

        <section>
          <SectionHeader
            eyebrow="Operational ledger"
            title="Outbound pending orders"
          />
          <div className="bg-surface-card rounded-xl border border-border-soft overflow-hidden">
            <Suspense
              fallback={
                <div className="flex h-64 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-text-faint" />
                </div>
              }
            >
              <PendingOrdersTable />
            </Suspense>
          </div>
        </section>
      </main>

      <KpiDetailsModal
        kind={openKpi}
        value={selectKpiValue(openKpi, data?.summary)}
        activityFeed={data?.activityFeed}
        onClose={() => setOpenKpi(null)}
      />
    </div>
  );
}
