import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { isInventoryV2Picking } from '@/lib/feature-flags';
import { loadPickQueue } from '@/lib/picking/queue';

/**
 * GET /api/pick/queue
 *
 * Returns the picker landing queue: every order that has at least one
 * allocation in state ALLOCATED or PICKING, sorted by earliest deadline.
 *
 * Gated by INVENTORY_V2_PICKING (matches the rest of the picker API surface).
 */
export const GET = withAuth(async () => {
  if (!isInventoryV2Picking()) {
    return NextResponse.json(
      { ok: false, error: 'INVENTORY_V2_PICKING flag is OFF', flag: 'INVENTORY_V2_PICKING' },
      { status: 503 },
    );
  }

  try {
    const rows = await loadPickQueue();
    return NextResponse.json({ ok: true, count: rows.length, queue: rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'queue load failed';
    console.error('[GET /api/pick/queue] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'orders.view' });
