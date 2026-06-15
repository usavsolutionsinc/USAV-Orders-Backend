import { NextRequest, NextResponse } from 'next/server';
import { reorderRooms } from '@/lib/neon/location-queries';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * POST /api/rooms/reorder
 * Body: { order: string[] }   — room names, in the new display order.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = await req.json().catch(() => ({}));
    const order = Array.isArray(body?.order) ? body.order.map(String) : null;
    if (!order || order.length === 0) {
      return NextResponse.json({ error: 'order array required' }, { status: 400 });
    }
    if (order.length > 200) {
      return NextResponse.json({ error: 'Too many rooms (max 200)' }, { status: 400 });
    }
    // Tenant-scoped write: reorderRooms org-gates each sort_order UPDATE on
    // organization_id so a tenant submitting room names can only reorder its
    // OWN rooms, never another org's rooms with matching name strings.
    const result = await reorderRooms(order, ctx.organizationId);
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[POST /api/rooms/reorder] error:', err);
    return NextResponse.json({ error: 'Failed', details: err?.message }, { status: 500 });
  }
}, { permission: 'sku_stock.manage' });
