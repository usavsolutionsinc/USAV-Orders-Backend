'use client';

import { InventoryControlsPanel } from '@/components/inventory-v2/InventoryControlsPanel';

/**
 * Sidebar panel for the inventory area.
 *
 * Post-cutover (Phase 2.4): the PO Mailbox pill that previously lived here
 * was retired — mailbox triage now lives in /receiving/unfound alongside
 * unmatched tracking exceptions. This panel renders the inventory controls
 * directly without any section-nav pills.
 */
export function InventorySidebarPanel() {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <InventoryControlsPanel />
      </div>
    </div>
  );
}
