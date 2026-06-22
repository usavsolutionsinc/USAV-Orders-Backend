import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { getOrders } from '@/lib/work-orders/queries';
import { topWorkOrderForStaff } from '@/lib/work-orders/ranking';

/**
 * GET /api/work-orders/mine
 *
 * The single most important work order for the signed-in operator, feeding the
 * global-header priority chip (P1-WORK-01 acceptance B). Reuses the EXACT queue
 * data source (getOrders) + the shared ranking SoT (topWorkOrderForStaff) so the
 * chip never diverges from the work-orders queue ordering.
 *
 * Org/RLS scoped via withAuth's tenantQuery (getOrders takes ctx.organizationId)
 * and operator-scoped via ctx.staffId — only rows the caller owns as tester or
 * packer are considered.
 */
export const GET = withAuth(async (_request: NextRequest, ctx) => {
  try {
    // Mirror the parent GET: only the pending-orders queue is enabled today.
    const orders = await getOrders(ctx.organizationId);
    const top = topWorkOrderForStaff(orders, ctx.staffId);

    if (!top) {
      return NextResponse.json({ top: null });
    }

    // Return a slim projection — the chip only needs to render + deep-link.
    return NextResponse.json({
      top: {
        id: top.id,
        entityType: top.entityType,
        entityId: top.entityId,
        queueLabel: top.queueLabel,
        title: top.title,
        subtitle: top.subtitle,
        recordLabel: top.recordLabel,
        sourcePath: top.sourcePath,
        status: top.status,
        priority: top.priority,
        deadlineAt: top.deadlineAt,
        role: top.techId === ctx.staffId ? 'tester' : 'packer',
      },
    });
  } catch (error: any) {
    console.error('Failed to fetch operator top work order:', error);
    return NextResponse.json(
      { error: 'Failed to fetch top work order', details: error?.message || 'Unknown error' },
      { status: 500 },
    );
  }
}, { permission: 'work_orders.view' });
