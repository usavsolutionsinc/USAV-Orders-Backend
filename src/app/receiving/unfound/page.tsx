'use client';

/**
 * /receiving/unfound — flat queue of unmatched tracking exceptions.
 *
 * Uses the same RouteShell + ReceivingSidebarPanel chrome as /receiving so
 * the Unfound pill (added to RECEIVING_MODE_ITEMS) stays highlighted and
 * operators can flip back to Receive / History / Pickup without leaving
 * the section.
 *
 * Phase 2 baseline shows only `unmatched_receiving` rows. Phase 2.5 will
 * fold in the email_po source (replacing the inventory PO Mailbox UI).
 */

import { Suspense } from 'react';
import { RouteShell } from '@/design-system/components/RouteShell';
import { ReceivingSidebarPanel } from '@/components/sidebar/ReceivingSidebarPanel';
import { UnfoundQueueTable } from '@/components/receiving/unfound/UnfoundQueueTable';

function UnfoundPageInner() {
  return (
    <div className="h-full w-full overflow-hidden bg-[linear-gradient(180deg,#f5fbfa_0%,#ffffff_22%)]">
      <RouteShell
        actions={<ReceivingSidebarPanel />}
        history={<UnfoundQueueTable />}
      />
    </div>
  );
}

export default function UnfoundPage() {
  return (
    <Suspense>
      <UnfoundPageInner />
    </Suspense>
  );
}
