import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { isInventoryV2Rma } from '@/lib/feature-flags';
import {
  findById,
  updateAuthorization,
  cancelAuthorization,
} from '@/lib/rma/authorizations';
import { parseBody } from '@/lib/schemas/parse';
import { RmaUpdateBody } from '@/lib/schemas/rma';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

/**
 * Canonical record route for a single RMA. Lives alongside the lifecycle verb
 * routes (`[id]/close`, `[id]/disposition`, `[id]/mark-received`):
 *   GET    — fetch the authorization record
 *   PATCH  — edit mutable metadata (carrier / expiry / notes)
 *   DELETE — soft-cancel (AUTHORIZED → CANCELED)
 *
 * Gated by INVENTORY_V2_RMA + `orders.view`, matching the rest of the module.
 */

function flagOff() {
  return NextResponse.json(
    { ok: false, error: 'INVENTORY_V2_RMA flag is OFF', flag: 'INVENTORY_V2_RMA' },
    { status: 503 },
  );
}

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireRoutePerm(req, 'orders.view');
  if (gate.denied) return gate.denied;
  if (!isInventoryV2Rma()) return flagOff();
  try {
    const { id: rawId } = await params;
    const id = parseId(rawId);
    if (id === null) {
      return NextResponse.json({ ok: false, error: 'invalid rma id' }, { status: 400 });
    }

    const rma = await findById(id);
    if (!rma) {
      return NextResponse.json({ ok: false, error: 'rma not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, rma });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'get rma failed';
    console.error('[GET /api/rma/[id]] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireRoutePerm(req, 'orders.view');
  if (gate.denied) return gate.denied;
  if (!isInventoryV2Rma()) return flagOff();
  try {
    const { id: rawId } = await params;
    const id = parseId(rawId);
    if (id === null) {
      return NextResponse.json({ ok: false, error: 'invalid rma id' }, { status: 400 });
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(RmaUpdateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const before = await findById(id);
    if (!before) {
      return NextResponse.json({ ok: false, error: 'rma not found' }, { status: 404 });
    }

    const result = await updateAuthorization({
      rmaId: id,
      expectedCarrier: parsed.expected_carrier ?? null,
      expiresAt: parsed.expires_at ?? null,
      notes: parsed.notes ?? null,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }

    await recordAudit(pool, gate.ctx, req, {
      source: 'rma-api',
      action: AUDIT_ACTION.RMA_UPDATE,
      entityType: AUDIT_ENTITY.RMA,
      entityId: id,
      before: { ...before },
      after: { ...result.rma },
    });

    return NextResponse.json({ ok: true, rma: result.rma });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'update rma failed';
    console.error('[PATCH /api/rma/[id]] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireRoutePerm(req, 'orders.view');
  if (gate.denied) return gate.denied;
  if (!isInventoryV2Rma()) return flagOff();
  try {
    const { id: rawId } = await params;
    const id = parseId(rawId);
    if (id === null) {
      return NextResponse.json({ ok: false, error: 'invalid rma id' }, { status: 400 });
    }

    const before = await findById(id);
    if (!before) {
      return NextResponse.json({ ok: false, error: 'rma not found' }, { status: 404 });
    }

    const result = await cancelAuthorization({ rmaId: id });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }

    await recordAudit(pool, gate.ctx, req, {
      source: 'rma-api',
      action: AUDIT_ACTION.RMA_CANCEL,
      entityType: AUDIT_ENTITY.RMA,
      entityId: id,
      before: { ...before },
      after: { ...result.rma },
    });

    return NextResponse.json({ ok: true, rma: result.rma });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'cancel rma failed';
    console.error('[DELETE /api/rma/[id]] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
