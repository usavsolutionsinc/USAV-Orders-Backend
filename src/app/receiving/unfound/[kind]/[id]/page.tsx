/**
 * /receiving/unfound/[kind]/[id] — relocated.
 *
 * The Unfound queue moved to Admin › PO Mailbox. Deep links here now redirect:
 *   • unmatched_receiving → the receiving workspace (?id=<id>), where the
 *     carton editor mounts — unchanged, that flow never lived in the queue UI.
 *   • everything else     → Admin › PO Mailbox (the triage queue).
 */

import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/auth/page-guard';

interface PageProps {
  params: Promise<{ kind: string; id: string }>;
}

export default async function UnfoundDetailPage({ params }: PageProps) {
  await requirePermission('receiving.view', { enforce: true });
  const { kind, id } = await params;

  if (kind === 'unmatched_receiving' && id) {
    redirect(`/receiving?id=${encodeURIComponent(id)}`);
  }

  redirect('/admin?section=po_mailbox');
}
