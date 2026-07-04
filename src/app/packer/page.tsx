import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { QueryClient, HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { PackerPageContent } from '@/components/packer/PackerPageContent';
import { getCurrentUser } from '@/lib/auth/current-user';
import { computeWeekRange } from '@/utils/date';
import { fetchPackerLogRows } from '@/lib/neon/packer-logs-week';

/**
 * /packer — the packer station landing.
 *
 * Identity from the verified session cookie. Staff switching happens via the
 * FAB's SwitchStaffSheet, not the URL.
 *
 * Performance note: the heavy `/api/packerlogs` query is prefetched here and
 * dehydrated into a React Query state, so the table can render on first paint
 * without waiting for a client-side fetch. The key shape must match what
 * `usePackerLogs(packerId, { weekRange })` builds; if you change that hook,
 * change this prefetch too.
 */
export default async function PackerPage() {
  const user = await getCurrentUser();
  if (!user) {
    const h = await headers();
    const path = h.get('x-pathname') || '/packer';
    redirect(`/signin?next=${encodeURIComponent(path)}`);
  }

  const packerId = Number(user.staffId);
  const weekRange = computeWeekRange(0);

  const queryClient = new QueryClient();
  try {
    await queryClient.prefetchQuery({
      queryKey: [
        'packer-logs',
        packerId,
        { weekStart: weekRange.startStr, weekEnd: weekRange.endStr },
      ],
      queryFn: async () => {
        const { rows } = await fetchPackerLogRows({
          organizationId: user.organizationId,
          packerId,
          limit: 1000,
          weekStart: weekRange.startStr,
          weekEnd: weekRange.endStr,
        });
        return rows;
      },
    });
  } catch (error) {
    // Prefetch is an optimization, not a requirement — fall back to client fetch
    // if the DB hiccups (transient Neon CU disconnect, cache layer outage, etc.).
    console.error('PackerPage prefetch failed; client will hydrate via /api/packerlogs', error);
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <PackerPageContent packerId={String(user.staffId)} />
    </HydrationBoundary>
  );
}
