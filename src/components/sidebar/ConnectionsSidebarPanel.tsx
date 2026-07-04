'use client';

/**
 * Connections admin sidebar — thin composition shell. Every integration query +
 * mutation and the section/input state live in {@link useConnectionsPanel}; each
 * collapsible section is a presentational component under `./connections-panel/`.
 */

import { useConnectionsPanel } from './connections-panel/useConnectionsPanel';
import {
  OrdersSection,
  ZohoSection,
  BackfillSection,
  CatalogSection,
  ShippingSection,
  AmazonSection,
} from './connections-panel/ConnectionsSections';

export type { ConnectionLogEntryInput } from './connections-panel/connections-shared';

export function ConnectionsSidebarPanel() {
  const c = useConnectionsPanel();

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface-card">
      <input
        ref={c.shipStationFileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => c.handleShipStationFileChange(e.target.files?.[0] || null)}
      />
      <div className="flex-1 overflow-y-auto">
        <OrdersSection c={c} />
        <ZohoSection c={c} />
        <BackfillSection c={c} />
        <CatalogSection c={c} />
        <ShippingSection c={c} />
        <AmazonSection c={c} />
      </div>
    </div>
  );
}
