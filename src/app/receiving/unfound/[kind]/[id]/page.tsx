/**
 * /receiving/unfound/[kind]/[id] — detail surface for a single queue row.
 *
 * Mounts the right per-kind detail component:
 *   • email_po              → PoTriageDetailView (the migrated PO Mailbox UI)
 *   • unmatched_receiving   → redirects to /receiving?id=<id> where the
 *                              workspace mounts UnfoundLineEditPanel
 *
 * Phase 2.6 will add a station_exception branch.
 */

import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/auth/page-guard';
import { RouteShell } from '@/design-system/components/RouteShell';
import { ReceivingSidebarPanel } from '@/components/sidebar/ReceivingSidebarPanel';
import { PoTriageDetailView } from '@/components/po-triage/PoTriageDetailView';

interface PageProps {
  params: Promise<{ kind: string; id: string }>;
}

const VALID_KINDS = new Set(['email_po', 'unmatched_receiving', 'station_exception']);

export default async function UnfoundDetailPage({ params }: PageProps) {
  await requirePermission('receiving.view', { enforce: true });
  const { kind, id } = await params;

  if (!VALID_KINDS.has(kind) || !id) {
    redirect('/receiving/unfound');
  }

  // unmatched_receiving lives in the main receiving workspace — bounce there
  // instead of duplicating the editor surface inside this route.
  if (kind === 'unmatched_receiving') {
    redirect(`/receiving?id=${encodeURIComponent(id)}`);
  }

  // station_exception has no rich detail — operators handle it inline in
  // the queue (notes + check + Zendesk push). Bounce back to the list if
  // someone deep-links here.
  if (kind === 'station_exception') {
    redirect('/receiving/unfound');
  }

  // email_po → reuse the existing PO Mailbox detail view (post-cutover).
  return (
    <div className="h-full w-full overflow-hidden bg-[linear-gradient(180deg,#f5fbfa_0%,#ffffff_22%)]">
      <RouteShell
        actions={<ReceivingSidebarPanel />}
        history={
          <Suspense fallback={null}>
            <PoTriageDetailView id={id} />
          </Suspense>
        }
      />
    </div>
  );
}
