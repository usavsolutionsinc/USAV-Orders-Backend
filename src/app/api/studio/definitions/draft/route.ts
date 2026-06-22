import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { errorResponse } from '@/lib/api/errors';
import { parseBody } from '@/lib/schemas/parse';
import { StudioDraftCreateBody } from '@/lib/schemas/studio';
import { copyDefinitionToDraft } from '@/lib/studio/definitions';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';

/**
 * POST /api/studio/definitions/draft
 *
 * Creates a DRAFT workflow definition by copying a source definition
 * (default: the org's active one) into the next version number for that
 * name, is_active = FALSE. Node ids are re-minted (they are global TEXT
 * PKs); edges are remapped accordingly. All Studio editing targets a draft —
 * the active version is never mutated in place (Studio law #6).
 */
export const dynamic = 'force-dynamic';

export const POST = withAuth(async (request, ctx) => {
  let raw: unknown = {};
  try {
    raw = await request.json();
  } catch {
    /* empty body = copy the active definition */
  }
  const parsed = parseBody(StudioDraftCreateBody, raw ?? {});
  if (parsed instanceof NextResponse) return parsed;

  try {
    const outcome = await withTenantTransaction(ctx.organizationId, (client) =>
      copyDefinitionToDraft({
        client,
        orgId: ctx.organizationId,
        staffId: ctx.staffId,
        sourceId: parsed.sourceId,
      }),
    );

    if (outcome.status === 200 && 'audit' in outcome) {
      await recordAudit(pool, ctx, request, {
        source: 'studio.draft',
        action: AUDIT_ACTION.WORKFLOW_DRAFT_CREATE,
        entityType: AUDIT_ENTITY.WORKFLOW_DEFINITION,
        entityId: outcome.audit.draftId,
        method: 'manual',
        extra: { sourceId: outcome.audit.sourceId, name: outcome.audit.name, version: outcome.audit.version },
      });
    }

    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (err) {
    console.error('[POST /api/studio/definitions/draft] error:', err);
    return errorResponse(err, 'studio.draft.create');
  }
}, { permission: 'studio.manage', feature: 'studio' });
