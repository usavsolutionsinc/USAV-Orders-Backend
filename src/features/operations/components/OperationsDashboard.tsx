'use client';

import React, { Suspense } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Package,
  Wrench,
  AlertCircle,
  Clock,
  Activity,
  Loader2,
  Barcode,
} from '@/components/Icons';
import { OperationsHeader } from './OperationsHeader';
import { StatCard } from '@/design-system/components/StatCard';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { useSearchParams } from 'next/navigation';
import { WorkOrdersDashboard } from '@/components/work-orders/WorkOrdersDashboard';
import PendingOrdersTable from '@/components/PendingOrdersTable';
import type { DashboardData } from '@/features/operations/types';

type View = 'work-queue' | 'orders';

function resolveView(raw: string | null): View {
  if (raw === 'orders') return 'orders';
  return 'work-queue';
}

export function OperationsDashboard() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const currentView = resolveView(searchParams.get('view'));

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['dashboard-operations', '24h'],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/operations?timeRange=24h');
      if (!res.ok) throw new Error('Failed to fetch dashboard data');
      return res.json();
    },
    refetchInterval: 60000,
  });

  // Ably Realtime — KPI live updates
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
    <div className="h-full w-full overflow-hidden bg-slate-50/50 flex flex-col font-sans">
      <OperationsHeader title="USAV" />

      {/* KPI TILES — GROUNDED IN DESIGN SYSTEM 2026 */}
      <section className="grid grid-cols-6 bg-white border-b border-slate-200 shadow-sm flex-none">
        <StatCard category="all" label="Daily Velocity" value={data?.summary.all.value || 0} delta={data?.summary.all.delta} icon={<Activity />} isLoading={isLoading} />
        <StatCard category="tested" label="Tested Today" value={data?.summary.tested.value || 0} delta={data?.summary.tested.delta} icon={<Barcode />} isLoading={isLoading} />
        <StatCard category="repair" label="Repair Queue" value={data?.summary.repair.value || 0} delta={data?.summary.repair.delta} icon={<Wrench />} isLoading={isLoading} />
        <StatCard category="fba" label="FBA / FNSKU" value={data?.summary.fba.value || 0} delta={data?.summary.fba.delta} icon={<Package />} isLoading={isLoading} />
        <StatCard category="outOfStock" label="Alerts / OOS" value={data?.summary.outOfStock.value || 0} delta={data?.summary.outOfStock.delta} icon={<AlertCircle />} isLoading={isLoading} />
        <StatCard category="pendingLate" label="Late Orders" value={data?.summary.pendingLate.value || 0} delta={data?.summary.pendingLate.delta} icon={<Clock />} isLoading={isLoading} />
      </section>

      {/* MAIN CONTENT — VIEW ROUTED */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <Suspense fallback={
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        }>
          {currentView === 'orders' ? (
            <PendingOrdersTable />
          ) : (
            <WorkOrdersDashboard basePath="/operations" />
          )}
        </Suspense>
      </div>
    </div>
  );
}
