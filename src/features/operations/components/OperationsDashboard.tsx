'use client';

import React, { Suspense, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Package,
  Wrench,
  Activity,
  Loader2,
  Barcode,
} from '@/components/Icons';
import { PerformanceGoals } from './PerformanceGoals';
import { DashboardKPICard } from './DashboardKPICard';
import { OperationsMatrix } from './OperationsMatrix';
import { StaffGoalsRail } from './StaffGoalsRail';
import { LiveFeedCard } from './LiveFeedCard';
import { InventoryHealthRow } from './InventoryHealthRow';
import { ExceptionsRow } from './ExceptionsRow';
import { PipelineRow } from './PipelineRow';
import { VelocityAndDeadStock } from './VelocityAndDeadStock';
import { SupportOverviewCard } from './SupportOverviewCard';
import { SecondaryKPITiles } from './SecondaryKPITiles';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import PendingOrdersTable from '@/components/PendingOrdersTable';
import type { DashboardData } from '@/features/operations/types';
import { sectionLabel, cardTitle } from '@/design-system/tokens/typography/presets';
import { KpiDetailsModal, type KpiKind } from './KpiDetailsModal';

function SectionHeader({ eyebrow, title, meta }: { eyebrow: string; title: string; meta?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div>
        <span className={sectionLabel}>{eyebrow}</span>
        <h2 className={`${cardTitle} mt-0.5`}>{title}</h2>
      </div>
      {meta && (
        <span className="hidden sm:inline-flex text-caption font-semibold text-gray-400">
          {meta}
        </span>
      )}
    </div>
  );
}

export function OperationsDashboard() {
  const queryClient = useQueryClient();
  const [openKpi, setOpenKpi] = useState<KpiKind | null>(null);

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['dashboard-operations', '24h'],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/operations?timeRange=24h');
      if (!res.ok) throw new Error('Failed to fetch dashboard data');
      return res.json();
    },
    refetchInterval: 60000,
  });

  const channelName = 'dashboard:operations';

  useAblyChannel(channelName, 'kpi_update', (msg) => {
    queryClient.setQueryData(['dashboard-operations', '24h'], (old: any) => {
      if (!old) return old;
      return { ...old, summary: { ...old.summary, [msg.data.category]: msg.data.update } };
    });
  });

  useAblyChannel(channelName, 'activity_event', (msg) => {
    queryClient.setQueryData(['dashboard-operations', '24h'], (old: any) => {
      if (!old) return old;
      return { ...old, activityFeed: [msg.data, ...old.activityFeed].slice(0, 20) };
    });
  });

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full overflow-y-auto bg-gray-50 text-gray-900">
      <main className="flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-16 space-y-6">

        <section>
          <SectionHeader
            eyebrow="Today’s snapshot"
            title="Numbers at a glance"
            meta="Live · refreshes every minute"
          />
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <DashboardKPICard
              title="Daily velocity"
              value={data?.summary.all.value?.toString() || '0'}
              subtext="Total units processed"
              trend={String(data?.summary.all.delta || '+0%')}
              isPositive={String(data?.summary.all.delta || '').startsWith('+')}
              icon={Activity}
              colorTone="amber"
              chartType="bar"
              onOpen={() => setOpenKpi('velocity')}
            />
            <DashboardKPICard
              title="Tested today"
              value={data?.summary.tested.value?.toString() || '0'}
              subtext="QA completed units"
              trend={String(data?.summary.tested.delta || '+0%')}
              isPositive={String(data?.summary.tested.delta || '').startsWith('+')}
              icon={Barcode}
              colorTone="emerald"
              chartType="donut"
              progress={78}
              onOpen={() => setOpenKpi('tested')}
            />
            <DashboardKPICard
              title="FBA intake"
              value={data?.summary.fba.value?.toString() || '0'}
              subtext="FNSKU shipments today"
              trend={String(data?.summary.fba.delta || '+0%')}
              isPositive={String(data?.summary.fba.delta || '').startsWith('+')}
              icon={Package}
              colorTone="amber"
              chartType="bar"
              onOpen={() => setOpenKpi('fba')}
            />
            <DashboardKPICard
              title="Repair queue"
              value={data?.summary.repair.value?.toString() || '0'}
              subtext="Awaiting service"
              trend={String(data?.summary.repair.delta || '+0%')}
              isPositive={!String(data?.summary.repair.delta || '').startsWith('+')}
              icon={Wrench}
              colorTone="orange"
              chartType="donut"
              progress={45}
              onOpen={() => setOpenKpi('repair')}
            />
          </div>

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
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <Suspense
              fallback={
                <div className="flex h-64 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
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
        value={
          openKpi === 'velocity' ? data?.summary.all.value
          : openKpi === 'tested' ? data?.summary.tested.value
          : openKpi === 'fba' ? data?.summary.fba.value
          : openKpi === 'repair' ? data?.summary.repair.value
          : undefined
        }
        activityFeed={data?.activityFeed}
        onClose={() => setOpenKpi(null)}
      />
    </div>
  );
}
