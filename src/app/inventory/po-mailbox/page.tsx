/**
 * /inventory/po-mailbox — main content area for the PO mailbox triage flow.
 *
 * The sidebar (InventorySidebarPanel) renders the four-pile worklist.
 * Clicking a pile row sets ?msg=<row.id> on this URL, and we render the
 * checklist + email body here. With no msg, we show an empty-state
 * pointing users at the sidebar.
 */

import { Suspense } from 'react';
import { requirePermission } from '@/lib/auth/page-guard';
import { PoTriageDetailView } from '@/components/po-triage/PoTriageDetailView';

interface PageProps {
  searchParams: Promise<{ msg?: string }>;
}

export default async function InventoryPoMailboxPage({ searchParams }: PageProps) {
  await requirePermission('admin.view', { enforce: true });
  const { msg } = await searchParams;
  const id = typeof msg === 'string' && msg.trim() ? msg.trim() : null;

  return (
    <Suspense fallback={null}>
      <PoTriageDetailView id={id} />
    </Suspense>
  );
}
