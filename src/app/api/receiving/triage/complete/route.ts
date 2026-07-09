import { NextRequest, NextResponse, after } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import { completeTriage } from '@/lib/receiving/complete-triage';

/**
 * POST /api/receiving/triage/complete — the real "Save for unbox" transition
 * (docs/receiving-triage-redesign-plan.md §3.5). `TriagePanel`'s terminal
 * button posts here instead of the old client-only toast no-op.
 *
 * Body: { receiving_id, client_event_id? }
 *
 * House route skeleton: validate → domain helper → map status (withAuth) →
 * audit → after() side-effects (.claude/rules/backend-patterns.md).
 */
export const POST = withAuth(async (request: NextRequest, ctx) => {
  const body = await request.json().catch(() => null);
  const receivingId = Number((body as { receiving_id?: unknown })?.receiving_id);
  const rawClientEventId = (body as { client_event_id?: unknown })?.client_event_id;
  const clientEventId = typeof rawClientEventId === 'string' ? rawClientEventId.trim() || null : null;

  if (!Number.isFinite(receivingId) || receivingId <= 0) {
    return NextResponse.json(
      { success: false, error: 'receiving_id is required' },
      { status: 400 },
    );
  }

  const result = await completeTriage(
    { receivingId, staffId: ctx.staffId, clientEventId },
    ctx.organizationId,
  );

  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error ?? 'triage complete failed' },
      { status: result.status },
    );
  }

  after(async () => {
    try {
      await invalidateCacheTags(['receiving-lines', 'receiving-logs', 'pending-unboxing']);
    } catch (err) {
      console.warn('[receiving.triage.complete.after] cache invalidation failed', err);
    }
    try {
      await publishReceivingLogChanged({
        organizationId: ctx.organizationId,
        action: 'update',
        rowId: String(result.receivingId),
        source: 'receiving.triage.complete',
      });
    } catch (err) {
      console.error('[receiving.triage.complete.after] realtime publish failed', err);
    }
  });

  return NextResponse.json({
    success: true,
    receiving_id: result.receivingId,
    triage_completed_at: result.triageCompletedAt,
    idempotent: result.idempotent,
  });
}, {
  permission: 'receiving.scan_po',
  audit: {
    source: 'receiving.triage.complete',
    action: AUDIT_ACTION.RECEIVING_TRIAGE_COMPLETE,
    entityType: AUDIT_ENTITY.RECEIVING,
    entityId: ({ response }) => {
      const r = response as { receiving_id?: number } | null;
      return r?.receiving_id ?? null;
    },
    extra: ({ response }) => {
      const r = response as { idempotent?: boolean } | null;
      return { idempotent: r?.idempotent ?? false };
    },
  },
});
