'use client';

import { OrdersIntegrityCard } from './connections/OrdersIntegrityCard';
import { ZohoSyncCard } from './connections/ZohoSyncCard';
import { BackfillCard } from './connections/BackfillCard';
import { EcwidSquareSyncCard } from './connections/EcwidSquareSyncCard';

export function ConnectionsManagementTab() {
  return (
    <div className="space-y-6">
      <OrdersIntegrityCard />
      <ZohoSyncCard />
      <BackfillCard />
      <EcwidSquareSyncCard />
    </div>
  );
}
