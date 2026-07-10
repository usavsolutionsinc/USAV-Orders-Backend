import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { InboxQuerySchema } from '@/lib/schemas/ops-plans';
import { listTasksForInbox } from '@/lib/ops-plans/queries';
import {
  filterInboxItems,
  mergePlanTasksAndWorkOrders,
  paginateInboxItems,
} from '@/lib/ops-plans/inbox';
import { fetchAllWorkOrderQueues } from '@/lib/work-orders/fetch-all-queues';
import { isOpsPlansUnifiedInbox } from '@/lib/ops-plans/flags';

export const runtime = 'nodejs';

export const GET = withAuth(async (req: NextRequest, ctx) => {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = InboxQuerySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_QUERY', issues: parsed.error.issues }, { status: 400 });
  }
  const q = parsed.data;

  let staffId: number | null | undefined;
  if (q.staffId === 'mine') {
    staffId = ctx.staffId;
  } else if (q.staffId != null) {
    staffId = q.staffId;
  }

  const planTasks = await listTasksForInbox(ctx.organizationId, {
    planId: q.planId ?? null,
    staffId: staffId ?? undefined,
    station: q.station ?? null,
    status: q.status === 'all' ? 'all' : 'open',
  });

  const includeWorkOrders =
    (await isOpsPlansUnifiedInbox(ctx.organizationId)) && (q.source ?? 'all') !== 'plan';
  const workOrders = includeWorkOrders
    ? (await fetchAllWorkOrderQueues(ctx.organizationId)).filter(
        (row) => row.status !== 'DONE' && row.status !== 'CANCELED',
      )
    : [];

  let items = mergePlanTasksAndWorkOrders(planTasks, workOrders);
  items = filterInboxItems(items, {
    staffId: staffId ?? null,
    station: q.station ?? null,
    source: q.source ?? 'all',
    status: q.status ?? 'open',
    q: q.q,
    planId: q.planId ?? null,
  });

  const limit = q.limit ?? 50;
  const { items: page, nextCursor } = paginateInboxItems(items, limit, q.cursor ?? null);

  return NextResponse.json({
    items: page,
    nextCursor,
    counts: {
      planTasks: items.filter((i) => i.source === 'plan_task').length,
      workOrders: items.filter((i) => i.source === 'work_assignment').length,
    },
  });
}, { permission: 'operations.plans.view' });
