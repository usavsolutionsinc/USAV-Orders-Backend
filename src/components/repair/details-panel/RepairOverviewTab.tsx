'use client';

import type { RSRecord } from '@/lib/neon/repair-service-queries';
import type { RepairDetailsController } from './useRepairDetailsPanel';
import { RepairStatusSection } from './RepairStatusSection';
import { RepairCustomerSection, RepairTechnicalSection } from './RepairInfoSections';

/** Primary repair workspace: status/actions + customer/technical summary. */
export function RepairOverviewTab({
  repair,
  c,
}: {
  repair: RSRecord;
  c: RepairDetailsController;
}) {
  return (
    <div className="space-y-6">
      <RepairStatusSection repair={repair} c={c} />
      <RepairCustomerSection repair={repair} />
      <RepairTechnicalSection repair={repair} />
    </div>
  );
}
